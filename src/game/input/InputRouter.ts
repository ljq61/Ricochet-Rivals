import Phaser from 'phaser';
import {
  GestureArbiter,
  type GestureClaimant,
  type GesturePointerEvent,
  type GestureZone,
} from './gesture';

/**
 * InputRouter — 平台统一指针入口（Phase 6.5）。
 *
 * 事件源选择 window 级 Pointer Events（统一鼠标 / 触摸 / 触控笔，
 * 天然携带 pointerId 供多指仲裁），与 Phase 1 定型的拖拽持续方案一致：
 * MouseManager 默认只监听 Canvas，鼠标移出 Canvas 会丢失 move/up
 * 导致拖拽卡死。Phaser Unified Pointer 保持用于键盘与右键
 * （CameraHotkeys），指针手势生命周期统一走本路由。
 *
 * 坐标换算（真机实测修复）：zone 命中 / 世界交互全部使用画布坐标 ——
 * 经 canvas.getBoundingClientRect() 把 client 坐标换算到游戏空间。
 * 手机浏览器上画布实际位置 / 尺寸可能与页面坐标空间有偏差
 * （固定定位百分比链、工具栏、旋转时序等），
 * 直接用 clientX/Y 比对游戏坐标会导致"点击落在别处"。
 *
 * 手势从 pointerdown 到 pointerup / pointercancel 由 GestureArbiter
 * 按优先级仲裁（UI > AIM > MOVEMENT > CAMERA），
 * 同一 Pointer 只属于一个 Gesture Owner。
 *
 * 防误触：pointerdown 仅在 event.target === canvas 时受理 ——
 * DOM 覆盖层（横屏提示）显示时手势自然被拦截。
 * window blur → 所有手势按 cancel 释放。
 */
export class InputRouter {
  private readonly arbiter = new GestureArbiter();
  private readonly scene: Phaser.Scene;
  private readonly canvas: HTMLCanvasElement;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.canvas = scene.game.canvas;

    window.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerCancel);
    // 拖动中切走窗口 / 失焦时必须结束手势，避免"按钮卡住"
    window.addEventListener('blur', this.onWindowBlur);
  }

  registerZone(zone: GestureZone): void {
    this.arbiter.registerZone(zone);
  }

  unregisterZone(id: string): void {
    this.arbiter.unregisterZone(id);
  }

  registerClaimant(claimant: GestureClaimant): void {
    this.arbiter.registerClaimant(claimant);
  }

  /** 强制释放所有手势（场景 SHUTDOWN 时调用） */
  releaseAll(): void {
    this.arbiter.releaseAll();
  }

  destroy(): void {
    this.releaseAll();
    window.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerCancel);
    window.removeEventListener('blur', this.onWindowBlur);
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    // DOM 覆盖层（横屏提示等）拦截：手势只能从 Canvas 开始
    if (event.target !== this.canvas) {
      return;
    }
    this.arbiter.onPointerDown(toGestureEvent(event, this.scene));
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    const gestureEvent = toGestureEvent(event, this.scene);
    this.arbiter.onPointerMove(gestureEvent);
    // 只有鼠标有悬停语义；触摸移动不触发 hover
    if (event.pointerType === 'mouse') {
      this.arbiter.notifyHover(gestureEvent);
    }
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    this.arbiter.onPointerUp(toGestureEvent(event, this.scene));
  };

  private readonly onPointerCancel = (event: PointerEvent): void => {
    this.arbiter.onPointerCancel(toGestureEvent(event, this.scene));
  };

  private readonly onWindowBlur = (): void => {
    this.arbiter.releaseAll();
  };
}

/**
 * client 坐标 → 画布（游戏）坐标。
 * 画布恰好铺满视口时为恒等变换（桌面 / headless E2E 均如此）；
 * 画布被缩放 / 偏移时保证输入与画面在同一空间。
 */
function toGestureEvent(
  event: PointerEvent,
  scene: Phaser.Scene
): GesturePointerEvent {
  const canvas = scene.game.canvas;
  const rect = canvas.getBoundingClientRect();
  const gameWidth = scene.scale.gameSize.width;
  const gameHeight = scene.scale.gameSize.height;
  const scaleX = rect.width > 0 ? gameWidth / rect.width : 1;
  const scaleY = rect.height > 0 ? gameHeight / rect.height : 1;
  return {
    pointerId: event.pointerId,
    pointerType: event.pointerType,
    button: event.button,
    x: (event.clientX - rect.left) * scaleX,
    y: (event.clientY - rect.top) * scaleY,
    clientX: event.clientX,
    clientY: event.clientY,
  };
}
