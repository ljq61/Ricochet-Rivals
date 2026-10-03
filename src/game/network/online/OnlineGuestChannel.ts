import { applyItemState } from './ItemAuthority';
import { ConcreteDamageSystem, type DamageSystem } from '../../systems/DamageSystem';
import type { TurnManager } from '../../systems/TurnManager';
import type { CommandBus } from '../../commands/CommandBus';
import type { DamageResult } from '../../state/DamageResult';
import type { GameState } from '../../state/GameState';
import { TurnPhase } from '../../state/TurnPhase';
import type { AirstrikeContext } from '../../state/AirstrikeState';
import type { PlayerId } from '../../state/ids';
import { NetworkMessageType } from '../NetworkMessageType';
import type { NetworkEnvelope } from '../NetworkEnvelope';
import type { NetworkManager } from '../NetworkManager';
import {
  applyAuthoritativeSnapshot,
  applyTurnResult,
  computeStateHash,
  synthesizeAuthoritativeDamage,
} from './AuthoritativeState';
import { validateAuthoritativeSnapshot } from './sync/SnapshotValidator';
import { OnlineSyncState } from './sync/OnlineSyncState';
import {
  isCommandRejectedPayload,
  isItemStatePayload,
  isPlainObject,
  isFirePayload,
  isMovePayload,
  isStateSnapshotPayload,
  isTurnEndPayload,
  isTurnResultPayload,
} from './OnlinePayloads';
import type {
  CommandRejectedPayload,
  ItemStatePayload,
  OnlineBattleDeps,
  StateSyncDiagnostics,
  StateSyncReason,
  TurnEndPayload,
  TurnResultPayload,
} from './OnlineTypes';
import type { OnlineChannelUtils } from './OnlineHostChannel';
import type { ProjectileImpact } from '../../state/ExplosionEvent';

/**
 * Guest 协议通道（Phase 14/15）—— 权威消息应用 + Turn Barrier + 展示合成
 * + desync 恢复链。
 *
 * * MOVE / TURN_RESULT：绝对覆写（HP / 位置 / 预算 / hasFired /
 *   gameOver / winner 以 Host 为准，不平均不合并）。
 * * FIRE：经真实总线本地播放（GameLogic → FireSystem 双保险 → launch；
 *   重复 FIRE 被 ALREADY_FIRED 自然拒绝，Guest 不订阅 outcome 无副作用）。
 * * Turn Barrier：本地 dwell 完成 + TURN_END 到达双条件满足才推进
 *   （applyRemoteTurnEnd + resumeNextTurn），Host 永远控制回合切换。
 * * Phase 15：TURN_RESULT 边界 hash 不符 / TURN_RESULT 缺失 / 跳回合
 *   → 锁输入并发 STATE_SYNC_REQUEST → STATE_SNAPSHOT 校验后原子恢复 →
 *   复验一致 → ACK(recovered) 解锁；重试有限，耗尽即 SYNC_FAILED。
 */

/** validator 拒绝后的有限重试（再发 STATE_SYNC_REQUEST 上限；超过即 SYNC_FAILED） */
const MAX_SNAPSHOT_RETRIES = 2;

/** Guest 通道依赖（Coordinator attach 后注入） */
export interface OnlineGuestChannelDeps {
  getState(): GameState;
  readonly commandBus: CommandBus;
  readonly turnManager: TurnManager;
  resumeNextTurn(): void;
  showAuthoritativeDamage(result: DamageResult): void;
  showRejected(payload: CommandRejectedPayload): void;
  /** Phase 15：恢复期间锁 Move/Aim/Fire（恢复完成解锁；Host 侧无此接线） */
  readonly setSyncLock: OnlineBattleDeps['setSyncLock'];
  readonly onSnapshotApplied: OnlineBattleDeps['onSnapshotApplied'];
  readonly onItemStateApplied: OnlineBattleDeps['onItemStateApplied'];
  readonly clearPendingItemUse?: (operationId?: string) => void;
}

