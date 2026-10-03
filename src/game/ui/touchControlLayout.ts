import type { ViewportMetrics } from '../platform/viewportMath';
import type { PlayerId } from '../state/ids';

import type { ScreenRect } from './touchAimLayout';
export { touchAimRect, touchAimVisualRect, TOUCH_AIM_SIZE, TOUCH_AIM_MARGIN } from './touchAimLayout';
export type { ScreenRect } from './touchAimLayout';

/** Both directions stay on the player's side of the screen as the world camera moves. */
export function screenMoveButtonLayout(
  viewport: ViewportMetrics,
  playerId: PlayerId = 'P1',
): { visualSize: number; hitSize: number; left: ScreenRect; right: ScreenRect } {
  const { width, height, safeArea, uiScale } = viewport;
  const visualSize = 44 * uiScale;
  const hitSize = 48 * uiScale;
  const half = hitSize / 2;
  const edgeInset = half + 8 * uiScale;
  const safeWidth = width - safeArea.left - safeArea.right;
  const y = Math.max(safeArea.top + half, height - safeArea.bottom - edgeInset);
  // The inner arrow stays at 40% of the safe width from the team's edge.
  // Layout depends only on the viewport, never on camera, player or dock motion.
  const innerInset = 0.4 * safeWidth;
  const blue = playerId === 'P1';
  const rect = (x: number): ScreenRect => ({ x, y, width: hitSize, height: hitSize });
  return {
    visualSize,
    hitSize,
    left: rect(blue ? safeArea.left + edgeInset : width - safeArea.right - innerInset),
    right: rect(blue ? safeArea.left + innerInset : width - safeArea.right - edgeInset),
  };
}

export function screenRectsOverlap(a: ScreenRect, b: ScreenRect, gap = 0): boolean {
  // Obstacle edge candidates have exactly the requested gap. Rounding in the
  // projection must not reject those candidates as a microscopic overlap.
  const epsilon = 1e-6;
  return (a.width + b.width) / 2 + gap - Math.abs(a.x - b.x) > epsilon &&
    (a.height + b.height) / 2 + gap - Math.abs(a.y - b.y) > epsilon;
}
