/** 将 value 限制在 [min, max] 区间 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * 将 current 以最大不超过 maxDelta 的步长向 target 靠拢。
 * 用于本地移动的加速 / 减速手感。
 */
export function moveToward(
  current: number,
  target: number,
  maxDelta: number
): number {
  if (Math.abs(target - current) <= maxDelta) {
    return target;
  }
  return current + Math.sign(target - current) * maxDelta;
}
