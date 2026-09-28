/**
 * SeededRandom（CODELY.md §16）：Mulberry32 确定性随机源。
 *
 * 所有影响 Gameplay 的随机必须经由 RandomSource —— 禁止 Gameplay 使用
 * Math.random()（纯视觉粒子除外）。AI 误差 / 未来 Items / Map Random
 * 全部从此取数；同 seed 必产生完全相同的序列（可重放 / 可测试）。
 *
 * 零依赖、可独立单测。
 */

export interface RandomSource {
  /** [0, 1) 均匀分布 */
  next(): number;

  /** [min, max) 均匀分布（min === max 时恒等） */
  range(min: number, max: number): number;

  /** [min, max] 闭区间整数（含两端） */
  integer(min: number, max: number): number;
}

/** Mulberry32：32bit 状态，快且质量足够 Gameplay 使用 */
export class SeededRandom implements RandomSource {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(min: number, max: number): number {
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      return min;
    }
    if (max < min) {
      [min, max] = [max, min];
    }
    return min + (max - min) * this.next();
  }

  integer(min: number, max: number): number {
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      return min;
    }
    if (max < min) {
      [min, max] = [max, min];
    }
    // 闭区间：span + 1 个整数等概率；外层 min 兜底浮点边界
    return Math.min(max, Math.floor(min + (max - min + 1) * this.next()));
  }
}
