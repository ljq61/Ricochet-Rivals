import Phaser from 'phaser';
import {
  computeViewportMetrics,
  readSafeAreaInsets,
  type SafeAreaInsets,
  type ViewportMetrics,
} from './viewportMath';

export {
  computeViewportMetrics,
  readSafeAreaInsets,
} from './viewportMath';
export type {
  SafeAreaInsets,
  Orientation,
  ViewportMetrics,
  ViewportConfig,
} from './viewportMath';

/**
 * ViewportService — 响应式视口 + 动态相机缩放（Phase 6.5；真机修复后为
 * NONE 模式的唯一尺寸驱动者）。
 *
 * 职责（唯一 resize 枢纽）：
 * - 读取可见视口（visualViewport 优先 —— iOS 工具栏收起时可见区域
 *   才是玩家真实看到的）与 devicePixelRatio
 * - 高分屏清晰渲染：scale.resize(CSS×dpr) 把画布位图设为物理分辨率，
 *   scale.zoom = 1/dpr 把 CSS 显示尺寸缩回 —— 游戏坐标空间 = 物理像素
 * - 世界相机 zoom = 物理高度 / worldViewHeight（纵向构图稳定，
 *   可见世界纵向范围跨设备恒定 1080）
 * - 安全区 insets ×dpr 换算到游戏像素，随 metrics 供 HUD 布局消费
 * - resize / 旋转 / DPR 变化 / visualViewport 变化 → 全部收敛到
 *   applyViewport（幂等），通知订阅者（CameraController / HUD）
 *
 * 不改变任何 Gameplay 参数：World / Physics / Movement / Explosion 不感知设备。
 */

export type ViewportChangeHandler = (metrics: ViewportMetrics) => void;

export interface ViewportServiceOptions {
  /**
   * 相机模式（Phase 11）：
   * - true（Battle 场景，缺省）：世界相机 zoom = 物理高度 / worldViewHeight
   * - false（Menu / Result 等屏幕空间场景）：相机保持 zoom 1 + scroll 0，
   *   直接以物理像素屏幕坐标布局（uiScale 只影响尺寸手感）
   */
  worldCameraZoom?: boolean;
}

export class ViewportService {
  private readonly scene: Phaser.Scene;
  private readonly camera: Phaser.Cameras.Scene2D.Camera;
  private readonly handlers = new Set<ViewportChangeHandler>();
  private readonly worldCameraZoom: boolean;
  private metrics: ViewportMetrics;

  constructor(scene: Phaser.Scene, options?: ViewportServiceOptions) {
    this.scene = scene;
    this.camera = scene.cameras.main;
    this.worldCameraZoom = options?.worldCameraZoom ?? true;

    // 初始应用（在 BattleScene 创建相机控制器之前完成，
    // 保证后续所有 centerOnX / clamp 都基于正确 zoom 与物理坐标）
    this.metrics = this.applyViewport();

    window.addEventListener('resize', this.applyViewport);
    // iOS 工具栏收起 / 浏览器缩放等：visualViewport resize 比部分场景下的
    // window resize 更可靠
    window.visualViewport?.addEventListener('resize', this.applyViewport);
  }

  get current(): ViewportMetrics {
    return this.metrics;
  }

  /** 订阅视口变化（resize / 旋转 / DPR 变化后触发一次） */
  onChange(handler: ViewportChangeHandler): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  destroy(): void {
    window.removeEventListener('resize', this.applyViewport);
    window.visualViewport?.removeEventListener('resize', this.applyViewport);
    this.handlers.clear();
  }

  /**
   * 统一应用视口（幂等：尺寸未变时只重算 metrics 通知，不重复 setZoom）。
   * 所有尺寸来源收敛于此 —— Scale.NONE 模式下 Phaser 不自动跟随窗口。
   */
  private readonly applyViewport = (): ViewportMetrics => {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    // 可见视口（CSS px）：visualViewport = 玩家真实可见区域
    // （iOS 工具栏可见时更矮）；无 visualViewport 时用布局视口
    const cssWidth = Math.round(
      window.visualViewport?.width ??
        document.documentElement.clientWidth
    );
    const cssHeight = Math.round(
      window.visualViewport?.height ??
        document.documentElement.clientHeight
    );

    // 游戏坐标空间 = 物理像素：画布位图按物理分辨率出图（清晰），
    // CSS 显示尺寸经 zoom = 1/dpr 缩回
    const gameWidth = Math.round(cssWidth * dpr);
    const gameHeight = Math.round(cssHeight * dpr);

    const scale = this.scene.scale;
    if (scale.gameSize.width !== gameWidth ||
        scale.gameSize.height !== gameHeight) {
      scale.setZoom(1 / dpr);
      // NONE 模式专用：画布位图 = gameW/H（物理），
      // 并派发 RESIZE（相机随之 resize）
      scale.resize(gameWidth, gameHeight);
      // Phaser 只在 styleSize ≠ gameSize 时才写 canvas 样式（zoom=1 的
      // DPR1 桌面会跳过写入，导致 CSS 尺寸滞留在占位值 → 画布压扁）。
      // NONE 模式 = 手动布局：显示尺寸显式写死，确保位图与 CSS 同步
      const canvas = this.scene.game.canvas;
      canvas.style.width = `${cssWidth}px`;
      canvas.style.height = `${cssHeight}px`;
    } else if (scale.zoom !== 1 / dpr) {
      scale.setZoom(1 / dpr);
    }

    // 安全区（CSS px）× dpr → 游戏像素口径
    const insets = scaleInsets(readSafeAreaInsets(), dpr);
    const metrics = computeViewportMetrics(
      gameWidth,
      gameHeight,
      insets,
      undefined,
      dpr
    );

    // 世界相机 zoom：物理高度 / worldViewHeight —— 可见世界纵向范围恒定
    // （屏幕空间场景跳过：zoom 1 + scroll 0 = 物理像素屏幕坐标）
    if (this.worldCameraZoom) {
      this.camera.setZoom(metrics.zoom);
    }

    this.metrics = metrics;
    for (const handler of this.handlers) {
      handler(metrics);
    }
    return metrics;
  };
}

/** CSS px insets → 游戏像素 */
function scaleInsets(insets: SafeAreaInsets, dpr: number): SafeAreaInsets {
  return {
    top: insets.top * dpr,
    right: insets.right * dpr,
    bottom: insets.bottom * dpr,
    left: insets.left * dpr,
  };
}
