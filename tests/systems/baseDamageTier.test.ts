import { describe, expect, it } from 'vitest';
import { hpToBaseDamageTier } from '../../src/game/systems/baseDamageTier';
import { GAME_CONFIG } from '../../src/game/config/GameConfig';

const [T1, T2, T3, T4] = GAME_CONFIG.baseDamageFx.hpThresholds;

describe('hpToBaseDamageTier（基地受损档位）', () => {
  it('满血与高血量 → 档 0（完好无烟）', () => {
    expect(hpToBaseDamageTier(GAME_CONFIG.player.maxHp)).toBe(0);
    expect(hpToBaseDamageTier(T1 + 1)).toBe(0);
  });

  it('各档阈值边界：HP ≤ 阈值进入该档', () => {
    expect(hpToBaseDamageTier(T1)).toBe(1);
    expect(hpToBaseDamageTier(T2)).toBe(2);
    expect(hpToBaseDamageTier(T3)).toBe(3);
    expect(hpToBaseDamageTier(T4)).toBe(4);
  });

  it('档内区间单调递进（逐 HP 全表核对）', () => {
    const expected: Record<number, number> = {
      10: 0, 9: 0,
      8: 1, 7: 1,
      6: 2, 5: 2,
      4: 3, 3: 3,
      2: 4, 1: 4,
    };
    for (const [hp, tier] of Object.entries(expected)) {
      expect(hpToBaseDamageTier(Number(hp))).toBe(tier);
    }
  });

  it('死亡（HP 0）→ 档 4（大火大烟）', () => {
    expect(hpToBaseDamageTier(0)).toBe(4);
  });

  it('阶梯语义：血量越少档位越高、从不回退', () => {
    let last = 0;
    for (let hp = GAME_CONFIG.player.maxHp; hp >= 0; hp--) {
      const tier = hpToBaseDamageTier(hp);
      expect(tier).toBeGreaterThanOrEqual(last);
      last = tier;
    }
  });
});
