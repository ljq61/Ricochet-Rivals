import type { ViewportMetrics } from '../platform/viewportMath';
import type { PlayerId } from '../state/ids';

import { touchAimVisualRect, type ScreenRect } from './touchAimLayout';
import { battleItemDock, battleSettingsRect } from './battleSideDockLayout';
import { battleHudLayout } from './miniMapMath';
export { touchAimRect, touchAimVisualRect, TOUCH_AIM_SIZE, TOUCH_AIM_MARGIN } from './touchAimLayout';
export type { ScreenRect } from './touchAimLayout';

/** Screen-space controls stay anchored to the safe bottom corners as the camera moves. */
export function screenMoveButtonLayout(
  viewport: ViewportMetrics,
  playerId: PlayerId = 'P1',
): { visualSize: number; hitSize: number; left: ScreenRect; right: ScreenRect } {
  const { width, height, safeArea, uiScale } = viewport;
  const visualSize = 44 * uiScale;
  const hitSize = 48 * uiScale;
  const gap = 8 * uiScale;
  const half = hitSize / 2;
  const minX = safeArea.left + half + gap;
  const maxX = width - safeArea.right - half - gap;
  // PlayerHud uses two 270px cards and reserves 110px between them.
  const hudScale = uiScale * Math.min(1, ((width - safeArea.left - safeArea.right) / uiScale - 110) / 540);
  const minY = safeArea.top + 83 * hudScale + gap + half;
  const maxY = height - safeArea.bottom - half - gap;
  const itemDock = battleItemDock(viewport, playerId);
  const reserved: ScreenRect[] = [
    ...(itemDock.bag ? [itemDock.bag] : []), ...itemDock.slots,
    battleSettingsRect(viewport),
    touchAimVisualRect(viewport, playerId),
    battleHudLayout(viewport, playerId).banner,
  ];
  const place = (desiredX: number, desiredY: number, lowX: number, highX: number, clearance = gap): ScreenRect | null => {
    const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(n, hi));
    const lowY = minY - (gap - clearance);
    // The extreme-height retry can use the whole safe area without shrinking
    // the touch target; the normal layout retains its 8px bottom margin.
    const highY = clearance === gap ? maxY : height - safeArea.bottom - half;
    const xs = [desiredX, lowX, highX];
    const ys = [desiredY, lowY, highY];
    for (const rect of reserved) {
      xs.push(rect.x - rect.width / 2 - half - clearance, rect.x + rect.width / 2 + half + clearance);
      ys.push(rect.y - rect.height / 2 - half - clearance, rect.y + rect.height / 2 + half + clearance);
    }
    let best: ScreenRect | null = null;
    let distance = Infinity;
    let verticalDistance = Infinity;
    for (const candidateX of xs) for (const candidateY of ys) {
      const x = clamp(candidateX, lowX, highX);
      const y = clamp(candidateY, lowY, highY);
      const rect = { x, y, width: hitSize, height: hitSize };
      if (reserved.some((obstacle) => screenRectsOverlap(rect, obstacle, clearance))) continue;
      const vertical = Math.abs(y - desiredY);
      const score = (x - desiredX) ** 2 + (y - desiredY) ** 2;
      // Keep controls at the bottom when a horizontal nudge clears a side dock.
      if (vertical < verticalDistance - 1e-6 ||
          (Math.abs(vertical - verticalDistance) <= 1e-6 && score < distance)) {
        best = rect;
        distance = score;
        verticalDistance = vertical;
      }
    }
    return best;
  };
  const desiredY = maxY;
  // Reserve room for the other direction before placing either screen control.
  let left = place(minX, desiredY, minX, maxX - hitSize - gap)
    ?? { x: minX, y: maxY, width: hitSize, height: hitSize };
  reserved.push(left);
  let right = place(maxX, desiredY, left.x + hitSize + gap, maxX);
  if (!right) {
    // A short surface may fit only one direction on the bottom row. Try the
    // upper free area for Left instead of falling back on top of Aim or items.
    reserved.pop();
    left = place(minX, minY, minX, maxX - hitSize - gap) ?? left;
    reserved.push(left);
    right = place(maxX, desiredY, left.x + hitSize + gap, maxX);
  }
  if (!right && (height - safeArea.top - safeArea.bottom) / uiScale < 220) {
    // Browser chrome can leave too little height for the usual 8px clearance.
    // Keep both 48px touch targets, reducing only the separation to 4px.
    const clearance = 4 * uiScale;
    reserved.pop();
    for (const leftY of [desiredY, minY]) {
      const candidate = place(minX, leftY, minX, maxX - hitSize - clearance, clearance);
      if (!candidate) continue;
      reserved.push(candidate);
      const candidateRight = place(maxX, desiredY, candidate.x + hitSize + clearance, maxX, clearance);
      reserved.pop();
      if (candidateRight) {
        left = candidate;
        right = candidateRight;
        break;
      }
    }
  }
  right ??= { x: maxX, y: maxY, width: hitSize, height: hitSize };
  return { visualSize, hitSize, left, right };
}

export function screenRectsOverlap(a: ScreenRect, b: ScreenRect, gap = 0): boolean {
  // Obstacle edge candidates have exactly the requested gap. Rounding in the
  // projection must not reject those candidates as a microscopic overlap.
  const epsilon = 1e-6;
  return (a.width + b.width) / 2 + gap - Math.abs(a.x - b.x) > epsilon &&
    (a.height + b.height) / 2 + gap - Math.abs(a.y - b.y) > epsilon;
}
