import { describe, expect, it } from 'vitest';
import {
  isProjectileArmed,
  isProjectileExpired,
  isProjectileOutOfBounds,
} from '../../src/game/physics/projectileRules';
import { GAME_CONFIG } from '../../src/game/config/GameConfig';

const WORLD_W = GAME_CONFIG.world.width;
const WORLD_H = GAME_CONFIG.world.height;

describe('isProjectileOutOfBounds', () => {
  it('世界内正常飞行不算出界', () => {
    expect(isProjectileOutOfBounds({ x: 2500, y: 500 }, WORLD_W, WORLD_H)).toBe(false);
  });

  it('高于世界顶部不算出界（抛物线会自然回落）', () => {
    expect(isProjectileOutOfBounds({ x: 2500, y: -200 }, WORLD_W, WORLD_H)).toBe(false);
  });

  it('飞出左/右边界（含 margin 容差）即出界', () => {
    expect(isProjectileOutOfBounds({ x: -70, y: 500 }, WORLD_W, WORLD_H)).toBe(true);
    expect(isProjectileOutOfBounds({ x: WORLD_W + 70, y: 500 }, WORLD_W, WORLD_H)).toBe(true);
    // margin 内仍视为在场
    expect(isProjectileOutOfBounds({ x: -30, y: 500 }, WORLD_W, WORLD_H)).toBe(false);
  });

  it('低于地面以下（穿地兜底）出界', () => {
    expect(isProjectileOutOfBounds({ x: 2500, y: WORLD_H + 70 }, WORLD_W, WORLD_H)).toBe(true);
  });
});

describe('isProjectileExpired', () => {
  it('达到最大生命周期即超时（8s）', () => {
    expect(isProjectileExpired(7999, GAME_CONFIG.physics.projectileLifetimeMs)).toBe(false);
    expect(isProjectileExpired(8000, GAME_CONFIG.physics.projectileLifetimeMs)).toBe(true);
  });
});

describe('isProjectileArmed（引信距离）', () => {
  it('未达引信距离不激活（避免出生点在炮手碰撞体内自爆）', () => {
    expect(isProjectileArmed({ x: 450, y: 900 }, 450, 900, 100)).toBe(false);
    expect(isProjectileArmed({ x: 520, y: 900 }, 450, 900, 100)).toBe(false);
  });

  it('达到引信距离后激活', () => {
    expect(isProjectileArmed({ x: 560, y: 900 }, 450, 900, 100)).toBe(true);
    // 斜向距离也算：dx=70, dy=-80 → dist≈110
    expect(isProjectileArmed({ x: 520, y: 820 }, 450, 900, 100)).toBe(true);
  });
});
