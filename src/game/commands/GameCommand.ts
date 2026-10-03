import type { TurnPhase } from '../state/TurnPhase';
import type { PlayerId, TurnId, WeaponId } from '../state/ids';

/**
 * Command 驱动架构核心（CODELY.md §4）：
 * 所有玩家行为（本地 / AI / 网络）统一转换为 GameCommand，
 * Game Logic 不感知命令来源。
 */

export interface MoveCommand {
  type: 'MOVE';
  playerId: PlayerId;
  turnId: TurnId;
  targetX: number;
}

export interface FireCommand {
  type: 'FIRE';
  playerId: PlayerId;
  turnId: TurnId;
  weaponId: WeaponId;
  startX: number;
  startY: number;
  velocityX: number;
  velocityY: number;
  seed: number;
  itemId?: string;
}

export interface ReadyCommand {
  type: 'READY';
  playerId: PlayerId;
}

export interface UseItemCommand {
  /** Guest aim is local presentation until a command commits its continuation. */
  resumePhase?: TurnPhase.ACTION | TurnPhase.AIM;
  type: 'USE_ITEM';
  playerId: PlayerId;
  turnId: TurnId;
  itemId: string;
  operationId?: string;
}

export type GameCommand = MoveCommand | FireCommand | UseItemCommand | ReadyCommand;
