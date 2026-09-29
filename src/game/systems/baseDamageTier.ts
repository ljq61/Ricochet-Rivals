import { GAME_CONFIG } from '../config/GameConfig';

/**
 * 基地受损档位（纯函数，可单测）：
 * 0=完好 / 1=轻烟 / 2=浓烟 / 3=烟+小火 / 4=大火大烟。
 * 阈值在 GameConfig.baseDamageFx（HP ≤ 阈值进入对应档）。
 */
export function hpToBaseDamageTier(hp: number): number {
  const thresholds = GAME_CONFIG.baseDamageFx.hpThresholds;
  for (let tier = thresholds.length; tier >= 1; tier--) {
    const threshold = thresholds[tier - 1];
    if (threshold !== undefined && hp <= threshold) {
      return tier;
    }
  }
  return 0;
}
