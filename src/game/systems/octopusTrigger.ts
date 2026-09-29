import { GAME_CONFIG } from '../config/GameConfig';

/**
 * 中央章鱼触手出现条件（纯函数，可单测）：
 * 任一方 HP ≤ GameConfig.octopus.hpThreshold 即出现。
 * HP 只在回合结算（TURN_RESULT / 快照恢复）更新 —— 出现时机天然落在
 * 回合边界，炮弹飞行期间触手状态恒定（联机双端确定性一致）。
 */
export function shouldOctopusEmerge(hpP1: number, hpP2: number): boolean {
  return Math.min(hpP1, hpP2) <= GAME_CONFIG.octopus.hpThreshold;
}
