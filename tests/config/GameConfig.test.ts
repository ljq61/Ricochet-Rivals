import { describe, expect, it } from 'vitest';
import { GAME_CONFIG } from '../../src/game/config/GameConfig';

/**
 * GameConfig 完整性守卫：
 * 防止调参时改坏关键不变量（出生点必须在阵地内、阵地必须在地图内等）。
 */
describe('GAME_CONFIG integrity', () => {
  const { world, player } = GAME_CONFIG;

  it('出生点位于各自阵地范围内', () => {
    expect(player.spawn.P1).toBeGreaterThanOrEqual(player.leftBounds.minX);
    expect(player.spawn.P1).toBeLessThanOrEqual(player.leftBounds.maxX);
    expect(player.spawn.P2).toBeGreaterThanOrEqual(player.rightBounds.minX);
    expect(player.spawn.P2).toBeLessThanOrEqual(player.rightBounds.maxX);
  });

  it('双方阵地位于世界范围内且互不重叠', () => {
    expect(player.leftBounds.minX).toBeGreaterThanOrEqual(0);
    expect(player.leftBounds.maxX).toBeLessThanOrEqual(world.width);
    expect(player.rightBounds.minX).toBeGreaterThanOrEqual(0);
    expect(player.rightBounds.maxX).toBeLessThanOrEqual(world.width);
    expect(player.leftBounds.maxX).toBeLessThan(player.rightBounds.minX);
  });

  it('地面在世界的垂直范围内', () => {
    expect(world.groundTopY).toBeGreaterThan(0);
    expect(world.groundTopY).toBeLessThan(world.height);
  });

  it('瞄准参数保持有效区间', () => {
    const { aiming } = GAME_CONFIG;
    expect(aiming.minPower).toBeGreaterThan(0);
    expect(aiming.minPower).toBeLessThan(1);
    expect(aiming.minLaunchSpeed).toBeLessThan(aiming.maxLaunchSpeed);
    expect(aiming.maxDragDistance).toBeGreaterThan(0);
    expect(aiming.previewPoints).toBeGreaterThan(0);
  });

  it('物理与爆炸参数保持有效区间', () => {
    expect(GAME_CONFIG.physics.gravityY).toBeGreaterThan(0);
    expect(GAME_CONFIG.physics.projectileLifetimeMs).toBeGreaterThan(0);
    expect(GAME_CONFIG.explosion.radius).toBeGreaterThan(
      GAME_CONFIG.explosion.directDamageRadius
    );
    expect(GAME_CONFIG.explosion.directDamage).toBeGreaterThan(
      GAME_CONFIG.explosion.splashDamage
    );
    expect(GAME_CONFIG.explosion.splashDamage).toBeGreaterThan(0);
  });

  it('每回合移动距离与生命值为正', () => {
    expect(player.maxMovePerTurn).toBeGreaterThan(0);
    expect(player.maxHp).toBeGreaterThan(0);
  });

  it('AI 参数保持有效区间（Phase 10：表现延迟有序、尽力弹仰角合理、三档误差单调递减）', () => {
    const { ai } = GAME_CONFIG;
    expect(ai.thinkDelayMs.min).toBeGreaterThan(0);
    expect(ai.thinkDelayMs.min).toBeLessThan(ai.thinkDelayMs.max);
    expect(ai.postMoveDelayMs.min).toBeGreaterThan(0);
    expect(ai.postMoveDelayMs.min).toBeLessThan(ai.postMoveDelayMs.max);
    // 尽力弹仰角：低弹道朝敌（0° 水平会贴地自炸风险，>90° 朝后）
    expect(ai.fallbackAngleDeg).toBeGreaterThan(0);
    expect(ai.fallbackAngleDeg).toBeLessThanOrEqual(90);

    const { easy, normal, hard } = ai.difficulties;
    for (const level of [easy, normal, hard]) {
      expect(level.aimErrorDeg).toBeGreaterThanOrEqual(0);
      expect(level.powerErrorRatio).toBeGreaterThanOrEqual(0);
      expect(level.powerErrorRatio).toBeLessThan(1);
    }
    // 难度单调：误差随难度收紧
    expect(easy.aimErrorDeg).toBeGreaterThan(normal.aimErrorDeg);
    expect(normal.aimErrorDeg).toBeGreaterThan(hard.aimErrorDeg);
    expect(easy.powerErrorRatio).toBeGreaterThan(normal.powerErrorRatio);
    expect(normal.powerErrorRatio).toBeGreaterThan(hard.powerErrorRatio);
    // CODELY.md §18：Normal = ±8° / ±12%
    expect(normal.aimErrorDeg).toBe(8);
    expect(normal.powerErrorRatio).toBeCloseTo(0.12, 6);
  });
});
