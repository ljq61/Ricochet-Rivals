import { GAME_CONFIG } from '../config/GameConfig';
import type { MatchId, PlayerId, TurnId } from './ids';
import type { PlayerState } from './PlayerState';
import { TurnPhase } from './TurnPhase';
import type { WorldItemState } from './WorldItemState';

export { TurnPhase };

/**
 * 全场比赛权威逻辑状态。
 * Single Player 与 Multiplayer 共用同一结构（CODELY.md §4）。
 */
export interface GameState {
  matchId: MatchId;
  seed: number;
  turnId: TurnId;
  currentPlayerId: PlayerId;
  phase: TurnPhase;
  players: Record<PlayerId, PlayerState>;
  items: WorldItemState[];
  gameOver: boolean;
  winnerId: PlayerId | null;
}

export function createPlayerState(id: PlayerId): PlayerState {
  const isLeft = id === 'P1';
  return {
    id,
    side: isLeft ? 'left' : 'right',
    x: GAME_CONFIG.player.spawn[id],
    y: GAME_CONFIG.world.groundTopY,
    hp: GAME_CONFIG.player.maxHp,
    maxHp: GAME_CONFIG.player.maxHp,
    moveRemaining: GAME_CONFIG.player.maxMovePerTurn,
    hasFired: false,
    isAlive: true,
    weaponId: 'normal',
  };
}

export interface CreateInitialStateOptions {
  matchId: MatchId;
  seed: number;
  firstPlayer?: PlayerId;
}

/**
 * 创建一局比赛的初始 GameState（纯函数，可测试）。
 * seed 由 Host 生成；Phase 1 本地对局由调用方传入。
 */
export function createInitialGameState(
  options: CreateInitialStateOptions
): GameState {
  return {
    matchId: options.matchId,
    seed: options.seed,
    turnId: 1,
    currentPlayerId: options.firstPlayer ?? 'P1',
    phase: TurnPhase.START,
    players: {
      P1: createPlayerState('P1'),
      P2: createPlayerState('P2'),
    },
    items: [],
    gameOver: false,
    winnerId: null,
  };
}
