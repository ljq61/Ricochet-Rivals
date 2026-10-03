import Phaser from 'phaser';
import { playerColor } from '../config/Palette';
import { ART } from '../config/ArtAssets';
import { baseMoveButtonLayout } from '../ui/touchControlLayout';
import type { CommandBus } from '../commands/CommandBus';
import type { GameState } from '../state/GameState';
import { TurnPhase } from '../state/TurnPhase';
import type { PlayerId } from '../state/ids';
import type { ViewportService } from '../platform/ViewportService';
import type { InputRouter } from './InputRouter';
import { MoveInputCore } from './MoveInputCore';
import type { InputSource } from './InputSource';
import type { GestureKind } from './gesture';

/**
 * 触屏控制档位适配器（Phase 6.5，CODELY.md §25）。
 *
 * 组成（与 DesktopControls 同一 InputSource 门面，Gameplay 完全一致）：
 * - 大号 ◀ / ▶ 按住移动按钮（UI zone —— 屏幕实体按钮永远先于世界手势；
 *   多指各自追踪，按住加速 / 松开即停，与键盘共用 MoveInputCore 手感曲线）
 * - 控制目标 = 当前回合玩家（Phase 8 热座）
 * - 布局遵守 Safe Area（刘海 / 手势条方向 insets）
 *
 * 真机修复（高分屏清晰渲染）：游戏坐标 = 物理像素，
 * 所有屏幕手感常量（按钮尺寸 / 字号 / 边距）经 uiScale（= DPR）换算，
 * CSS 观感跨设备恒定；尺寸随视口变化（含 DPR 变化）重算。
 *
 * 说明：按钮既是 HUD 也是输入采集器（按下状态即"按键状态"），
 * 按 CODELY.md §25 归入 Input Adapter 层；AimButton 这类纯 UI
 * （只触发相机流程，不产生命令）仍在 ui/。
 * 所有移动仍以 MoveCommand 走 CommandBus → MovementSystem 校验，
 * 输入层不含规则。
 */

/** 屏幕手感常量（CSS px，运行时 ×uiScale） */
const MOVE_BUTTON_SIZE = 48;
interface TouchButton {
  id: string;
  kind: GestureKind;
  container: Phaser.GameObjects.Container;
  bg: Phaser.GameObjects.Graphics;
  /** 游戏像素尺寸（绘制用） */
  width: number;
  height: number;
  /** 游戏像素命中区尺寸（zone contains 用；≥ 视觉尺寸，命中区达 48 CSS px 下限） */
  hitWidth: number;
  hitHeight: number;
  /** 移动按钮方向（箭头重绘用） */
  direction: 'left' | 'right';
  /** 移动按钮箭头（缩放重绘用） */
  arrow: Phaser.GameObjects.Graphics | null;
  image: Phaser.GameObjects.Image | null;
  /** 移动按钮当前按下视觉状态 */
  pressed: boolean;
  /** 按住的 pointerId 集合（移动按钮多指追踪） */
  heldPointers: Set<number>;
  /** 世界锚点经过当前相机投影后的画面坐标；InputRouter 使用同一投影。 */
  screenX: number;
  screenY: number;
}

export interface TouchControlsDeps {
  getState: () => GameState;
  commandBus: CommandBus;
  router: InputRouter;
  viewport: ViewportService;
}

export class TouchControls implements InputSource {
  private readonly scene: Phaser.Scene;
  private readonly deps: TouchControlsDeps;
  private readonly core: MoveInputCore;
  private readonly unsubscribeViewport: () => void;

  private leftButton!: TouchButton;
  private rightButton!: TouchButton;
  /**
   * ◀ / ▶ 移动按钮可见（Phase 9 Review Gate：仅 ACTION 相位显示 ——
   * 点击「回到炮手 / 瞄准」即位置锁定并隐藏按钮，取消瞄准恢复）
   */
  private moveButtonsVisible = true;
  private lastVisualPlayerId: PlayerId | null = null;

  constructor(scene: Phaser.Scene, deps: TouchControlsDeps) {
    this.scene = scene;
    this.deps = deps;
    // 控制目标 = 当前回合玩家（Phase 8 热座）
    this.core = new MoveInputCore(
      () => deps.getState().currentPlayerId,
      deps.getState,
      deps.commandBus
    );

    this.leftButton = this.createHoldButton('touch-move-left', 'left');
    this.rightButton = this.createHoldButton('touch-move-right', 'right');
    this.reposition();

    this.unsubscribeViewport = deps.viewport.onChange(() => {
      this.reposition();
    });
  }

  get playerId(): PlayerId {
    return this.core.playerId;
  }

  /** ◀ / ▶ 移动按钮当前是否显示（E2E / 调试观测用） */
  get isMoveButtonsVisible(): boolean {
    return this.moveButtonsVisible;
  }

  /** 可见按钮中心（游戏像素，供触控回归测试取真实落点）。 */
  get moveButtonCenters(): { left: { x: number; y: number }; right: { x: number; y: number } } {
    this.updateScreenPosition(this.leftButton);
    this.updateScreenPosition(this.rightButton);
    return {
      left: { x: this.leftButton.screenX, y: this.leftButton.screenY },
      right: { x: this.rightButton.screenX, y: this.rightButton.screenY },
    };
  }