export class OnlineGuestChannel {
  private readonly nm: NetworkManager;
  private readonly remotePlayerId: PlayerId;
  private readonly utils: OnlineChannelUtils;
  private readonly deps: OnlineGuestChannelDeps;

  /** 权威伤害展示双条件 */
  private pendingTurnResult: TurnResultPayload | null = null;
  /** Host may finish first; preserve local flight and verify its phase at local resolution. */
  private pendingHashResult: TurnResultPayload | null = null;
  /** Recovery discards flight simulations; a PROJECTILE snapshot cannot reconstruct one. */
  private snapshotWithoutLocalFlight = false;
  private pendingLocalResolve: { impact: ProjectileImpact | null } | null = null;
  /** New envelope sequences may retransmit the same already-presented result. */
  private lastPresentedTurnId = 0;
  /** Turn Barrier 双条件 */
  private pendingTurnEnd: TurnEndPayload | null = null;
  private dwellComplete = false;
  private hashMatch: boolean | null = null;

  /** ---- Phase 15：desync 恢复链 ---- */
  /** 本回合 TURN_RESULT 是否已到达 / 经快照恢复等效到达（MISSING 判定用） */
  private receivedTurnResult = false;
  /** 恢复在途（重复触发不重发请求 —— 防请求洪水） */
  private recoveryInFlight = false;
  /** 本次恢复 episode 的发起原因（validator 拒绝后的重发复用） */
  private recoveryReason: StateSyncReason | null = null;
  private snapshotRetryCount = 0;
  private recoveryCountValue = 0;
  private lastSyncReasonValue: string | null = null;
  private localHashValue: string | null = null;
  private hostHashValue: string | null = null;
  /** gameOver 权威终局已被本端 hash 确认（isFinalStateConfirmed gate） */
  private finalConfirmedValue = false;
  /** 重发快照的语义去重：新恢复 episode 可重新应用同一快照。 */
  private lastAppliedSnapshotKey: string | null = null;
  /** Last trusted Host turn, independent of a possibly corrupted local turn counter. */
  private latestAuthoritativeTurnId = 0;
  private pendingNextTurnItems: ItemStatePayload[] = [];
  private itemEventTurn = 0;
  private readonly appliedItemEvents = new Set<string>();

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

  /** Phase 15 同步诊断 */
  get syncDiagnostics(): StateSyncDiagnostics {
    return {
      recoveryCount: this.recoveryCountValue,
      lastSyncReason: this.lastSyncReasonValue,
      localHash: this.localHashValue,
      hostHash: this.hostHashValue,
    };
  }

  /** gameOver 权威状态已 hash 确认（场景 Result 转场 gate） */
  get isFinalStateConfirmed(): boolean {
    return this.finalConfirmedValue;
  }

  /** 注册 Guest 侧订阅；返回取消函数 */
  attach(): () => void {
    const cancels = [
      this.nm.onMessage(NetworkMessageType.MOVE, (e) => this.handleAuthoritativeMove(e)),
      this.nm.onMessage(NetworkMessageType.FIRE, (e) => this.handleAuthoritativeFire(e)),
      this.nm.onMessage(NetworkMessageType.ITEM_STATE, (e) => this.handleItemState(e)),
      this.nm.onMessage(NetworkMessageType.TURN_RESULT, (e) => this.handleTurnResult(e)),
      this.nm.onMessage(NetworkMessageType.TURN_END, (e) => this.handleTurnEnd(e)),
      this.nm.onMessage(NetworkMessageType.STATE_SNAPSHOT, (e) => this.handleStateSnapshot(e)),
      this.nm.onMessage(NetworkMessageType.COMMAND_REJECTED, (e) => this.handleCommandRejected(e)),
    ];
    return () => {
      for (const cancel of cancels) {
        cancel();
      }
    };
  }

  /**
   * DEBUG_GAME：篡改本地回合号制造偏差。不用 hp —— applyTurnResult 在
   * hash 比较前会覆写全部玩家字段，hp 类篡改在下一次边界永远"自愈"而
   * 无法触发恢复；turnId 属 hash 覆盖但 TURN_RESULT 不覆写的回合三元组，
   * 是唯一可靠的检测面。
   */
  debugForceDesync(): void {
    this.deps.getState().turnId += 1;
  }

