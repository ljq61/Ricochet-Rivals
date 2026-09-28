import { ConcreteDamageSystem, type DamageSystem } from '../../systems/DamageSystem';
import type { TurnManager } from '../../systems/TurnManager';
import type { CommandBus } from '../../commands/CommandBus';
import type { DamageResult } from '../../state/DamageResult';
import type { GameState } from '../../state/GameState';
import type { PlayerId } from '../../state/ids';
import { NetworkMessageType } from '../NetworkMessageType';
import type { NetworkEnvelope } from '../NetworkEnvelope';
import type { NetworkManager } from '../NetworkManager';
import {
  applyTurnResult,
  synthesizeAuthoritativeDamage,
} from './AuthoritativeState';
import {
  isCommandRejectedPayload,
  isFirePayload,
  isMovePayload,
  isTurnEndPayload,
  isTurnResultPayload,
} from './OnlinePayloads';
import type {
  CommandRejectedPayload,
  TurnEndPayload,
  TurnResultPayload,
} from './OnlineTypes';
import type { OnlineChannelUtils } from './OnlineHostChannel';
import type { ProjectileImpact } from '../../state/ExplosionEvent';

/**
 * Guest 协议通道（Phase 14）—— 权威消息应用 + Turn Barrier + 展示合成。
 *
 * * MOVE / TURN_RESULT：绝对覆写（HP / 位置 / 预算 / hasFired /
 *   gameOver / winner 以 Host 为准，不平均不合并）。
 * * FIRE：经真实总线本地播放（GameLogic → FireSystem 双保险 → launch；
 *   重复 FIRE 被 ALREADY_FIRED 自然拒绝，Guest 不订阅 outcome 无副作用）。
 * * Turn Barrier：本地 dwell 完成 + TURN_END 到达双条件满足才推进
 *   （applyRemoteTurnEnd + resumeNextTurn），Host 永远控制回合切换。
 * * 伤害数字：双条件（本地结算 ✓ + TURN_RESULT ✓）齐备后展示权威值。
 */

/** Guest 通道依赖（Coordinator attach 后注入） */
export interface OnlineGuestChannelDeps {
  getState(): GameState;
  readonly commandBus: CommandBus;
  readonly turnManager: TurnManager;
  resumeNextTurn(): void;
  showAuthoritativeDamage(result: DamageResult): void;
  showRejected(payload: CommandRejectedPayload): void;
}

export class OnlineGuestChannel {
  private readonly nm: NetworkManager;
  private readonly remotePlayerId: PlayerId;
  private readonly utils: OnlineChannelUtils;
  private readonly deps: OnlineGuestChannelDeps;

  /** 权威伤害展示双条件 */
  private pendingTurnResult: TurnResultPayload | null = null;
  private pendingLocalResolve: { impact: ProjectileImpact | null } | null = null;
  /** Turn Barrier 双条件 */
  private pendingTurnEnd: TurnEndPayload | null = null;
  private dwellComplete = false;
  private hashMatch: boolean | null = null;

  constructor(
    nm: NetworkManager,
    remotePlayerId: PlayerId,
    utils: OnlineChannelUtils,
    deps: OnlineGuestChannelDeps,
  ) {
    this.nm = nm;
    this.remotePlayerId = remotePlayerId;
    this.utils = utils;
    this.deps = deps;
  }

  /** 最近一次 TURN_RESULT 的 stateHash 与本地重算是否一致（诊断） */
  get lastHashMatch(): boolean | null {
    return this.hashMatch;
  }

  /** 注册 Guest 侧订阅；返回取消函数 */
  attach(): () => void {
    const cancels = [
      this.nm.onMessage(NetworkMessageType.MOVE, (e) => this.handleAuthoritativeMove(e)),
      this.nm.onMessage(NetworkMessageType.FIRE, (e) => this.handleAuthoritativeFire(e)),
      this.nm.onMessage(NetworkMessageType.TURN_RESULT, (e) => this.handleTurnResult(e)),
      this.nm.onMessage(NetworkMessageType.TURN_END, (e) => this.handleTurnEnd(e)),
      this.nm.onMessage(NetworkMessageType.COMMAND_REJECTED, (e) => this.handleCommandRejected(e)),
    ];
    return () => {
      for (const cancel of cancels) {
        cancel();
      }
    };
  }

  /** Guest：本地结算完成（display / Barrier 的本地半条件） */
  notifyLocalResolve(impact: ProjectileImpact | null): void {
    this.pendingLocalResolve = { impact };
    if (this.pendingTurnResult !== null) {
      this.flushAuthoritativeDamage();
    }
  }

