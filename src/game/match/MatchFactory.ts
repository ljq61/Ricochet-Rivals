import type { AIDifficulty } from '../config/GameConfig';
import type { MatchSetup } from './MatchSetup';

/**
 * MatchSetup 工厂（Phase 11）：按 GameMode 产出标准 InputSource 组合。
 *
 *   single_player：P1 = human，P2 = ai
 *   local_2p     ：P1 = human，P2 = human（热座）
 *   online       ：P2 = network（Phase 12+ 契约占位，本阶段菜单
 *                  不会以 online 启动 BattleScene）
 *
 * Rematch 语义：以同一 setup 再次 scene.start —— BattleScene.create
 * 重建全新 GameState，旧局任何污染（HP / 位置 / 预算 / 相位 /
 * 炮弹 / 相机 / AI / RNG 状态）随场景重建一并清除。
 */
export function createMatchSetup(
  mode: 'single_player',
  aiDifficulty?: AIDifficulty
): MatchSetup;
export function createMatchSetup(mode: 'local_2p'): MatchSetup;
export function createMatchSetup(mode: 'online'): MatchSetup;
export function createMatchSetup(
  mode: 'single_player' | 'local_2p' | 'online',
  aiDifficulty?: AIDifficulty
): MatchSetup {
  if (mode === 'single_player') {
    return {
      mode,
      p1Controller: 'human',
      p2Controller: 'ai',
      aiDifficulty: aiDifficulty ?? 'normal',
    };
  }
  if (mode === 'local_2p') {
    return { mode, p1Controller: 'human', p2Controller: 'human' };
  }
  return { mode, p1Controller: 'human', p2Controller: 'network' };
}
