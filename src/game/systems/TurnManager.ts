import { GAME_CONFIG } from '../config/GameConfig';
import type { GameState } from '../state/GameState';
import { TurnPhase } from '../state/TurnPhase';
import type { DamageResult } from '../state/DamageResult';
import { type PlayerId } from '../state/ids';

/**
 * TurnManager（Phase 8，CODELY.md §10）—— 回合阶段状态机：
 *
 *   START → ACTION →（requestAim）→ RETURN_HOME →（相机到位）→ AIM
 *         →（cancel）→ ACTION
 *   AIM / RETURN_HOME / ACTION →（FIRE）→ PROJECTILE →（碰撞 / 出界）
 *         → RESOLVE →（爆炸停留结束）→ END（切换玩家 + turnId++）
 *         →（相机 TURN_TRANSITION 完成）→ ACTION（下一回合）
 *   任意伤害致死 → GAME_OVER（不切换回合）
 *
 * 职责与边界：
 * - 纯逻辑，直接驱动 GameState（phase / turnId / currentPlayerId /
 *   新回合的 moveRemaining + hasFired 重置）
 * - 不处理 Phaser input / Camera —— 场景在相机事件点上回调本状态机
 *   （相机模式 ↔ TurnPhase 由 BattleScene 每帧对账同步）
 * - 死亡判定不在本层：DamageSystem.apply 已写入 gameOver / winnerId，
 *   本状态机只消费该标志决定是否进入 GAME_OVER
 * - 非法转移一律忽略（幂等），与 aimFlow 的防御风格一致
 */
export class TurnManager {
  constructor(private readonly state: GameState) {}

  get currentPlayerId(): PlayerId {
    return this.state.currentPlayerId;
  }

  get phase(): TurnPhase {
    return this.state.phase;
  }

  get turnId(): number {
    return this.state.turnId;
  }

  /** 比赛开始：START → 首位玩家 ACTION（重置其预算 / hasFired） */
  startMatch(): void {
    this.state.phase = TurnPhase.START;
    this.beginTurn(this.state.currentPlayerId);
  }

  /** 开始某玩家的行动阶段（复位预算 + 发射标记） */
  beginTurn(playerId: PlayerId): void {
    this.state.currentPlayerId = playerId;
    this.resetForTurn(playerId);
    this.state.phase = TurnPhase.ACTION;
  }

  /** 发起瞄准：ACTION → RETURN_HOME；已发射 / 已阵亡 / 非法阶段拒绝 */
  requestAim(): boolean {
    if (this.state.phase !== TurnPhase.ACTION) {
      return false;
    }
    const player = this.state.players[this.state.currentPlayerId];
    if (player.hasFired || !player.isAlive) {
      return false;
    }
    this.state.phase = TurnPhase.RETURN_HOME;
    return true;
  }

  /** 相机回到炮手并进入 AIMING（场景对账调用）：RETURN_HOME → AIM */
  notifyAimingStarted(): void {
    if (this.state.phase !== TurnPhase.RETURN_HOME) {
      return;
    }
    this.state.phase = TurnPhase.AIM;
  }

  /** 取消瞄准：RETURN_HOME / AIM → ACTION */
  cancelAim(): void {
    if (
      this.state.phase !== TurnPhase.RETURN_HOME &&
      this.state.phase !== TurnPhase.AIM
    ) {
      return;
    }
    this.state.phase = TurnPhase.ACTION;
  }

  /** FIRE 已通过校验并发射：发射前任意阶段 → PROJECTILE */
  notifyProjectileLaunched(): void {
    switch (this.state.phase) {
      case TurnPhase.ACTION:
      case TurnPhase.RETURN_HOME:
      case TurnPhase.AIM:
        this.state.phase = TurnPhase.PROJECTILE;
        break;
      default:
        break;
    }
  }

  /**
   * 攻击结束（爆炸结算完成 / 出界无伤害）：PROJECTILE → RESOLVE，
   * 或（DamageSystem 已判定 gameOver）→ GAME_OVER（回合冻结）。
   * result 仅用于扩展（回合统计 / Phase 14 TURN_RESULT 广播）。
   */
  notifyProjectileResolved(result: DamageResult | null): void {
    void result;
    if (this.state.phase !== TurnPhase.PROJECTILE) {
      return;
    }
    this.state.phase = this.state.gameOver
      ? TurnPhase.GAME_OVER
      : TurnPhase.RESOLVE;
  }

  /**
   * 结束回合（爆炸停留结束后由场景调用）：
   * turnId++、切换玩家、重置新玩家预算 / hasFired，phase = END
   * （等待相机 TURN_TRANSITION 到位后再进入下一回合 ACTION）。
   * 游戏已结束时不切换（phase 停留 GAME_OVER）。
   */
  endTurn(): void {
    if (this.state.gameOver || this.state.phase !== TurnPhase.RESOLVE) {
      return;
    }
    const next = this.state.currentPlayerId === 'P1' ? 'P2' : 'P1';
    this.state.turnId += 1;
    this.state.currentPlayerId = next;
    this.resetForTurn(next);
    this.state.phase = TurnPhase.END;
  }

  /** 相机 TURN_TRANSITION 到达新玩家：END → ACTION */
  notifyTurnTransitionComplete(): void {
    if (this.state.phase !== TurnPhase.END) {
      return;
    }
    this.state.phase = TurnPhase.ACTION;
  }

  private resetForTurn(playerId: PlayerId): void {
    const player = this.state.players[playerId];
    player.moveRemaining = GAME_CONFIG.player.maxMovePerTurn;
    player.hasFired = false;
  }
}
