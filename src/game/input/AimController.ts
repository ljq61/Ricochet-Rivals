import Phaser from 'phaser';
import { GAME_CONFIG } from '../config/GameConfig';
import { CameraMode } from '../camera/CameraMode';
import type { CommandBus } from '../commands/CommandBus';
import type { FireCommand } from '../commands/GameCommand';
import type { GameState } from '../state/GameState';
import {
  calculateAim,
  getLaunchOrigin,
  type AimState,
} from '../physics/aimMath';
import {
  exceedsAimDeadZone,
  type AimPendingDrag,
} from './aimGesture';
import type { GestureClaimant, GesturePointerEvent } from './gesture';

export interface AimControllerDeps {
  getState: () => GameState;
  getCameraMode: () => CameraMode;
  commandBus: CommandBus;
  /** 触屏档位：放大瞄准起始判定（屏幕 px 换算）并启用死区 */
  isTouchProfile: boolean;
  /** UI 缩放（游戏像素 ÷ CSS 像素 = DPR）：触摸起始半径换算用 */
  getUiScale: () => number;
  /** 联机回合归属 / 恢复锁；缺省允许，保持离线输入行为。 */
  canControl?: () => boolean;
}

/**
 * 瞄准输入控制器（Phase 4 Angry Birds 式反方向拖拽；Phase 6.5 接入仲裁）。
 *
 * 交互（桌面 / 触屏共用同一套计算，仅采集参数不同）：
 * - 仅在 Camera AIMING 且本回合未发射时认领指针（InputRouter AIM 优先级）
 * - 起始判定：桌面 = 炮手 startRadius（世界 px）内；
 *   触屏 = aimStartRadiusScreenPx（屏幕 px ÷ zoom，触点约一拇指范围）
 * - 死区：拖动超过 aimDeadZoneScreenPx 才激活（桌面为 0 = 立即激活，
 *   与 Phase 4 行为一致）；死区内松手 = 静默取消，不会误发射
 * - 拖拽期间持续更新方向 / 力度（aimMath 纯函数）
 * - 释放：达到最小力度 → 提交 FireCommand；不足 → 静默取消
 * - pointercancel / 相机离开 AIMING（取消瞄准等）→ 中止
 *
 * 输入层不含规则：发射合法性由 FireSystem 校验。
 * tryClaim 失败路径无副作用（GestureClaimant 契约）。
 */
export class AimController implements GestureClaimant {
  readonly kind = 'AIM' as const;

  private readonly camera: Phaser.Cameras.Scene2D.Camera;
  private readonly tmpVec = new Phaser.Math.Vector2();

  private aim: AimState = createInactiveAimState();
  /** 死区内的待激活拖拽（触摸防误触；桌面 deadZone=0 时立即激活） */
  private pending: AimPendingDrag | null = null;
  private pendingOrigin: { x: number; y: number } | null = null;

  constructor(
    scene: Phaser.Scene,
    private readonly deps: AimControllerDeps
  ) {
    this.camera = scene.cameras.main;
  }

  get aimState(): AimState {
    return this.aim;
  }

  /** 相机离开 AIMING（取消瞄准等）时中止进行中的拖拽 */
  update(): void {
    if (this.deps.canControl?.() === false) {
      this.abort();
      return;
    }
    if (
      (this.aim.active || this.pending) &&
      this.deps.getCameraMode() !== CameraMode.AIMING
    ) {
      this.abort();
    }
  }

  /** Phase 6.5 起无 DOM 监听（InputRouter 统一持有）；清理进行中的瞄准状态 */
  destroy(): void {
    this.abort();
  }

  /** 恢复锁进入时取消已有拖拽；解锁后须重新按下才能瞄准。 */
  cancel(): void {
    this.abort();
  }

  // ---- GestureClaimant（InputRouter → AIM） ------------------------------

  /** 无副作用探测：AIMING + 未发射 + 起始判定半径内 → 认领并进入 pending/激活 */
  tryClaim(event: GesturePointerEvent): boolean {
    if (this.deps.canControl?.() === false) {
      this.abort();
      return false;
    }
    if (this.deps.getCameraMode() !== CameraMode.AIMING) {
      return false;
    }
    if (this.aim.active || this.pending) {
      return false;
    }

    const state = this.deps.getState();
    const player = state.players[state.currentPlayerId];
    if (player.hasFired) {
      return false;
    }

    const world = this.canvasToWorld(event.x, event.y);
    const origin = getLaunchOrigin(player);

    // 起始判定半径：桌面按世界距离（startRadius）；
    // 触屏按屏幕距离换算（aimStartRadiusScreenPx（CSS px）× uiScale
    // → 游戏像素，再 ÷ zoom → 世界半径）
    const startRadiusWorld = this.deps.isTouchProfile
      ? (GAME_CONFIG.controls.touch.aimStartRadiusScreenPx *
          this.deps.getUiScale()) /
        this.camera.zoom
      : GAME_CONFIG.aiming.startRadius;

    if (
      Math.hypot(world.x - origin.x, world.y - origin.y) > startRadiusWorld
    ) {
      return false;
    }

    this.pending = {
      startScreenX: event.clientX,
      startScreenY: event.clientY,
    };
    this.pendingOrigin = origin;
    // 桌面死区为 0：立即激活，与 Phase 4（pointerdown 即出拖线）一致
    if (this.deadZonePx() <= 0) {
      this.activate(event.x, event.y);
    }
    return true;
  }