  /** Guest：本地 dwell 完成；双条件满足 → 推进并 'proceed'，否则 'waiting' */
  onDwellComplete(): 'proceed' | 'waiting' {
    if (this.deps.getState().gameOver) {
      return 'proceed'; // Guest 由 update 循环 gameOver 检测接管收口
    }
    this.dwellComplete = true;
    if (this.pendingTurnEnd !== null) {
      this.applyTurnEnd(this.pendingTurnEnd);
      return 'proceed';
    }
    return 'waiting';
  }

  // ---- 内部 ------------------------------------------------------------

  private handleAuthoritativeMove(envelope: NetworkEnvelope<unknown>): void {
    if (!this.utils.guardInbound(envelope, NetworkMessageType.MOVE, isMovePayload)) {
      return;
    }
    const payload = envelope.payload;
    // 绝对覆写（权威快照语义；重复同值天然幂等）
    const player = this.deps.getState().players[payload.playerId];
    player.x = payload.x;
    player.moveRemaining = payload.moveRemaining;
  }

  private handleAuthoritativeFire(envelope: NetworkEnvelope<unknown>): void {
    if (!this.utils.guardInbound(envelope, NetworkMessageType.FIRE, isFirePayload)) {
      return;
    }
    const payload = envelope.payload;
    this.deps.commandBus.dispatch({
      type: 'FIRE',
      playerId: payload.playerId,
      turnId: payload.turnId,
      weaponId: payload.weaponId,
      startX: payload.startX,
      startY: payload.startY,
      velocityX: payload.velocityX,
      velocityY: payload.velocityY,
      seed: payload.seed,
    });
  }

  private handleTurnResult(envelope: NetworkEnvelope<unknown>): void {
    if (!this.utils.guardInbound(envelope, NetworkMessageType.TURN_RESULT, isTurnResultPayload)) {
      return;
    }
    const { hashMatch } = applyTurnResult(this.deps.getState(), envelope.payload);
    this.hashMatch = hashMatch;
    this.pendingTurnResult = envelope.payload;
    if (this.pendingLocalResolve !== null) {
      this.flushAuthoritativeDamage();
    }
  }

  private handleTurnEnd(envelope: NetworkEnvelope<unknown>): void {
    if (!this.utils.guardInbound(envelope, NetworkMessageType.TURN_END, isTurnEndPayload)) {
      return;
    }
    const payload = envelope.payload;
    if (payload.nextPlayerId === this.deps.getState().currentPlayerId) {
      // 协议异常 —— Host 权威值仍应用（nextTurnId 告警归 TurnManager）
      console.warn('[OnlineGuestChannel] TURN_END nextPlayerId equals current player');
    }
    if (this.dwellComplete) {
      this.applyTurnEnd(payload);
    } else {
      this.pendingTurnEnd = payload;
    }
  }

  private handleCommandRejected(envelope: NetworkEnvelope<unknown>): void {
    if (
      !this.utils.guardInbound(envelope, NetworkMessageType.COMMAND_REJECTED, isCommandRejectedPayload)
    ) {
      return;
    }
    this.deps.showRejected(envelope.payload);
  }

  private applyTurnEnd(payload: TurnEndPayload): void {
    this.deps.turnManager.applyRemoteTurnEnd(payload.nextPlayerId, payload.nextTurnId);
    this.dwellComplete = false;
    this.pendingTurnEnd = null;
    this.deps.resumeNextTurn();
  }

  /** 双条件齐备 → 合成权威伤害展示（数值全取 Host payload） */
  private flushAuthoritativeDamage(): void {
    const result = this.pendingTurnResult;
    const local = this.pendingLocalResolve;
    if (result === null || local === null) {
      return;
    }
    this.deps.showAuthoritativeDamage(
      synthesizeAuthoritativeDamage(result, local.impact, this.remotePlayerId),
    );
    this.pendingTurnResult = null;
    this.pendingLocalResolve = null;
  }
}

/**
 * Guest 伤害系统：calculate 正常（本地命中反馈 / 爆炸预测），
 * apply no-op —— Guest 本地 HP 只经 TURN_RESULT reconcile 改写
 * （CODELY.md：最终 Gameplay State 必须以 Host 为准）。
 */
export class GuestAuthoritativeDamage implements DamageSystem {
  private readonly inner: DamageSystem = new ConcreteDamageSystem();

  calculate(
    gameState: GameState,
    explosion: Parameters<DamageSystem['calculate']>[1],
  ): ReturnType<DamageSystem['calculate']> {
    return this.inner.calculate(gameState, explosion);
  }

  apply(): void {
    // no-op：权威覆写归 applyTurnResult
  }
}
