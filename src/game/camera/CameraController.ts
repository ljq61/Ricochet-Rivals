import Phaser from 'phaser';
import { CameraMode } from './CameraMode';
import { clampCameraCenterX, groundAnchoredCenterY } from './cameraBounds';
import { exponentialApproach } from './cameraMotion';
import {
  modeAfterReturnHome,
  nextModeOnAimCancel,
  nextModeOnAimRequest,
} from './aimFlow';
import { GAME_CONFIG } from '../config/GameConfig';
import type { GestureClaimant, GesturePointerEvent } from '../input/gesture';

/** 跟随目标读取器（炮弹被销毁时返回 null，相机保持原位） */
export type FollowTargetProvider = () => { x: number; y: number } | null;

/**
 * Camera 状态机控制器（CODELY.md §8/§9，Phase 6.5 视口适配）。
 *
 * 模式行为：
 * - FREE_VIEW：单指 / 鼠标拖动横向移动，clamp 在 World Bounds 内，垂直贴地；
 *   支持 panToX 快捷聚焦（TouchControls 己方 / 敌方按钮）
 * - RETURN_HOME：Tween 回当前炮手（350ms），完成自动进入 AIMING
 * - AIMING：锁定当前炮手（每帧居中跟随），禁止拖动
 * - PROJECTILE_FOLLOW：指数平滑跟随炮弹（帧率无关，不硬锁）；
 *   水平 clamp 在 World Bounds，垂直自由（炮弹可飞出世界上沿）
 * - IMPACT：平滑贴向爆炸点并停留约 850ms；停留结束（或模式被外部
 *   接管）时 resolve focusImpact 的 Promise，由调用方决定去向
 * - TURN_TRANSITION：Phase 8 实现
 *
 * Phase 6.5 变化：
 * - 相机数学以「中心（世界坐标）」为锚：Phaser zoom 围绕视口中心缩放，
 *   midPoint = scroll + viewport/2 与 zoom 无关（见 cameraBounds.ts）。
 *   由此 ViewportService 的动态 zoom 不影响任何边界语义。
 * - 拖动事件全部交给 InputRouter 仲裁（GestureClaimant）：
 *   tryClaim/onMove/onUp/onCancel；控制器自身不再持有 DOM 监听。
 *   UI > AIM > MOVEMENT > CAMERA 的优先级由 GestureArbiter 保证，
 *   点击 HUD 按钮不会再误开相机拖动（无需 hitTestPointer）。
 * - 拖动速度按 1/zoom 换算：世界位移 = 屏幕位移 / zoom。
 */
export class CameraController implements GestureClaimant {
  readonly kind = 'CAMERA' as const;

  private readonly scene: Phaser.Scene;
  private readonly camera: Phaser.Cameras.Scene2D.Camera;
  private readonly canvas: HTMLCanvasElement;

  private mode: CameraMode = CameraMode.FREE_VIEW;

  /** AIMING 锁定目标（当前玩家 x 的读取器，玩家移动时保持跟随） */
  private aimTargetXProvider: (() => number) | null = null;

  /** PROJECTILE_FOLLOW 目标读取器 */
  private followTargetProvider: FollowTargetProvider | null = null;

  /** IMPACT 爆炸点与停留计时 */
  private impactTarget: { x: number; y: number } | null = null;
  private impactStayElapsedMs = 0;
  private impactStayResolver: (() => void) | null = null;

  private returnTween: Phaser.Tweens.Tween | null = null;
  private panTween: Phaser.Tweens.Tween | null = null;

  /** TURN_TRANSITION：回合切换平移 Tween + 到位回调（Phase 8） */
  private transitionTween: Phaser.Tweens.Tween | null = null;
  private transitionResolver: (() => void) | null = null;

