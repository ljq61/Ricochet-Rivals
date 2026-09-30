import type { ViewportMetrics } from '../platform/viewportMath';
import type { PlayerId } from '../state/ids';

export interface ScreenRect { x: number; y: number; width: number; height: number }
export const TOUCH_AIM_SIZE = 64;
export const TOUCH_AIM_MARGIN = 12;

export function touchAimRect(viewport: ViewportMetrics, playerId: PlayerId = 'P1'): ScreenRect {
  const { width, height, safeArea, uiScale } = viewport;
  const size = TOUCH_AIM_SIZE * uiScale;
  return {
    x: playerId === 'P2'
      ? safeArea.left + (TOUCH_AIM_MARGIN + TOUCH_AIM_SIZE / 2) * uiScale
      : width - safeArea.right - (TOUCH_AIM_MARGIN + TOUCH_AIM_SIZE / 2) * uiScale,
    y: Math.max(safeArea.top + size / 2, Math.min(height / 2, height - safeArea.bottom - size / 2)),
    width: size,
    height: size,
  };
}

/** The caption is below the tappable image, but still needs clear visual space. */
export function touchAimVisualRect(viewport: ViewportMetrics, playerId: PlayerId = 'P1'): ScreenRect {
  const hit = touchAimRect(viewport, playerId);
  const captionHeight = 20 * viewport.uiScale;
  return { ...hit, y: hit.y + captionHeight / 2, height: hit.height + captionHeight };
}