  /**
   * SG-8：连接（ICE restart）恢复后的状态对账 —— 复用 Phase 15 恢复链。
   * * 恢复已在途（断线前已进入 DESYNC 链）：重发 STATE_SYNC_REQUEST
   *   （原请求可能随断线丢失；recoveryInFlight 防重入，幂等安全）。
   * * 空闲：以 CONNECTION_RECOVERED 发起新恢复 episode —— 断线期
   *   DataChannel 有序可靠也保证不了对端存活的接收窗口，快照对账是
   *   唯一权威收敛路径（Host 永远权威）。
   */
  requestPostReconnectSync(): void {
    if (this.recoveryInFlight) {
      this.sendSyncRequest(this.recoveryReason ?? 'CONNECTION_RECOVERED');
      return;
    }
    this.beginRecovery('CONNECTION_RECOVERED', 'post-reconnect');
  }

  /** Guest：本地结算完成（display / Barrier 的本地半条件） */
  notifyLocalResolve(impact: ProjectileImpact | null): void {
    this.pendingLocalResolve = { impact };
    if (this.pendingHashResult !== null) {
      const payload = this.pendingHashResult;
      this.pendingHashResult = null;
      this.finishTurnResult(payload);
    }
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
      // 权威回合未落地（applyRemoteTurnEnd 静默 no-op）时进入恢复，
      // 场景必须按 'waiting' 冻结
      return this.applyTurnEnd(this.pendingTurnEnd) ? 'proceed' : 'waiting';
    }
    return 'waiting';
  }

  // ---- 内部 ------------------------------------------------------------

  private handleAuthoritativeMove(envelope: NetworkEnvelope<unknown>): void {
    if (!this.utils.guardInbound(envelope, NetworkMessageType.MOVE, isMovePayload)) {
      return;
    }
    if (this.isFutureTurnJump(envelope.turnId, 'MOVE')) {
      return;
    }
    const payload = envelope.payload;
    if (envelope.turnId < this.deps.getState().turnId) return;
    // 绝对覆写（权威快照语义；重复同值天然幂等）
    const player = this.deps.getState().players[payload.playerId];
    player.x = payload.x;
    player.moveRemaining = payload.moveRemaining;
  }

  private handleAuthoritativeFire(envelope: NetworkEnvelope<unknown>): void {
    if (!this.utils.guardInbound(envelope, NetworkMessageType.FIRE, isFirePayload)) {
      return;
    }
    if (this.isFutureTurnJump(envelope.turnId, 'FIRE')) {
      return;
    }
    const payload = envelope.payload;
    if (payload.turnId !== envelope.turnId || envelope.turnId < this.deps.getState().turnId) return;
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
      ...(payload.itemId === undefined ? {} : { itemId: payload.itemId }),
    });
  }

  private handleItemState(envelope: NetworkEnvelope<unknown>): void {
    if (!this.utils.guardInbound(envelope, NetworkMessageType.ITEM_STATE, isItemStatePayload)) return;
    const payload = envelope.payload;
    const state = this.deps.getState();
    if (payload.turnId !== envelope.turnId || envelope.turnId < state.turnId || this.recoveryInFlight) return;
    if (envelope.turnId === state.turnId + 1) {
      // Host already changed turns; Guest may still await its local dwell callback.
      // Keep only a bounded next-turn projection chain (turn_start plus at most two crates).
      this.pendingNextTurnItems.push(payload);
      if (this.pendingNextTurnItems.length > 8) this.pendingNextTurnItems.shift();
      return;
    }
    if (this.isFutureTurnJump(envelope.turnId, 'ITEM_STATE')) return;
    if (state.phase === TurnPhase.RESOLVE || state.phase === TurnPhase.GAME_OVER || this.pendingHashResult !== null) return;
    this.applyUniqueItemEvent(payload);
    // A retry may already be applied, but its matching acknowledgement still clears pending.
    if ((payload.kind === 'heal' || payload.kind === 'airstrike_start' || payload.kind === 'airstrike_end') && payload.playerId !== this.remotePlayerId) this.deps.clearPendingItemUse?.(payload.operationId);
  }

  private applyUniqueItemEvent(payload: ItemStatePayload): boolean {
    if (this.itemEventTurn !== payload.turnId) {
      this.appliedItemEvents.clear();
      this.itemEventTurn = payload.turnId;
    }
    const state = this.deps.getState();
    if (payload.currentPlayerId !== state.currentPlayerId) return false;
    if (state.pendingAirstrike !== null && payload.kind !== 'airstrike_end' &&
      (payload.pendingAirstrike === null || !sameAirstrike(state.pendingAirstrike, payload.pendingAirstrike))) return false;
    if (payload.kind === 'airstrike_start' || payload.kind === 'airstrike_end') {
      if (payload.currentPlayerId !== state.currentPlayerId) return false;
      const pending = state.pendingAirstrike;
      if (pending !== null && !sameAirstrike(pending, payload.airstrike!)) return false;
      // A post-strike snapshot has already restored ACTION/AIM and spent the budget.
      // Late starts must not revive its plane or revoke the player's resumed controls.
      if (payload.kind === 'airstrike_start' && pending === null &&
        (state.players[state.currentPlayerId].itemUsedThisTurn || state.players[state.currentPlayerId].hasFired ||
          (state.phase !== TurnPhase.ACTION && state.phase !== TurnPhase.AIM && state.phase !== TurnPhase.END))) return false;
      if (payload.kind === 'airstrike_end' && pending === null && state.players[state.currentPlayerId].itemUsedThisTurn) return false;
    }
    const identity = payload.kind === 'airstrike_start' || payload.kind === 'airstrike_end'
      ? payload.itemId : payload.operationId ?? payload.itemId;
    const eventKey = identity === undefined ? null : JSON.stringify([payload.kind, identity]);
    if (eventKey !== null && this.appliedItemEvents.has(eventKey)) return false;
    applyItemState(state, payload);
    if (payload.kind === 'airstrike_end' && payload.gameOver) this.finalConfirmedValue = true;
    if (eventKey !== null) this.appliedItemEvents.add(eventKey);
    this.deps.onItemStateApplied?.(payload);
    return true;
  }

  private handleTurnResult(envelope: NetworkEnvelope<unknown>): void {
    if (!this.utils.guardInbound(envelope, NetworkMessageType.TURN_RESULT, isTurnResultPayload)) {
      return;
    }
    if (this.isFutureTurnJump(envelope.turnId, 'TURN_RESULT')) {
      return;
    }
    const payload = envelope.payload;
    // A replay with a newer sequence must not restore old hazard HP/history or replay a laser.
    // Force-desync uses a wrong local turn and still recovers through STATE_SNAPSHOT.
    if (payload.turnId !== envelope.turnId) {
      this.beginRecovery('INVALID_LOCAL_STATE', 'TURN_RESULT_TURN_MISMATCH');
      return;
    }
    if (
      payload.turnId < this.latestAuthoritativeTurnId ||
      (payload.turnId <= this.latestAuthoritativeTurnId && payload.turnId < this.deps.getState().turnId)
    ) {
      return;
    }
    applyTurnResult(this.deps.getState(), payload);
    this.receivedTurnResult = true;
    this.hostHashValue = payload.stateHash;
    if (payload.turnId > this.lastPresentedTurnId) {
      this.pendingTurnResult = payload;
    }
    if (this.snapshotWithoutLocalFlight && this.deps.getState().phase === TurnPhase.PROJECTILE) {
      // No impact callback can arrive after recovery discarded the simulation.
      // This new authoritative result closes that flight and presents its damage once.
      this.deps.getState().phase = payload.gameOver ? TurnPhase.GAME_OVER : TurnPhase.RESOLVE;
      this.snapshotWithoutLocalFlight = false;
      this.pendingLocalResolve = { impact: null };
    }
    if (this.deps.getState().phase === TurnPhase.PROJECTILE) {
      // HP/history are authoritative immediately, but a phase-only discrepancy is
      // expected while the Guest projectile is still flying. Do not cancel it via
      // snapshot recovery or confirm a final state before local impact/out-of-bounds.
      this.pendingHashResult = payload;
      this.hashMatch = null;
      return;
    }
    this.finishTurnResult(payload);
    if (this.pendingLocalResolve !== null) {
      this.flushAuthoritativeDamage();
    }
  }

  /** Called after local resolution, including a late result whose laser ended the match. */
  private finishTurnResult(payload: TurnResultPayload): void {
    const state = this.deps.getState();
    if (payload.gameOver && (state.phase === TurnPhase.RESOLVE || state.phase === TurnPhase.END)) {
      state.phase = TurnPhase.GAME_OVER;
    }
    this.localHashValue = computeStateHash(state);
    const hashMatch = this.localHashValue === payload.stateHash;
    this.hashMatch = hashMatch;
    if (hashMatch) {
      this.latestAuthoritativeTurnId = payload.turnId;
      // gameOver 确认按契约带 recovered:true（B.4：终局 ACK(recovered) +
      // SYNCED_AFTER_RECOVERY）；常规确认为 recovered:false
      this.sendAck(payload.turnId, payload.stateHash, payload.gameOver);
      if (payload.gameOver) {
        this.finalConfirmedValue = true;
        this.utils.setSyncState(
          OnlineSyncState.SYNCED_AFTER_RECOVERY,
          `FINAL_CONFIRMED(turn:${payload.turnId})`,
        );
      }
      return;
    }
    this.beginRecovery(
      'HASH_MISMATCH',
      `turn:${payload.turnId} local:${this.localHashValue} host:${payload.stateHash}`,
    );
  }

  private handleTurnEnd(envelope: NetworkEnvelope<unknown>): void {
    if (!this.utils.guardInbound(envelope, NetworkMessageType.TURN_END, isTurnEndPayload)) {
      return;
    }
    if (this.isFutureTurnJump(envelope.turnId, 'TURN_END')) {
      return;
    }
    if (this.recoveryInFlight) {
      // Host 可能已经切到下一回合；恢复快照及表现回调负责收口，
      // 不能假设该 TURN_END 一定会在 ACK 后重发。
      console.warn('[OnlineGuestChannel] 恢复进行中收到 TURN_END —— 由权威快照恢复回合');
      return;
    }
    const payload = envelope.payload;
    if (!this.receivedTurnResult) {
      // 本回合权威结算未到而 TURN_END 先行 —— 协议破损，不推进，走恢复
      this.beginRecovery('MISSING_TURN_RESULT', `turn:${envelope.turnId}`);
      return;
    }
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

  /** STATE_SNAPSHOT：validator → 原子 apply → 复验 → ACK(recovered) / 有限重试 */
  private handleStateSnapshot(envelope: NetworkEnvelope<unknown>): void {
    if (!this.utils.guardInbound(envelope, NetworkMessageType.STATE_SNAPSHOT, isPlainObject)) {
      return;
    }
    const validation = validateAuthoritativeSnapshot(envelope.payload, {
      expectedMatchId: this.deps.getState().matchId,
    });
    if (!validation.ok) {
      this.lastSyncReasonValue = `SNAPSHOT_REJECTED:${validation.reason}`;
      if (this.snapshotRetryCount < MAX_SNAPSHOT_RETRIES) {
        this.snapshotRetryCount += 1;
        // episode 原因复用；非请求主动推送（Host 超时阶梯）被拒时无 episode
        // 上下文，hash 观察口径兜底（reason 仅诊断）
        this.sendSyncRequest(this.recoveryReason ?? 'HASH_MISMATCH');
        return;
      }
      this.recoveryInFlight = false;
      this.utils.setSyncState(OnlineSyncState.SYNC_FAILED, this.lastSyncReasonValue);
      return;
    }
    // Validation already checked the deep shape. Narrow it explicitly for TypeScript.
    if (!isStateSnapshotPayload(envelope.payload)) return;
    const snapshotKey = `${validation.snapshot.turnId}:${envelope.payload.stateHash}`;
    if (validation.snapshot.turnId < this.latestAuthoritativeTurnId) {
      return; // New sequence does not make an older snapshot fresh.
    }
    if (
      !this.recoveryInFlight &&
      this.snapshotRetryCount === 0 &&
      this.lastAppliedSnapshotKey === snapshotKey
    ) {
      // 相同权威数据可用新 sequence 重推。补 ACK 即可，不能把已完成
      // 转场的 ACTION 回写成旧 END，也不能再次启动同一场景转场。
      this.sendAck(validation.snapshot.turnId, envelope.payload.stateHash, true);
      return;
    }
    this.utils.setSyncState(
      OnlineSyncState.APPLYING_SNAPSHOT,
      `turn:${envelope.payload.generatedAtTurnId}`,
    );
    const { stateHash } = applyAuthoritativeSnapshot(this.deps.getState(), validation.snapshot);
    this.pendingHashResult = null;
    this.pendingNextTurnItems = [];
    this.itemEventTurn = validation.snapshot.turnId;
    this.appliedItemEvents.clear();
    this.deps.clearPendingItemUse?.();
    this.pendingTurnResult = null;
    this.pendingLocalResolve = null;
    this.snapshotWithoutLocalFlight = validation.snapshot.phase === TurnPhase.PROJECTILE;
    this.lastPresentedTurnId = Math.max(this.lastPresentedTurnId,
      validation.snapshot.phase === TurnPhase.RESOLVE || validation.snapshot.phase === TurnPhase.GAME_OVER
        ? validation.snapshot.turnId : validation.snapshot.turnId - 1);
    if (stateHash !== envelope.payload.stateHash) {
      // validator 已验自洽，apply 后仍不符 = hash/apply 契约破裂 —— 重试无意义
      this.recoveryInFlight = false;
      this.lastSyncReasonValue = `SNAPSHOT_APPLY_MISMATCH(${stateHash}!=${envelope.payload.stateHash})`;
      this.utils.setSyncState(OnlineSyncState.SYNC_FAILED, this.lastSyncReasonValue);
      return;
    }
    // ---- 恢复成功 ----
    this.recoveryInFlight = false;
    this.snapshotRetryCount = 0;
    this.recoveryCountValue += 1;
    this.lastSyncReasonValue = `RECOVERED(turn:${validation.snapshot.turnId})`;
    this.hostHashValue = envelope.payload.stateHash;
    this.localHashValue = stateHash;
    this.hashMatch = true;
    // 快照即权威结算（含已结算回合）—— 后续 TURN_END 可信。若快照
    // 已是下一回合，则场景表现回调恢复 END/ACTION，不等旧包重发。
    this.receivedTurnResult = true;
    this.pendingTurnEnd = null;
    // 恢复即视为 post-turn 表现停留完成：本地可能没有炮弹在飞
    //（例如篡改 turnId 后 FIRE 被 WRONG_TURN 拒），dwell 语义由快照
    // 兜底 —— 后续 TURN_END 直接推进（Force Desync E2E 实测）
    this.dwellComplete = true;
    this.finalConfirmedValue = this.deps.getState().gameOver;
    this.deps.setSyncLock?.(false);
    this.utils.setSyncState(
      OnlineSyncState.SYNCED_AFTER_RECOVERY,
      `turn:${validation.snapshot.turnId}`,
    );
    // 补发本回合 ACK（Host barrier 在等）；Host 未在等待时会幂等忽略
    // 必须先于表现回调：END 转场收尾可能立即把本地 phase 改为 ACTION。
    this.sendAck(validation.snapshot.turnId, stateHash, true);
    this.lastAppliedSnapshotKey = snapshotKey;
    this.latestAuthoritativeTurnId = validation.snapshot.turnId;
    this.deps.onSnapshotApplied?.(validation.snapshot);
  }

  private handleCommandRejected(envelope: NetworkEnvelope<unknown>): void {
    if (
      !this.utils.guardInbound(envelope, NetworkMessageType.COMMAND_REJECTED, isCommandRejectedPayload)
    ) {
      return;
    }
    if (envelope.turnId !== this.deps.getState().turnId) return;
    if (envelope.payload.commandType === 'USE_ITEM') this.deps.clearPendingItemUse?.(envelope.payload.operationId);
    this.deps.showRejected(envelope.payload);
  }

  /** 跳回合防线（DataChannel 有序 —— 跳号说明本地状态已损坏） */
  private isFutureTurnJump(envelopeTurnId: number, kind: string): boolean {
    if (envelopeTurnId > this.deps.getState().turnId + 1) {
      this.beginRecovery('INVALID_LOCAL_STATE', `${kind}_FUTURE(turn:${envelopeTurnId})`);
      return true;
    }
    return false;
  }

  /** 进入恢复：锁输入 → 发 STATE_SYNC_REQUEST（幂等：恢复在途不重发） */
  private beginRecovery(reason: StateSyncReason, detail: string): void {
    if (this.recoveryInFlight) {
      return;
    }
    this.recoveryInFlight = true;
    this.recoveryReason = reason;
    this.snapshotRetryCount = 0;
    this.lastSyncReasonValue = `${reason}:${detail}`;
    this.utils.setSyncState(OnlineSyncState.DESYNC_DETECTED, this.lastSyncReasonValue);
    this.deps.setSyncLock?.(true);
    this.sendSyncRequest(reason);
  }

  private sendSyncRequest(reason: StateSyncReason): void {
    const state = this.deps.getState();
    this.utils.sendOut(
      NetworkMessageType.STATE_SYNC_REQUEST,
      {
        expectedTurnId: state.turnId,
        localStateHash: computeStateHash(state),
        // MISSING / 跳回合场景从未观察到 Host hash —— 占位（wire 要求非空）
        authoritativeHash: this.hostHashValue ?? 'UNKNOWN',
        reason,
      },
      null,
    );
    this.utils.setSyncState(OnlineSyncState.SYNC_REQUESTED, reason);
  }

  private sendAck(turnId: number, stateHash: string, recovered: boolean): void {
    this.utils.sendOut(
      NetworkMessageType.TURN_RESULT_ACK,
      { turnId, stateHash, recovered },
      null,
    );
  }

  /** 权威推进 + resume；回合未落地（applyRemoteTurnEnd 静默 no-op）→ 恢复 */
  private applyTurnEnd(payload: TurnEndPayload): boolean {
    this.deps.turnManager.applyRemoteTurnEnd(payload.nextPlayerId, payload.nextTurnId);
    if (this.deps.getState().turnId !== payload.nextTurnId) {
      this.pendingTurnEnd = null;
      this.beginRecovery('INVALID_LOCAL_STATE', `TURN_END_NOT_APPLIED(turn:${payload.nextTurnId})`);
      return false;
    }
    const nextTurnItems = this.pendingNextTurnItems;
    this.pendingNextTurnItems = [];
    for (const items of nextTurnItems) {
      if (items.turnId === payload.nextTurnId) {
        this.applyUniqueItemEvent(items);
      }
    }
    this.dwellComplete = false;
    this.snapshotWithoutLocalFlight = false;
    this.pendingTurnResult = null;
    this.pendingLocalResolve = null;
    this.pendingTurnEnd = null;
    this.receivedTurnResult = false;
    this.deps.resumeNextTurn();
    return true;
  }

  /** 双条件齐备 → 合成权威伤害展示（数值全取 Host payload） */
  private flushAuthoritativeDamage(): void {
    const result = this.pendingTurnResult;
    const local = this.pendingLocalResolve;
    if (result === null || local === null) {
      return;
    }
    this.lastPresentedTurnId = result.turnId;
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

function sameAirstrike(a: AirstrikeContext, b: AirstrikeContext): boolean {
  return a.itemId === b.itemId && a.ownerId === b.ownerId && a.turnId === b.turnId &&
    a.resumePhase === b.resumePhase && a.target.x === b.target.x && a.target.y === b.target.y;
}