  onMove(event: GesturePointerEvent): void {
    if (this.deps.canControl?.() === false) {
      this.abort();
      return;
    }
    if (this.pending && !this.aim.active) {
      // 死区按物理距离（client 坐标）判定，跨设备手感一致
      if (
        !exceedsAimDeadZone(
          this.pending,
          event.clientX,
          event.clientY,
          this.deadZonePx()
        )
      ) {
        return; // 死区内：不激活，避免落点抖动直接开火
      }
      this.activate(event.x, event.y);
      return;
    }
    if (!this.aim.active) {
      return;
    }
    this.updateAim(event.x, event.y);
  }

  onUp(_event: GesturePointerEvent): void {
    if (this.deps.canControl?.() === false) {
      this.abort();
      return;
    }
    // 死区内松手：未激活，静默取消（不发射）
    if (this.pending && !this.aim.active) {
      this.pending = null;
      this.pendingOrigin = null;
      return;
    }
    if (!this.aim.active) {
      return;
    }

    const aim = this.aim;
    this.abort();

    // 低于最小力度：不允许发射，静默取消
    if (!aim.canFire) {
      return;
    }

    const state = this.deps.getState();
    const command: FireCommand = {
      type: 'FIRE',
      playerId: state.currentPlayerId,
      turnId: state.turnId,
      weaponId: state.players[state.currentPlayerId].weaponId,
      startX: aim.originX,
      startY: aim.originY,
      velocityX: aim.velocityX,
      velocityY: aim.velocityY,
      seed: state.seed,
    };
    this.deps.commandBus.dispatch(command);
    // 相机去向由 ProjectileSystem.onLaunched 事件驱动（Phase 6）：
    // 发射 → PROJECTILE_FOLLOW，与 AI / 网络输入的行为完全一致
  }

  onCancel(_event: GesturePointerEvent): void {
    this.abort();
  }

  // ---- 内部 ---------------------------------------------------------------

  private deadZonePx(): number {
    return this.deps.isTouchProfile
      ? GAME_CONFIG.controls.touch.aimDeadZoneScreenPx
      : GAME_CONFIG.controls.desktop.aimDeadZoneScreenPx;
  }

  /** 死区通过后激活瞄准（发射原点取 claim 时的炮塔位置） */
  private activate(screenX: number, screenY: number): void {
    const origin = this.pendingOrigin;
    this.pending = null;
    this.pendingOrigin = null;
    if (!origin) {
      return;
    }
    this.aim = {
      active: true,
      originX: origin.x,
      originY: origin.y,
      pointerX: origin.x,
      pointerY: origin.y,
      ...calculateAim({
        originX: origin.x,
        originY: origin.y,
        pointerX: origin.x,
        pointerY: origin.y,
      }),
    };
    this.updateAim(screenX, screenY);
  }

  private updateAim(canvasX: number, canvasY: number): void {
    const world = this.canvasToWorld(canvasX, canvasY);
    this.aim = {
      ...this.aim,
      pointerX: world.x,
      pointerY: world.y,
      ...calculateAim({
        originX: this.aim.originX,
        originY: this.aim.originY,
        pointerX: world.x,
        pointerY: world.y,
      }),
    };
  }

  private abort(): void {
    this.aim = createInactiveAimState();
    this.pending = null;
    this.pendingOrigin = null;
  }

  /**
   * 画布（游戏）坐标 → 世界坐标。
   * InputRouter 已把指针统一换算到画布空间（真机修复：不再依赖
   * client 坐标 == 游戏坐标的假设），getWorldPoint 直接消费。
   */
  private canvasToWorld(canvasX: number, canvasY: number): Phaser.Math.Vector2 {
    return this.camera.getWorldPoint(canvasX, canvasY, this.tmpVec);
  }
}

function createInactiveAimState(): AimState {
  return {
    active: false,
    originX: 0,
    originY: 0,
    pointerX: 0,
    pointerY: 0,
    directionX: 0,
    directionY: 0,
    power: 0,
    velocityX: 0,
    velocityY: 0,
    canFire: false,
  };
}
