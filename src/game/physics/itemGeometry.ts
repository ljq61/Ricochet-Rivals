export interface Point { x: number; y: number }
export interface Rect { minX: number; maxX: number; minY: number; maxY: number }

/** First segment contact with a rectangle; null means no contact. */
export function segmentRectTime(from: Point, to: Point, rect: Rect): number | null {
  if (![from.x, from.y, to.x, to.y, rect.minX, rect.maxX, rect.minY, rect.maxY].every(Number.isFinite)) return null;
  let lo = 0;
  let hi = 1;
  for (const [start, delta, min, max] of [
    [from.x, to.x - from.x, rect.minX, rect.maxX],
    [from.y, to.y - from.y, rect.minY, rect.maxY],
  ] as const) {
    if (Math.abs(delta) < 1e-12) {
      if (start < min || start > max) return null;
    } else {
      const a = (min - start) / delta;
      const b = (max - start) / delta;
      lo = Math.max(lo, Math.min(a, b));
      hi = Math.min(hi, Math.max(a, b));
      if (lo > hi) return null;
    }
  }
  return lo;
}

export function pointRectDistance(point: Point, rect: Rect): number {
  return Math.hypot(Math.max(rect.minX - point.x, 0, point.x - rect.maxX),
    Math.max(rect.minY - point.y, 0, point.y - rect.maxY));
}

/** Exact rounded expansion: strips plus corner circles, not an oversized square. */
export function sweptCircleRectTime(from: Point, to: Point, rect: Rect, radius: number): number | null {
  if (![from.x, from.y, to.x, to.y, radius, rect.minX, rect.maxX, rect.minY, rect.maxY].every(Number.isFinite)) return null;
  if (pointRectDistance(from, rect) <= radius) return 0;
  const times: number[] = [];
  for (const expanded of [
    { ...rect, minX: rect.minX - radius, maxX: rect.maxX + radius },
    { ...rect, minY: rect.minY - radius, maxY: rect.maxY + radius },
  ]) {
    const t = segmentRectTime(from, to, expanded);
    if (t !== null) times.push(t);
  }
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const a = dx * dx + dy * dy;
  if (a > 0) for (const x of [rect.minX, rect.maxX]) for (const y of [rect.minY, rect.maxY]) {
    const fx = from.x - x;
    const fy = from.y - y;
    const b = 2 * (fx * dx + fy * dy);
    const c = fx * fx + fy * fy - radius * radius;
    const discriminant = b * b - 4 * a * c;
    if (discriminant < 0) continue;
    const t = (-b - Math.sqrt(discriminant)) / (2 * a);
    if (t >= 0 && t <= 1) times.push(t);
  }
  return times.length === 0 ? null : Math.min(...times);
}

export function along(from: Point, to: Point, t: number): Point {
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
}

export function pointSegmentDistance(point: Point, from: Point, to: Point): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const squared = dx * dx + dy * dy;
  const t = squared === 0 ? 0 : Math.max(0, Math.min(1,
    ((point.x - from.x) * dx + (point.y - from.y) * dy) / squared));
  const near = along(from, to, t);
  return Math.hypot(point.x - near.x, point.y - near.y);
}
