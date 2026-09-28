/**
 * 相机平滑运动纯函数（帧率无关）。
 *
 * 指数逼近：每秒按 rate 比例向目标收敛，
 * 任意 deltaMs 下与多帧小步进结果一致（时间可加性），
 * 用于 PROJECTILE_FOLLOW / IMPACT 的平滑跟随（CODELY.md §8：不要瞬间硬锁）。
 */
export function exponentialApproach(
  current: number,
  target: number,
  ratePerSecond: number,
  deltaMs: number
): number {
  if (ratePerSecond <= 0) {
    return current;
  }
  const alpha = 1 - Math.exp((-ratePerSecond * deltaMs) / 1000);
  return current + (target - current) * alpha;
}
