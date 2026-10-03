import type { ViewportMetrics } from '../platform/viewportMath';
import type { PlayerId } from '../state/ids';
import { GAME_CONFIG } from '../config/GameConfig';
import { clampCameraCenterX, groundAnchoredCenterY } from '../camera/cameraBounds';
import { baseDockGeometry } from '../utils/baseDockGeometry';

import type { ScreenRect } from './touchAimLayout';
export { touchAimRect, touchAimVisualRect, TOUCH_AIM_SIZE, TOUCH_AIM_MARGIN } from './touchAimLayout';
export type { ScreenRect } from './touchAimLayout';

/** The team-side layout in the default, ground-anchored view of its base. */
export function screenMoveButtonLayout(
  viewport: ViewportMetrics,
  playerId: PlayerId = 'P1',
): { visualSize: number; hitSize: number; left: ScreenRect; right: ScreenRect } {
  const { width, height, safeArea, uiScale } = viewport;
  const visualSize = 44 * uiScale;
  const hitSize = 48 * uiScale;
  const half = hitSize / 2;
  const edgeInset = half + 8 * uiScale;
  const y = Math.max(safeArea.top + half, height - safeArea.bottom - edgeInset);
  const { center, dockWidth } = baseDockGeometry(playerId);
  const homeCenterX = clampCameraCenterX(GAME_CONFIG.player.spawn[playerId],
    viewport.visibleWorldWidth, GAME_CONFIG.world.width);
  const projectX = (worldX: number) => width / 2 + (worldX - homeCenterX) * viewport.zoom;
  const leftEdge = center - dockWidth / 2;
  const rightEdge = center + dockWidth / 2;
  const blue = playerId === 'P1';
  // The inner arrow follows the actual deck edge, including short/wide views.
  // Only the outer arrow's default-view position receives safe-area padding;
  // the resulting world anchor is never clamped against a panned camera.
  const outerX = blue
    ? Math.max(safeArea.left + edgeInset, projectX(leftEdge) + visualSize / 2)
    : Math.min(width - safeArea.right - edgeInset, projectX(rightEdge) - visualSize / 2);
  const rect = (x: number): ScreenRect => ({ x, y, width: hitSize, height: hitSize });
  return {
    visualSize,
    hitSize,
    left: rect(blue ? outerX : projectX(leftEdge)),
    right: rect(blue ? projectX(rightEdge) : outerX),
  };
}

/**
 * Place the reference controls in the world once, relative to the base's home
 * view. Panning and character movement never alter these world anchors; resize
 * recalculates the reference view so its safe-area spacing remains usable.
 */
export function baseMoveButtonLayout(viewport: ViewportMetrics, playerId: PlayerId) {
  const reference = screenMoveButtonLayout(viewport, playerId);
  const centerX = clampCameraCenterX(GAME_CONFIG.player.spawn[playerId],
    viewport.visibleWorldWidth, GAME_CONFIG.world.width);
  const centerY = groundAnchoredCenterY(viewport.visibleWorldHeight, GAME_CONFIG.world.height);
  const toWorld = (rect: ScreenRect): ScreenRect => ({
    x: centerX + (rect.x - viewport.width / 2) / viewport.zoom,
    y: centerY + (rect.y - viewport.height / 2) / viewport.zoom,
    width: rect.width / viewport.zoom,
    height: rect.height / viewport.zoom,
  });
  return { visualSize: reference.visualSize, hitSize: reference.hitSize,
    left: toWorld(reference.left), right: toWorld(reference.right) };
}

export function screenRectsOverlap(a: ScreenRect, b: ScreenRect, gap = 0): boolean {
  // Obstacle edge candidates have exactly the requested gap. Rounding in the
  // projection must not reject those candidates as a microscopic overlap.
  const epsilon = 1e-6;
  return (a.width + b.width) / 2 + gap - Math.abs(a.x - b.x) > epsilon &&
    (a.height + b.height) / 2 + gap - Math.abs(a.y - b.y) > epsilon;
}
