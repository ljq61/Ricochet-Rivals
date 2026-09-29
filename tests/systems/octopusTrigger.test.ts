import { describe, expect, it } from 'vitest';
import { shouldOctopusEmerge } from '../../src/game/systems/octopusTrigger';
import { GAME_CONFIG } from '../../src/game/config/GameConfig';

const T = GAME_CONFIG.octopus.hpThreshold;

describe('shouldOctopusEmerge（中央章鱼触手出现条件）', () => {
  it('双方血量健康 → 不出现', () => {
    expect(shouldOctopusEmerge(10, 10)).toBe(false);
    expect(shouldOctopusEmerge(T + 1, T + 1)).toBe(false);
    expect(shouldOctopusEmerge(T + 1, 10)).toBe(false);
  });

  it('任一方 HP ≤ 阈值 → 出现（含恰好等于）', () => {
    expect(shouldOctopusEmerge(T, 10)).toBe(true);
    expect(shouldOctopusEmerge(10, T)).toBe(true);
    expect(shouldOctopusEmerge(T, T)).toBe(true);
  });

  it('死亡（HP 0）与负值兜底 → 出现', () => {
    expect(shouldOctopusEmerge(0, 10)).toBe(true);
    expect(shouldOctopusEmerge(10, 0)).toBe(true);
    expect(shouldOctopusEmerge(-1, 10)).toBe(true);
  });

  it('阈值语义：随血量下降只会从 false 单调翻转为 true', () => {
    let sawFlip = false;
    for (let hp = GAME_CONFIG.player.maxHp; hp >= 0; hp--) {
      const emerges = shouldOctopusEmerge(hp, hp);
      if (!sawFlip && emerges) {
        // 翻转点必须恰好在阈值
        expect(hp).toBe(T);
        sawFlip = true;
      }
      if (sawFlip) {
        expect(emerges).toBe(true);
      }
    }
    expect(sawFlip).toBe(true);
  });
});
