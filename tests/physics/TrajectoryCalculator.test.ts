import { describe, expect, it } from 'vitest';
import { calculateTrajectory } from '../../src/game/physics/TrajectoryCalculator';

describe('calculateTrajectory', () => {
  const base = {
    startX: 500,
    startY: 900,
    gravityX: 0,
    gravityY: 1000,
  };

  it('返回 steps 个点，首点 t=0 在起点，末点 t=duration', () => {
    const points = calculateTrajectory({ ...base, velocityX: 800, velocityY: -600, duration: 0.8, steps: 12 });

    expect(points).toHaveLength(12);
    expect(points[0]!.time).toBe(0);
    expect(points[0]!.x).toBe(500);
    expect(points[0]!.y).toBe(900);
    expect(points[11]!.time).toBeCloseTo(0.8, 6);
  });

  it('无重力时为匀速直线：x(t) = startX + vx·t', () => {
    const points = calculateTrajectory({ ...base, velocityX: 100, velocityY: 0, gravityX: 0, gravityY: 0, duration: 1, steps: 5 });

    expect(points[2]!.time).toBe(0.5);
    expect(points[2]!.x).toBeCloseTo(500 + 100 * 0.5, 6);
    expect(points[2]!.y).toBe(900);
  });

  it('重力抛体公式：y(t) = startY + vy·t + ½·g·t²', () => {
    const points = calculateTrajectory({ ...base, velocityX: 0, velocityY: -400, duration: 0.8, steps: 9 });

    // t = 0.4s（第 4 个点，dt = 0.1）
    const p = points[4]!;
    expect(p.time).toBeCloseTo(0.4, 6);
    expect(p.y).toBeCloseTo(900 + (-400) * 0.4 + 0.5 * 1000 * 0.16, 6);
    // x 不受重力影响
    expect(p.x).toBe(500);
  });

  it('垂直上抛先升后降（vy < 0，g > 0）', () => {
    const points = calculateTrajectory({ ...base, velocityX: 0, velocityY: -800, duration: 1.6, steps: 17 });
    const yValues = points.map((p) => p.y);

    // 顶点附近（t = 0.8s）应低于（数值上小于）两端
    const apex = Math.min(...yValues);
    expect(apex).toBeLessThan(yValues[0]!);
    expect(apex).toBeLessThan(yValues[16]!);
  });

  it('steps = 1 边界：只返回起点，无 NaN', () => {
    const points = calculateTrajectory({ ...base, velocityX: 100, velocityY: 100, duration: 0.8, steps: 1 });

    expect(points).toHaveLength(1);
    expect(points[0]!.x).toBe(500);
    expect(points[0]!.y).toBe(900);
    expect(points[0]!.time).toBe(0);
  });
});