  /** 拖动状态（所有权由 InputRouter 管理，这里只维护锚点） */
  private dragging = false;
  private dragAnchorScreenX = 0;
  private dragStartCenterX = 0;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.camera = scene.cameras.main;
    this.canvas = scene.game.canvas;
    this.canvas.style.cursor = 'grab';
  }

  get currentMode(): CameraMode {
    return this.mode;
  }

  get scrollX(): number {
    return this.camera.scrollX;
  }

  // ---- 视口（zoom）适配 --------------------------------------------------

  /** 可见世界宽度（相机坐标换算：viewport / zoom） */
  private get visibleWorldWidth(): number {
    return this.camera.width / this.camera.zoom;
  }

  private get visibleWorldHeight(): number {
    return this.camera.height / this.camera.zoom;
  }

  /** 视口变化（resize / 方向变化后 zoom 已由 ViewportService 更新）：
   *  停止过期的平移 Tween，并把当前中心重新 clamp 进 World Bounds */
  onViewportChanged(): void {
    this.stopPanTween();
    this.setCenterX(this.getCenterX());
    this.anchorVerticalToGround();
  }

  // ---- 模式控制 ----------------------------------------------------------

  /** 切换 Camera 模式（内部使用；外部流程走 requestAim / cancelAim 等） */
  setMode(mode: CameraMode): void {
    this.mode = mode;
    this.stopReturnTween();
    this.stopPanTween();
    this.stopTransitionTween();
    // 模式被接管时立即结束 IMPACT 停留 / TURN_TRANSITION（Promise 提前 resolve）
    this.resolveImpactStay();
    this.endDrag();
    this.updateCursor();
  }

  enableFreeView(): void {
    this.setMode(CameraMode.FREE_VIEW);
  }

  /**
   * 发起瞄准（CODELY.md §9）：
   * FREE_VIEW → RETURN_HOME（Tween 到当前炮手）→ AIMING。
   */
  requestAim(getTargetX: () => number): void {
    const next = nextModeOnAimRequest(this.mode);
    if (!next) {
      return;
    }
    this.aimTargetXProvider = getTargetX;
    this.setMode(next);

    this.returnTween = this.scene.tweens.add({
      targets: this.camera,
      scrollX: this.centerToScroll(clampCameraCenterX(
        getTargetX(),
        this.visibleWorldWidth,
        GAME_CONFIG.world.width
      )),
      duration: GAME_CONFIG.camera.returnHomeDurationMs,
      ease: 'Sine.easeOut',
      onComplete: () => {
        this.returnTween = null;
        const after = modeAfterReturnHome(this.mode);
        if (after) {
          this.setMode(after);
        }
      },
    });
  }

  /** 取消瞄准：AIMING / RETURN_HOME → FREE_VIEW */
  cancelAim(): void {
    const next = nextModeOnAimCancel(this.mode);
    if (!next) {
      return;
    }
    this.aimTargetXProvider = null;
    this.setMode(next);
  }

  /** PROJECTILE_FOLLOW：平滑跟随目标（发射后由 launch 事件触发） */
  followProjectile(getTarget: FollowTargetProvider): void {
    this.followTargetProvider = getTarget;
    this.setMode(CameraMode.PROJECTILE_FOLLOW);
  }

  /**
   * IMPACT：平滑贴向爆炸点并停留约 850ms。
   * Promise 在停留结束时 resolve；若期间模式被外部接管则立即 resolve。
   * 调用方（BattleScene / Phase 8 的 TurnManager）决定后续去向。
   */
  focusImpact(target: { x: number; y: number }): Promise<void> {
    this.impactTarget = target;
    this.impactStayElapsedMs = 0;
    this.setMode(CameraMode.IMPACT);
    return new Promise<void>((resolve) => {
      this.impactStayResolver = resolve;
    });
  }

  /** 将相机水平居中到指定世界坐标（初始定位 / AIMING 跟随复用） */
  centerOnX(worldX: number): void {
    this.setCenterX(worldX);
  }

  /**
   * 爆炸反馈：相机抖动（Phase 7）。
   * Phaser Shake 是渲染矩阵偏移（preRender 阶段应用），
   * 不污染 scroll / 中心语义，与本控制器的每帧 clamp 天然兼容。
   */
  shake(): void {
    this.camera.shake(
      GAME_CONFIG.explosion.shakeDurationMs,
      GAME_CONFIG.explosion.shakeIntensity
    );
  }

  /**
   * FREE_VIEW 快捷聚焦：平滑平移到世界坐标（TouchControls 己方 / 敀方按钮）。
   * 新拖动 / 模式切换会打断平移。
   */
  panToX(worldX: number): void {
    if (this.mode !== CameraMode.FREE_VIEW) {
      return;
    }
    this.stopPanTween();
    this.panTween = this.scene.tweens.add({
      targets: this.camera,
      scrollX: this.centerToScroll(clampCameraCenterX(
        worldX,
        this.visibleWorldWidth,
        GAME_CONFIG.world.width
      )),
      duration: GAME_CONFIG.camera.panDurationMs,
      ease: 'Sine.easeOut',
      onComplete: () => {
        this.panTween = null;
      },
    });
  }

  /**
   * TURN_TRANSITION（Phase 8，CODELY.md §8）：回合切换 —— 相机平滑移动到
   * 新玩家，完成后自动回 FREE_VIEW 并 resolve（场景据此进入下一回合
   * ACTION）。模式被外部接管时提前 resolve（stale 安全，同 focusImpact）。
   */
  transitionToPlayer(getTargetX: () => number): Promise<void> {
    this.stopTransitionTween();
    this.setMode(CameraMode.TURN_TRANSITION);
    return new Promise<void>((resolve) => {
      this.transitionResolver = resolve;
      this.transitionTween = this.scene.tweens.add({
        targets: this.camera,
        scrollX: this.centerToScroll(
          clampCameraCenterX(
            getTargetX(),
            this.visibleWorldWidth,
            GAME_CONFIG.world.width
          )
        ),
        duration: GAME_CONFIG.camera.turnTransitionDurationMs,
        ease: 'Sine.easeInOut',
        onComplete: () => {
          this.transitionTween = null;
          this.setMode(CameraMode.FREE_VIEW);
        },
      });
    });
  }

  // ---- GestureClaimant（InputRouter → CAMERA） ---------------------------

  /** 无副作用探测：FREE_VIEW 时认领该指针并开始拖动 */
  tryClaim(event: GesturePointerEvent): boolean {
    if (this.mode !== CameraMode.FREE_VIEW || this.dragging) {
      return false;
    }
    this.dragging = true;
    this.dragAnchorScreenX = event.x;
    this.dragStartCenterX = this.getCenterX();
    this.stopPanTween();
    this.canvas.style.cursor = 'grabbing';
    return true;
  }

  onMove(event: GesturePointerEvent): void {
    if (!this.dragging) {
      return;
    }
    // 反向拖拽惯例：向左拖 → 画面向右移；世界位移 = 屏幕位移 / zoom
    const screenDeltaX = event.x - this.dragAnchorScreenX;
    this.setCenterX(this.dragStartCenterX - screenDeltaX / this.camera.zoom);
  }

  onUp(_event: GesturePointerEvent): void {
    this.endDrag();
  }

  onCancel(_event: GesturePointerEvent): void {
    this.endDrag();
  }

  // ---- 每帧更新 ----------------------------------------------------------

  update(deltaMs: number): void {
    switch (this.mode) {
      case CameraMode.FREE_VIEW:
        // 垂直贴地（窗口尺寸变化时自愈）；水平由拖动控制
        this.anchorVerticalToGround();
        break;

      case CameraMode.AIMING:
        if (this.aimTargetXProvider) {
          this.centerOnX(this.aimTargetXProvider());
        }
        this.anchorVerticalToGround();
        break;

      case CameraMode.TURN_TRANSITION:
        // 水平由 Tween 驱动；垂直贴地自愈
        this.anchorVerticalToGround();
        break;

      case CameraMode.PROJECTILE_FOLLOW: {
        const target = this.followTargetProvider?.() ?? null;
        if (target) {
          this.smoothApproach(
            target,
            GAME_CONFIG.camera.projectileFollowRate,
            deltaMs
          );
        }
        break;
      }

      case CameraMode.IMPACT: {
        const target = this.impactTarget;
        if (target) {
          this.smoothApproach(
            target,
            GAME_CONFIG.camera.impactFocusRate,
            deltaMs
          );
        }
        this.impactStayElapsedMs += deltaMs;
        if (this.impactStayElapsedMs >= GAME_CONFIG.camera.impactStayMs) {
          this.resolveImpactStay();
        }
        break;
      }

      default:
        break;
    }
  }

  /** Phase 6.5 起控制器无 DOM 监听（InputRouter 统一持有）；保留对称清理 */
  destroy(): void {
    this.stopReturnTween();
    this.stopPanTween();
    this.stopTransitionTween();
    this.resolveImpactStay();
    this.endDrag();
  }

  // ---- 内部 ------------------------------------------------------------

  /** 相机中心（世界坐标）—— zoom 无关的稳定锚点 */
  private getCenterX(): number {
    return this.camera.scrollX + this.camera.width / 2;
  }

  private setCenterX(worldCenterX: number): void {
    const clamped = clampCameraCenterX(
      worldCenterX,
      this.visibleWorldWidth,
      GAME_CONFIG.world.width
    );
    this.camera.scrollX = this.centerToScroll(clamped);
  }

  private setCenterY(worldCenterY: number): void {
    this.camera.scrollY = worldCenterY - this.camera.height / 2;
  }

  private centerToScroll(worldCenterX: number): number {
    return worldCenterX - this.camera.width / 2;
  }

  /** 垂直贴地：可见区域底边对齐 World 底部（地面所在区域） */
  private anchorVerticalToGround(): void {
    this.setCenterY(
      groundAnchoredCenterY(
        this.visibleWorldHeight,
        GAME_CONFIG.world.height
      )
    );
  }

  private smoothApproach(
    target: { x: number; y: number },
    rate: number,
    deltaMs: number
  ): void {
    const targetCenterX = clampCameraCenterX(
      target.x,
      this.visibleWorldWidth,
      GAME_CONFIG.world.width
    );
    // 垂直不 clamp：炮弹可飞出世界上沿，相机需跟随到天空
    const targetCenterY = target.y;

    const nextCenterX = exponentialApproach(
      this.getCenterX(),
      targetCenterX,
      rate,
      deltaMs
    );
    const nextCenterY = exponentialApproach(
      this.camera.scrollY + this.camera.height / 2,
      targetCenterY,
      rate,
      deltaMs
    );
    this.camera.scrollX = this.centerToScroll(
      clampCameraCenterX(
        nextCenterX,
        this.visibleWorldWidth,
        GAME_CONFIG.world.width
      )
    );
    this.setCenterY(nextCenterY);
  }

  private resolveImpactStay(): void {
    if (this.impactStayResolver) {
      const resolve = this.impactStayResolver;
      this.impactStayResolver = null;
      resolve();
    }
  }

  private stopReturnTween(): void {
    if (this.returnTween) {
      this.returnTween.stop();
      this.returnTween = null;
    }
  }

  private stopPanTween(): void {
    if (this.panTween) {
      this.panTween.stop();
      this.panTween = null;
    }
  }

  /** 停止回合切换平移并提前 resolve（模式接管 / 销毁时） */
  private stopTransitionTween(): void {
    if (this.transitionTween) {
      this.transitionTween.stop();
      this.transitionTween = null;
    }
    if (this.transitionResolver) {
      const resolve = this.transitionResolver;
      this.transitionResolver = null;
      resolve();
    }
  }

  private updateCursor(): void {
    this.canvas.style.cursor =
      this.mode === CameraMode.FREE_VIEW
        ? 'grab'
        : this.mode === CameraMode.AIMING
          ? 'crosshair'
          : 'default';
  }

  private endDrag(): void {
    if (!this.dragging) {
      return;
    }
    this.dragging = false;
    this.updateCursor();
  }
}
