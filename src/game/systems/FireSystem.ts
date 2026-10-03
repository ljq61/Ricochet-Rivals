import type { FireCommand } from '../commands/GameCommand';
import type { GameState } from '../state/GameState';
import type { ShotContext } from '../state/ItemState';
import { itemCommandReject } from './ItemSystem';
import { TurnPhase } from '../state/TurnPhase';

export type FireRejectReason =
  | 'GAME_OVER'
  | 'WRONG_PHASE'
  | 'TURN_MISMATCH'
  | 'NOT_CURRENT_PLAYER'
  | 'PLAYER_DEAD'
  | 'ALREADY_FIRED'
  | 'ITEM_ALREADY_USED'
  | 'ITEM_NOT_OWNED'
  | 'NOT_ATTACK_ITEM';

export interface FireResult {
  accepted: boolean;
  reason?: FireRejectReason;
  shot?: ShotContext;
}

/**
 * 发射规则系统（Phase 4；Phase 8 起受 TurnPhase 门禁）：
 * 校验 FireCommand 并标记 hasFired（每回合限一次）。
 * 仅发射前阶段（ACTION / RETURN_HOME / AIM）允许 FIRE ——
 * PROJECTILE 及之后禁止二次发射（双保险：hasFired 已挡，
 * WRONG_PHASE 让规则显式可测）。
 *
 * 纯逻辑，不依赖 Phaser。Phase 5 将在校验通过后由
 * ProjectileSystem 生成炮弹；此处只管"能不能发、发过没有"。
 */
export class FireSystem {
  execute(state: GameState, command: FireCommand): FireResult {
    const player = state.players[command.playerId];

    if (state.gameOver) {
      return { accepted: false, reason: 'GAME_OVER' };
    }
    if (
      state.phase !== TurnPhase.ACTION &&
      state.phase !== TurnPhase.RETURN_HOME &&
      state.phase !== TurnPhase.AIM
    ) {
      return { accepted: false, reason: 'WRONG_PHASE' };
    }
    if (command.turnId !== state.turnId) {
      return { accepted: false, reason: 'TURN_MISMATCH' };
    }
    if (command.playerId !== state.currentPlayerId) {
      return { accepted: false, reason: 'NOT_CURRENT_PLAYER' };
    }
    if (!player.isAlive) {
      return { accepted: false, reason: 'PLAYER_DEAD' };
    }
    if (player.hasFired) {
      return { accepted: false, reason: 'ALREADY_FIRED' };
    }

    const shot: ShotContext = { ownerId: command.playerId, turnId: command.turnId, homingActivated: false };
    if (command.itemId !== undefined) {
      const itemReason = itemCommandReject(state, command.playerId, command.turnId);
      if (itemReason) return { accepted: false, reason: itemReason as FireRejectReason };
      const slot = player.inventory.findIndex((entry) => entry?.id === command.itemId);
      const item = player.inventory[slot];
      if (!item) return { accepted: false, reason: 'ITEM_NOT_OWNED' };
      if (item.type === 'heal' || item.type === 'airstrike') return { accepted: false, reason: 'NOT_ATTACK_ITEM' };
      shot.itemId = item.id;
      shot.itemType = item.type;
      player.inventory[slot] = null;
      player.itemUsedThisTurn = true;
    }
    player.hasFired = true;
    state.acceptedShot = shot;
    return { accepted: true, shot };
  }
}
