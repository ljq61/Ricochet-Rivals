import { GAME_CONFIG } from '../config/GameConfig';
import { clamp } from '../utils/MathUtils';

/**
 * Viewport 纯计算（Phase 6.5，零 Phaser 依赖，可单测）。
 *
 * Viewport 策略（CODELY.md §25）：
 * - 纵向构图稳定：所有设备显示相同的世界纵向范围（worldViewHeight）
 * - zoom = gameHeight / worldViewHeight（clamp 到 [minZoom, maxZoom]）
 * - 19.5:9 / 20:9 超宽手机：纵向构图不变，自然看到更多横向世界
 * - 桌面 1080p（DPR 1）：zoom = 1，与 Phase 1～6 行为完全一致
 *
 * 高分屏清晰渲染（真机修复）：游戏坐标空间 = **物理像素**
 * （gameSize = CSS × devicePixelRatio，画布位图按物理分辨率出图），
 * 显示时经 scale.zoom = 1/dpr 缩回 CSS 尺寸 —— iPhone 3x 屏不再
 * 被浏览器拉伸位图导致发糊。HUD / 字号等"屏幕手感"常量 ×uiScale。
 *
 * 不改变任何 Gameplay 参数：World / Physics / Movement / Explosion 不感知设备。
 */

export interface SafeAreaInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export type Orientation = 'landscape' | 'portrait';

export interface ViewportMetrics {
  /** 画布尺寸（游戏/物理像素） */
  width: number;
  height: number;
  /** 相机缩放（纵向构图锚定；物理像素口径） */
  zoom: number;
  /** 可见世界范围（世界坐标） */
  visibleWorldWidth: number;
  visibleWorldHeight: number;
  orientation: Orientation;
  /** 安全区（游戏/物理像素口径，供 HUD 布局直接消费） */
  safeArea: SafeAreaInsets;
  /**
   * UI 缩放 = 游戏像素 ÷ CSS 像素 = devicePixelRatio。
   * HUD 尺寸 / 字号等屏幕手感常量须 ×uiScale。
   */
  uiScale: number;
}

export interface ViewportConfig {
  viewport: { worldViewHeight: number; minZoom: number; maxZoom: number };
}

/**
 * 纯函数：由画布尺寸 + 安全区计算视口指标。
 * width/height 为游戏（物理）像素；zoom = height / worldViewHeight；
 * uiScale = devicePixelRatio（默认 1，桌面 DPR1 / headless）。
 */
export function computeViewportMetrics(
  width: number,
  height: number,
  safeArea: SafeAreaInsets,
  config: ViewportConfig = GAME_CONFIG,
  uiScale: number = 1
): ViewportMetrics {
  const zoom = clamp(
    height / config.viewport.worldViewHeight,
    config.viewport.minZoom,
    config.viewport.maxZoom
  );
  return {
    width,
    height,
    zoom,
    visibleWorldWidth: width / zoom,
    visibleWorldHeight: height / zoom,
    orientation: width >= height ? 'landscape' : 'portrait',
    safeArea,
    uiScale,
  };
}

/**
 * DOM 探测 env(safe-area-inset-*)（返回 CSS 像素，DOM 真值）。
 * 用一个 fixed 探针元素测量安全矩形（需要 meta viewport 带
 * viewport-fit=cover，否则 insets 恒为 0）。
 */
export function readSafeAreaInsets(): SafeAreaInsets {
  if (typeof document === 'undefined') {
    return { top: 0, right: 0, bottom: 0, left: 0 };
  }
  const probe = document.createElement('div');
  probe.style.cssText = [
    'position:fixed',
    'top:env(safe-area-inset-top,0px)',
    'left:env(safe-area-inset-left,0px)',
    'right:env(safe-area-inset-right,0px)',
    'bottom:env(safe-area-inset-bottom,0px)',
    'visibility:hidden',
    'pointer-events:none',
  ].join(';');
  document.body.appendChild(probe);
  const rect = probe.getBoundingClientRect();
  probe.remove();

  // 探针矩形即安全区矩形：insets = 视口边缘 − 安全矩形边缘
  const left = Math.max(0, rect.left);
  const top = Math.max(0, rect.top);
  const right = Math.max(0, window.innerWidth - rect.right);
  const bottom = Math.max(0, window.innerHeight - rect.bottom);
  return { top, right, bottom, left };
}
