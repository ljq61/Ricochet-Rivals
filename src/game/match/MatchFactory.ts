import type { AIDifficulty } from '../config/GameConfig';
import type { PeerRole } from '../network/PeerRole';
import type { MatchSetup } from './MatchSetup';

/**
 * MatchSetup 工厂（Phase 11）：按 GameMode 产出标准 InputSource 组合。
 *
 *   single_player：P1 = human，P2 = ai
 *   local_2p     ：P1 = human，P2 = human（热座）
 *   online       ：按 PeerRole 决定本地/远程归属（Phase 14）——
 *                  host  → P1 = human，P2 = network
 *                  guest → P1 = network，P2 = human
 *                  （Host = P1 / Guest = P2 固定，见 OnlineSession）
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
export function createMatchSetup(mode: 'online', role?: PeerRole): MatchSetup;
export function createMatchSetup(
  mode: 'single_player' | 'local_2p' | 'online',
  arg2?: AIDifficulty | PeerRole
): MatchSetup {
  if (mode === 'single_player') {
    return {
      mode,
      p1Controller: 'human',
      p2Controller: 'ai',
      aiDifficulty: (arg2 as AIDifficulty | undefined) ?? 'normal',
    };
  }
  if (mode === 'local_2p') {
    return { mode, p1Controller: 'human', p2Controller: 'human' };
  }
  // online：缺省 role = host（Phase 12 契约占位语义；Phase 14 起联机
  // 启动一律显式传 role —— OnlineConnectionScene 从 session.role 提供）
  const isHost = arg2 !== 'guest';
  return {
    mode,
    p1Controller: isHost ? 'human' : 'network',
    p2Controller: isHost ? 'network' : 'human',
  };
}
