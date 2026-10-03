import { GAME_CONFIG } from '../config/GameConfig';
import { SeededRandom } from '../random/SeededRandom';
import type { ItemGenerationState, ShotContext } from './ItemState';
import type { MatchId, PlayerId, TurnId } from './ids';
import type { PlayerState } from './PlayerState';
import { TurnPhase } from './TurnPhase';
import type { WorldItemState } from './WorldItemState';
import { createOctopusState, type OctopusState } from './OctopusState';
import type { AirstrikeContext } from './AirstrikeState';

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
  itemGeneration: ItemGenerationState;
  acceptedShot: ShotContext | null;
  pendingAirstrike: AirstrikeContext | null;
  octopus: OctopusState;
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
    // 保留有限数值以兼容既有联机快照，不代表移动预算。
    moveRemaining: GAME_CONFIG.player.maxMovePerTurn,
    hasFired: false,
    isAlive: true,
    weaponId: 'normal',
    inventory: Array.from({ length: GAME_CONFIG.items.inventoryCapacity }, () => null),
    itemUsedThisTurn: false,
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
    itemGeneration: {
      firstWindowParity: new SeededRandom(options.seed ^ 0x51a7e).integer(0, 1) as 0 | 1,
      lastWindowTurnId: 0,
      misses: 0,
      nextId: 1,
    },
    acceptedShot: null,
    pendingAirstrike: null,
    octopus: createOctopusState(),
    gameOver: false,
    winnerId: null,
  };
}
