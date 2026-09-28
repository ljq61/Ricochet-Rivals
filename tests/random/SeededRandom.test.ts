import { describe, expect, it } from 'vitest';
import { SeededRandom } from '../../src/game/random/SeededRandom';

/**
 * SeededRandom（CODELY.md §16）：Mulberry32 确定性随机源。
 * 验收：同 seed 同序列 / 区间正确 / integer 闭区间边界。
 */

describe('SeededRandom（Mulberry32）', () => {
  it('同 seed 产生完全相同的序列', () => {
    const a = new SeededRandom(12345);
    const b = new SeededRandom(12345);
    for (let i = 0; i < 100; i++) {
      expect(a.next()).toBe(b.next());
    }
  });

  it('不同 seed 序列不同', () => {
    const a = Array.from({ length: 8 }, () => new SeededRandom(1).next());
    const b = Array.from({ length: 8 }, () => new SeededRandom(2).next());
    expect(a).not.toEqual(b);
  });

  it('next() 落在 [0, 1)', () => {
    const rng = new SeededRandom(7);
    for (let i = 0; i < 1000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('range(min, max) 落在区间内；min === max 恒等；参数反序自动交换', () => {
    const rng = new SeededRandom(42);
    for (let i = 0; i < 500; i++) {
      const v = rng.range(-8, 8);
      expect(v).toBeGreaterThanOrEqual(-8);
      expect(v).toBeLessThan(8);
    }
    expect(rng.range(5, 5)).toBe(5);
    for (let i = 0; i < 50; i++) {
      const v = rng.range(3, 1);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThan(3);
    }
  });

  it('integer(min, max) 闭区间且两端可达', () => {
    const rng = new SeededRandom(99);
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) {
      const v = rng.integer(1, 3);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(3);
      seen.add(v);
    }
    expect(seen.has(1)).toBe(true);
    expect(seen.has(3)).toBe(true);
    expect(rng.integer(2, 2)).toBe(2);
  });

  it('负 seed / 0 seed / 小数 seed 可用且确定', () => {
    const a = new SeededRandom(-5);
    const b = new SeededRandom(-5);
    expect(a.next()).toBe(b.next());
    expect(Number.isFinite(new SeededRandom(0).next())).toBe(true);
    const c = new SeededRandom(1.5);
    const d = new SeededRandom(1.5);
    expect(c.next()).toBe(d.next());
  });

  it('非有限输入安全返回 min（不抛异常）', () => {
    const rng = new SeededRandom(3);
    expect(rng.range(Number.NaN, 5)).toBeNaN();
    expect(rng.integer(Number.NaN, 5)).toBeNaN();
    expect(rng.range(Number.POSITIVE_INFINITY, 5)).toBe(
      Number.POSITIVE_INFINITY
    );
  });
});
