import { describe, expect, it } from 'vitest';
import { GAME_CONFIG } from '../../src/game/config/GameConfig';
import {
  solveTrajectory,
  velocityFromAngleSpeed,
} from '../../src/game/ai/TrajectorySolver';

/**
 * TrajectorySolver（Phase 10）：45° 驻点 + 力度一维二分。
 * 验收：出生位对射可命中 / 近距离 / 远距离 / 超射程 null /
 * 异常输入安全短路 / 与 GameConfig 参数一致。
 */

const GROUND_Y = GAME_CONFIG.world.groundTopY; // 960
const LAUNCH_Y = GROUND_Y + GAME_CONFIG.player.launcher.offsetY; // 912
const { minLaunchSpeed, maxLaunchSpeed } = GAME_CONFIG.aiming;
const GRAVITY = GAME_CONFIG.physics.gravityY;

/** 独立数值积分（不复用求解器公式）验证解析解落点 */
function simulateLandingX(
  startX: number,
  startY: number,
  vx: number,
  vy: number
): number {
  const dt = 0.0005;
  let t = 0;
  let prevX = startX;
  let prevY = startY;
  for (let i = 0; i < 20000; i++) {
    t += dt;
    const x = startX + vx * t;
    const y = startY + vy * t + 0.5 * GRAVITY * t * t;
    if (y >= GROUND_Y) {
      // 线性回插穿越点
      const f = (GROUND_Y - prevY) / (y - prevY);
      return prevX + (x - prevX) * f;
    }
    prevX = x;
    prevY = y;
  }
  return prevX;
}

describe('solveTrajectory', () => {
  it('出生位对射（P1→P2）：有解，落点在直伤半径内，速度在合法区间', () => {
    const s = solveTrajectory({
      originX: GAME_CONFIG.player.spawn.P1,
      originY: LAUNCH_Y,
      targetX: GAME_CONFIG.player.spawn.P2,
    });
    expect(s).not.toBeNull();
    expect(s!.speed).toBeGreaterThanOrEqual(minLaunchSpeed);
    expect(s!.speed).toBeLessThanOrEqual(maxLaunchSpeed);
    expect(Math.abs(s!.predictedLandingX - GAME_CONFIG.player.spawn.P2)).toBeLessThanOrEqual(
      GAME_CONFIG.explosion.directDamageRadius
    );
    expect(s!.angleDeg).toBe(45);
    expect(s!.velocityX).toBeGreaterThan(0);
    expect(s!.velocityY).toBeLessThan(0);
  });

  it('反向（P2→P1）：angle 135°，velocityX < 0', () => {
    const s = solveTrajectory({
      originX: GAME_CONFIG.player.spawn.P2,
      originY: LAUNCH_Y,
      targetX: GAME_CONFIG.player.spawn.P1,
    });
    expect(s).not.toBeNull();
    expect(s!.angleDeg).toBe(135);
    expect(s!.velocityX).toBeLessThan(0);
    expect(s!.velocityY).toBeLessThan(0);
  });

  it('解与独立数值积分一致（predictedLandingX 真实可复现）', () => {
    const s = solveTrajectory({
      originX: 450,
      originY: LAUNCH_Y,
      targetX: 4550,
    });
    expect(s).not.toBeNull();
    const sim = simulateLandingX(450, LAUNCH_Y, s!.velocityX, s!.velocityY);
    expect(Math.abs(sim - s!.predictedLandingX)).toBeLessThan(2);
  });

  it('近距离（~400px）可解', () => {
    const s = solveTrajectory({ originX: 100, originY: LAUNCH_Y, targetX: 500 });
    expect(s).not.toBeNull();
    expect(Math.abs(s!.predictedLandingX - 500)).toBeLessThanOrEqual(60);
  });

  it('最远阵地间距（100 → 4900，4800px）可解', () => {
    const s = solveTrajectory({ originX: 100, originY: LAUNCH_Y, targetX: 4900 });
    expect(s).not.toBeNull();
    expect(Math.abs(s!.predictedLandingX - 4900)).toBeLessThanOrEqual(60);
    expect(s!.speed).toBeLessThanOrEqual(maxLaunchSpeed);
  });

  it('超射程（> 最大 45° 射程）返回 null', () => {
    expect(
      solveTrajectory({ originX: 100, originY: LAUNCH_Y, targetX: 100 + 8000 })
    ).toBeNull();
  });

  it('过近（< 最小落点偏移 − 容差）返回 null', () => {
    expect(
      solveTrajectory({ originX: 450, originY: LAUNCH_Y, targetX: 500 })
    ).toBeNull();
  });

  it('异常输入安全短路（NaN / Infinity / 同 x），有限迭代不抛异常', () => {
    expect(
      solveTrajectory({ originX: Number.NaN, originY: LAUNCH_Y, targetX: 500 })
    ).toBeNull();
    expect(
      solveTrajectory({ originX: 450, originY: Number.NaN, targetX: 500 })
    ).toBeNull();
    expect(
      solveTrajectory({
        originX: 450,
        originY: LAUNCH_Y,
        targetX: Number.POSITIVE_INFINITY,
      })
    ).toBeNull();
    expect(
      solveTrajectory({ originX: 450, originY: LAUNCH_Y, targetX: 450 })
    ).toBeNull();
    expect(
      solveTrajectory({
        originX: 450,
        originY: LAUNCH_Y,
        targetX: 4550,
        tolerancePx: Number.NaN,
      })
    ).toBeNull();
  });

  it('velocityFromAngleSpeed：正角向上，与人类拖拽产物同构', () => {
    const v = velocityFromAngleSpeed(45, 1000);
    expect(v.velocityX).toBeCloseTo(Math.SQRT1_2 * 1000, 6);
    expect(v.velocityY).toBeCloseTo(-Math.SQRT1_2 * 1000, 6);
    const left = velocityFromAngleSpeed(135, 1000);
    expect(left.velocityX).toBeCloseTo(-Math.SQRT1_2 * 1000, 6);
    expect(Math.hypot(left.velocityX, left.velocityY)).toBeCloseTo(1000, 6);
  });
});
