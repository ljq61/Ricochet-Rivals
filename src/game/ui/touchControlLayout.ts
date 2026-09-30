import type { ViewportMetrics } from '../platform/viewportMath';

export interface ScreenRect { x: number; y: number; width: number; height: number }
export const TOUCH_AIM_SIZE = 84;
export const TOUCH_AIM_MARGIN = 12;

export function touchAimRect(viewport: ViewportMetrics): ScreenRect {
  const { width, height, safeArea, uiScale } = viewport;
  const size = TOUCH_AIM_SIZE * uiScale;
  return {
    x: width - safeArea.right - (TOUCH_AIM_MARGIN + TOUCH_AIM_SIZE / 2) * uiScale,
    y: Math.max(safeArea.top + size / 2, Math.min(height / 2, height - safeArea.bottom - size / 2)),
    width: size,
    height: size,
  };
}

/** The caption is below the tappable image, but still needs clear visual space. */
export function touchAimVisualRect(viewport: ViewportMetrics): ScreenRect {
  const hit = touchAimRect(viewport);
  const captionHeight = 20 * viewport.uiScale;
  return { ...hit, y: hit.y + captionHeight / 2, height: hit.height + captionHeight };
}

/** Screen-space hit boxes stay usable when their world-space dock moves off screen. */
export function dockMoveButtonLayout(
  viewport: ViewportMetrics,
  dockLeft: number,
  dockRight: number,
  deckY: number,
  characterHeight: number,
): { visualSize: number; hitSize: number; left: ScreenRect; right: ScreenRect } {
  const { width, height, safeArea, uiScale } = viewport;
  const visualSize = characterHeight * 0.82;
  const hitSize = Math.max(48 * uiScale, visualSize);
  const gap = 8 * uiScale;
  const half = hitSize / 2;
  const minX = safeArea.left + half + gap;
  const maxX = width - safeArea.right - half - gap;
  // PlayerHud uses two 270px cards and reserves 110px between them.
  const hudScale = uiScale * Math.min(1, ((width - safeArea.left - safeArea.right) / uiScale - 110) / 540);
  const minY = safeArea.top + 83 * hudScale + gap + half;
  const maxY = height - safeArea.bottom - half - gap;
  const focusY = height - safeArea.bottom - 32 * uiScale;
  const reserved: ScreenRect[] = [
    touchAimVisualRect(viewport),
    { x: width / 2 - 24 * uiScale, y: focusY, width: 48 * uiScale, height: 48 * uiScale },
    { x: width / 2 + 24 * uiScale, y: focusY, width: 48 * uiScale, height: 48 * uiScale },
  ];
  const place = (desiredX: number, desiredY: number, lowX: number, highX: number): ScreenRect | null => {
    const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(n, hi));
    const xs = [desiredX, lowX, highX];
    const ys = [desiredY, minY, maxY];
    for (const rect of reserved) {
      xs.push(rect.x - rect.width / 2 - half - gap, rect.x + rect.width / 2 + half + gap);
      ys.push(rect.y - rect.height / 2 - half - gap, rect.y + rect.height / 2 + half + gap);
    }
    let best: ScreenRect | null = null;
    let distance = Infinity;
    let verticalDistance = Infinity;
    for (const candidateX of xs) for (const candidateY of ys) {
      const x = clamp(candidateX, lowX, highX);
      const y = clamp(candidateY, minY, maxY);
      const rect = { x, y, width: hitSize, height: hitSize };
      if (reserved.some((obstacle) => screenRectsOverlap(rect, obstacle, gap))) continue;
      const vertical = Math.abs(y - desiredY);
      const score = (x - desiredX) ** 2 + (y - desiredY) ** 2;
      // Keep both directions at deck height when a horizontal nudge is enough.
      if (vertical < verticalDistance - 1e-6 ||
          (Math.abs(vertical - verticalDistance) <= 1e-6 && score < distance)) {
        best = rect;
        distance = score;
        verticalDistance = vertical;
      }
    }
    return best;
  };
  const desiredY = deckY - visualSize / 2;
  // Reserve room for the other direction if both dock edges have left the viewport.
  let left = place(dockLeft - visualSize / 2 - gap, desiredY, minX, maxX - hitSize - gap)
    ?? { x: minX, y: maxY, width: hitSize, height: hitSize };
  reserved.push(left);
  let right = place(dockRight + visualSize / 2 + gap, desiredY, left.x + hitSize + gap, maxX);
  if (!right) {
    // A tiny viewport may have room only to the left of Aim; move the pair together.
    reserved.pop();
    left = place(minX, desiredY, minX, minX) ?? left;
    reserved.push(left);
    right = place(dockRight + visualSize / 2 + gap, desiredY, left.x + hitSize + gap, maxX);
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
