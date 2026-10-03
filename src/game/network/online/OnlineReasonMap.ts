import type { CommandRejectedReason } from './CommandRejectedReason';
import type { MovementRejectReason } from '../../systems/MovementSystem';
import type { ItemRejectReason } from '../../systems/ItemSystem';
import type { FireRejectReason } from '../../systems/FireSystem';

/**
 * 系统 reject reason → COMMAND_REJECTED 拒因映射（Phase 14，Host 侧）。
 *
 * Host 把 Guest 请求重建的命令交给系统层验证（单一 validate+execute
 * 路径）；被拒时经本表把 MovementRejectReason / FireRejectReason
 * 翻译为 wire 拒因回执。方向红线：网络层单向 import 规则层类型，
 * 规则层零反向依赖。
 */

export function mapMovementRejectReason(
  reason: MovementRejectReason,
): CommandRejectedReason {
  switch (reason) {
    case 'GAME_OVER':
      return 'INVALID_PHASE';
    case 'WRONG_PHASE':
      return 'INVALID_PHASE';
    case 'TURN_MISMATCH':
      return 'STALE_TURN';
    case 'NOT_CURRENT_PLAYER':
      return 'WRONG_TURN';
    case 'PLAYER_DEAD':
      return 'INVALID_PLAYER';
    case 'ALREADY_FIRED':
      return 'ALREADY_FIRED';
    case 'NO_MOVE_BUDGET':
      return 'MOVE_BUDGET_EXCEEDED';
    case 'NO_MOVEMENT':
      return 'INVALID_POSITION';
  }
}

export function mapFireRejectReason(reason: FireRejectReason): CommandRejectedReason {
  switch (reason) {
    case 'ITEM_ALREADY_USED': return 'ITEM_ALREADY_USED';
    case 'ITEM_NOT_OWNED': case 'NOT_ATTACK_ITEM': return 'INVALID_ITEM';
    case 'GAME_OVER':
      return 'INVALID_PHASE';
    case 'WRONG_PHASE':
      return 'INVALID_PHASE';
    case 'TURN_MISMATCH':
      return 'STALE_TURN';
    case 'NOT_CURRENT_PLAYER':
      return 'WRONG_TURN';
    case 'PLAYER_DEAD':
      return 'INVALID_PLAYER';
    case 'ALREADY_FIRED':
      return 'ALREADY_FIRED';
  }
}

export function mapItemRejectReason(reason: ItemRejectReason): CommandRejectedReason {
  switch (reason) {
    case 'GAME_OVER': case 'WRONG_PHASE': return 'INVALID_PHASE';
    case 'TURN_MISMATCH': return 'STALE_TURN';
    case 'NOT_CURRENT_PLAYER': return 'WRONG_TURN';
    case 'PLAYER_DEAD': return 'INVALID_PLAYER';
    case 'ALREADY_FIRED': return 'ALREADY_FIRED';
    case 'ITEM_ALREADY_USED': return 'ITEM_ALREADY_USED';
    case 'ITEM_NOT_OWNED': case 'NOT_HEAL_ITEM': return 'INVALID_ITEM';
    case 'FULL_HP': return 'HP_FULL';
  }
}