  /** 实际 Phaser 容器的世界中心，用于检查基地锚点和渲染投影。 */
  get moveButtonWorldCenters(): { left: { x: number; y: number }; right: { x: number; y: number } } {
    return {
      left: { x: this.leftButton.container.x, y: this.leftButton.container.y },
      right: { x: this.rightButton.container.x, y: this.rightButton.container.y },
    };
  }

  get moveButtonRenderState() {
    const read = (button: TouchButton) => {
      const container = button.container;
      // Copy immediately: Phaser reuses these matrices for the next object.
      const calc = Phaser.GameObjects.GetCalcMatrix(container, this.scene.cameras.main).calc;
      const renderX = calc.tx;
      const renderY = calc.ty;
      return { x: container.x, y: container.y,
        scrollFactorX: container.scrollFactorX, scrollFactorY: container.scrollFactorY,
        scaleX: container.scaleX, scaleY: container.scaleY, renderX, renderY };
    };
    return { left: read(this.leftButton), right: read(this.rightButton) };
  }

  /** 视觉和触控尺寸分开观测，避免图片缩小后丢失最小触控面积。 */
  get moveButtonSizes(): { visual: number; hit: number } {
    return { visual: this.leftButton.width, hit: this.leftButton.hitWidth };
  }

  setEnabled(enabled: boolean): void {
    this.core.setEnabled(enabled);
  }

  update(deltaMs: number): void {
    const leftHeld = this.leftButton.heldPointers.size > 0;
    const rightHeld = this.rightButton.heldPointers.size > 0;
    this.core.setDirection(
      ((rightHeld ? 1 : 0) - (leftHeld ? 1 : 0)) as -1 | 0 | 1
    );
    this.core.update(deltaMs);
  }

  /**
   * 每帧由 BattleScene 驱动：
   * - ◀ / ▶ 移动按钮仅 ACTION 相位显示（Phase 9 Review Gate：
   *   点击瞄准按钮后位置锁定 —— MovementSystem 同步拒绝 RETURN_HOME /
   *   AIM 移动；按钮隐藏 + zone 失活，取消瞄准回 ACTION 自动恢复）
   * - moveAllowed（Phase 14 联机）：对手回合 = false → 移动按钮隐藏
   *   离线不传不变。
   */
  refresh(moveAllowed = true): void {
    this.repositionMoveButtons();
    const visualPlayerId = this.deps.getState().currentPlayerId;
    if (visualPlayerId !== this.lastVisualPlayerId) {
      this.lastVisualPlayerId = visualPlayerId;
      this.drawHoldButton(this.leftButton);
      this.drawHoldButton(this.rightButton);
    }
    const moveVisible =
      this.deps.getState().phase === TurnPhase.ACTION && moveAllowed;
    if (moveVisible !== this.moveButtonsVisible) {
      this.moveButtonsVisible = moveVisible;
      for (const button of [this.leftButton, this.rightButton]) {
        button.container.setVisible(moveVisible);
        if (!moveVisible) {
          // 隐藏即松手：清掉按住追踪，防止隐藏期间残留按压状态
          button.heldPointers.clear();
          button.pressed = false;
        }
        this.drawHoldButton(button);
      }
    }
  }

  destroy(): void {
    this.unsubscribeViewport();
    for (const button of this.allButtons()) {
      this.deps.router.unregisterZone(button.id);
      button.container.destroy();
      button.heldPointers.clear();
    }
    this.core.setEnabled(false);
  }

  // ---- 创建 ------------------------------------------------------------

  private createHoldButton(
    id: string,
    direction: 'left' | 'right'
  ): TouchButton {
    // kind = 'UI'：屏幕实体按钮永远先于世界手势（AIM 起始半径可能覆盖
    // 到按钮区域，按住按钮移动时绝不能被误判为开始瞄准）；
    // 语义产出是 MOVEMENT 命令，走 MoveInputCore → CommandBus。
    const button = this.createButton(id, 'UI', MOVE_BUTTON_SIZE, direction);
    if (this.scene.textures.exists(ART.moveArrow)) {
      button.image = this.scene.add.image(0, 0, ART.moveArrow, 'button')
        .setFlipX(direction === 'left');
      button.container.add(button.image);
    }
    button.arrow = this.scene.add.graphics();
    button.container.add(button.arrow);
    this.drawArrow(button);
    this.drawHoldButton(button);
    this.registerHoldZone(button);
    return button;
  }

  private createButton(
    id: string,
    kind: GestureKind,
    baseSize: number,
    direction: 'left' | 'right'
  ): TouchButton {
    const container = this.scene.add.container(0, 0).setScrollFactor(1).setDepth(900);
    const bg = this.scene.add.graphics();
    container.add(bg);

    return {
      id,
      kind,
      container,
      bg,
      width: baseSize,
      height: baseSize,
      hitWidth: baseSize,
      hitHeight: baseSize,
      direction,
      arrow: null,
      image: null,
      pressed: false,
      heldPointers: new Set<number>(),
      screenX: 0,
      screenY: 0,
    };
  }

