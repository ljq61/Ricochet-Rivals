import { GAME_CONFIG } from '../config/GameConfig';
import type { MoveCommand } from '../commands/GameCommand';
import type { GameState } from '../state/GameState';
import { TurnPhase } from '../state/TurnPhase';
import type { PlayerState } from '../state/PlayerState';

export interface MovementResult {
  accepted: boolean;

  previousX: number;

  nextX: number;

  /** 本次实际移动距离（px），仅记录路程，不限制移动。 */
  distanceConsumed: number;

  /** 旧联机结果兼容字段；成功移动时恒为 0。 */
  remainingMovement: number;

  reason?: MovementRejectReason;
}

export type MovementRejectReason =
  | 'GAME_OVER'
  | 'WRONG_PHASE'
  | 'TURN_MISMATCH'
  | 'NOT_CURRENT_PLAYER'
  | 'PLAYER_DEAD'
  | 'ALREADY_FIRED'
  | 'NO_MOVE_BUDGET' // 旧拒绝原因兼容占位，新规则不再产生。
  | 'NO_MOVEMENT';

/**
 * 移动规则系统（Phase 2；Phase 8 起受 TurnPhase 门禁）：
 * - 只允许当前回合玩家移动
 * - 只能水平移动，且 clamp 在己方阵地范围内
 * - 己方阵地内可任意往返，不限制每回合移动距离
 * - 发射后（hasFired）本回合禁止移动
 * - 仅 ACTION 阶段允许移动（Phase 9 Review Gate 反馈：
 *   点击「回到炮手 / 瞄准」即位置锁定，RETURN_HOME / AIM 不再
 *   允许移动；取消瞄准回 ACTION 恢复）
 *
 * 纯逻辑，不依赖 Phaser；AI / 网络与本地输入共用同一入口。
 */
export class MovementSystem {
  execute(state: GameState, command: MoveCommand): MovementResult {
    const player = state.players[command.playerId];

    const reject = (
      reason: MovementRejectReason,
      p: PlayerState
    ): MovementResult => ({
      accepted: false,
      previousX: p.x,
      nextX: p.x,
      distanceConsumed: 0,
      remainingMovement: p.moveRemaining,
      reason,
    });

    if (state.gameOver) {
      return reject('GAME_OVER', player);
    }
    if (!isMovementPhase(state.phase)) {
      return reject('WRONG_PHASE', player);
    }
    if (command.turnId !== state.turnId) {
      return reject('TURN_MISMATCH', player);
    }
    if (command.playerId !== state.currentPlayerId) {
      return reject('NOT_CURRENT_PLAYER', player);
    }
    if (!player.isAlive) {
      return reject('PLAYER_DEAD', player);
    }
    if (player.hasFired) {
      return reject('ALREADY_FIRED', player);
    }

    // 1. clamp 到己方阵地边界
    const bounds =
      player.side === 'left'
        ? GAME_CONFIG.player.leftBounds
        : GAME_CONFIG.player.rightBounds;
    const boundedX = Math.min(
      Math.max(command.targetX, bounds.minX),
      bounds.maxX
    );

    const distance = Math.abs(boundedX - player.x);

    if (distance === 0) {
      return reject('NO_MOVEMENT', player);
    }

    // 2. 应用；旧快照字段保留有限数值，不使用 Infinity 表示无限移动。
    const previousX = player.x;
    player.x = boundedX;
    player.moveRemaining = 0;

    return {
      accepted: true,
      previousX,
      nextX: player.x,
      distanceConsumed: distance,
      remainingMovement: player.moveRemaining,
    };
  }
}

/**
 * 移动允许的回合阶段：仅 ACTION（Phase 9 Review Gate 反馈 ——
 * 点击瞄准按钮后位置即锁定，取消瞄准 / 新回合恢复）
 */
function isMovementPhase(phase: TurnPhase): boolean {
  return phase === TurnPhase.ACTION;
}