  // ---- 绘制 ------------------------------------------------------------

  private drawArrow(button: TouchButton): void {
    if (!button.arrow || !button.direction) {
      return;
    }
    const arrow = button.arrow;
    arrow.clear();
    const half = button.width * 0.29;
    const tipX = button.direction === 'left' ? -half : half;
    const baseX = button.direction === 'left' ? half : -half;
    arrow.fillStyle(0xe8eef7, 0.95);
    arrow.fillTriangle(tipX, 0, baseX, -half * 0.75, baseX, half * 0.75);
  }

  private drawHoldButton(button: TouchButton): void {
    const { width, pressed } = button;
    const ui = this.deps.viewport.current.uiScale;
    const accent = playerColor(this.deps.getState().currentPlayerId);
    if (button.image) {
      button.bg.clear();
      button.arrow?.setVisible(false);
      const size = width * (pressed ? 0.94 : 1);
      button.image.setDisplaySize(size, size).setTint(pressed ? 0xffffff : 0xe6e6e6);
      button.container.setAlpha(1);
      return;
    }
    // 实体金属控制盘：背景不透，队伍色外环；按压亮起内圈。
    const r = width / 2;
    button.bg.clear();
    button.bg.fillStyle(0x0b111a, 1);
    button.bg.fillCircle(0, 0, r);
    button.bg.fillStyle(0x233547, 1);
    button.bg.fillCircle(0, 0, r - 4 * ui);
    button.bg.fillStyle(pressed ? accent : 0x172331, pressed ? 0.8 : 1);
    button.bg.fillCircle(0, 0, r - 9 * ui);
    if (pressed) {
      button.bg.fillStyle(0xffffff, 0.15);
      button.bg.fillCircle(0, 0, r - 12 * ui);
    }
    button.bg.lineStyle(3 * ui, accent, 1).strokeCircle(0, 0, r - 2 * ui);
    button.container.setAlpha(1);
  }

  // ---- 布局（Safe Area + uiScale） ---------------------------------------

  private reposition(): void {
    this.repositionMoveButtons();
  }

  /** 基地默认视角决定世界锚点；拖动镜头时按钮和基地一起离开画面。 */
  private repositionMoveButtons(): void {
    const playerId = this.deps.getState().currentPlayerId;
    const layout = baseMoveButtonLayout(this.deps.viewport.current, playerId);
    for (const [button, position] of [
      [this.leftButton, layout.left], [this.rightButton, layout.right],
    ] as const) {
      button.hitWidth = layout.hitSize;
      button.hitHeight = layout.hitSize;
      if (button.width !== layout.visualSize) {
        button.width = layout.visualSize;
        button.height = layout.visualSize;
        this.drawArrow(button);
        this.drawHoldButton(button);
      }
      button.container.setScale(1 / this.scene.cameras.main.zoom).setPosition(position.x, position.y);
      this.updateScreenPosition(button);
    }
  }

  /** 与 Phaser 世界相机相同的投影，画面落点与触控命中区始终重合。 */
  private updateScreenPosition(button: TouchButton): void {
    const camera = this.scene.cameras.main;
    const originX = camera.width * camera.originX;
    const originY = camera.height * camera.originY;
    button.screenX = camera.x + originX +
      (button.container.x - camera.scrollX - originX) * camera.zoom;
    button.screenY = camera.y + originY +
      (button.container.y - camera.scrollY - originY) * camera.zoom;
  }

  private allButtons(): TouchButton[] {
    return [
      this.leftButton,
      this.rightButton,
    ];
  }

  // ---- zone 事件（hold 按钮） -------------------------------------------

  /** hold 按钮的 zone：按下开始按住，抬起 / 打断结束；随可见性失活 */
  private registerHoldZone(button: TouchButton): void {
    this.deps.router.registerZone({
      id: button.id,
      kind: button.kind,
      isActive: () => this.moveButtonsVisible,
      contains: (x, y) => {
        // Pointer events can arrive between scene updates after a camera drag.
        this.updateScreenPosition(button);
        return containsButton(button, x, y);
      },
      onDown: (event) => {
        button.heldPointers.add(event.pointerId);
        button.pressed = true;
        this.drawHoldButton(button);
      },
      onUp: (event) => {
        button.heldPointers.delete(event.pointerId);
        button.pressed = button.heldPointers.size > 0;
        this.drawHoldButton(button);
      },
      onCancel: (event) => {
        button.heldPointers.delete(event.pointerId);
        button.pressed = button.heldPointers.size > 0;
        this.drawHoldButton(button);
      },
    });
  }
}

function containsButton(
  button: TouchButton,
  x: number,
  y: number
): boolean {
  const cx = button.screenX;
  const cy = button.screenY;
  // 命中区（hitWidth/hitHeight ≥ 视觉尺寸，至少 48 CSS px）
  return (
    x >= cx - button.hitWidth / 2 &&
    x <= cx + button.hitWidth / 2 &&
    y >= cy - button.hitHeight / 2 &&
    y <= cy + button.hitHeight / 2
  );
}
