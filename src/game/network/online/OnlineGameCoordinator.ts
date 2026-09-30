import type { CommandBus } from '../../commands/CommandBus';
import { createInitialGameState } from '../../state/GameState';
import { ConcreteDamageSystem, type DamageSystem } from '../../systems/DamageSystem';
import { NetworkMessageType } from '../NetworkMessageType';
import type { NetworkEnvelope } from '../NetworkEnvelope';
import type { NetworkManager } from '../NetworkManager';
import type { OnlineSession } from '../OnlineSession';
import { buildSnapshot } from './AuthoritativeState';
import { GuestIntentBus } from './GuestIntentBus';
import {
  OnlineHostChannel,
  type OnlineChannelUtils,
} from './OnlineHostChannel';
import { GuestAuthoritativeDamage, OnlineGuestChannel } from './OnlineGuestChannel';
import { isGameStartPayload, isPlayerReadyPayload } from './OnlinePayloads';
import { OnlineSyncState } from './sync/OnlineSyncState';
import type {
  GameStartPayload,
  OnlineBattleBootstrap,
  OnlineBattleDeps,
  OnlineCoordinatorOptions,
  OnlineDebugInfo,
  OnlineGameCoordinatorApi,
  OnlineLobbyHandlers,
  StateSyncDiagnostics,
} from './OnlineTypes';
import type { CommandRejectedReason } from './CommandRejectedReason';
import type { DamageResult } from '../../state/DamageResult';
import type { ProjectileImpact } from '../../state/ExplosionEvent';
import type { PlayerId } from '../../state/ids';

/**
 * OnlineGameCoordinator（Phase 14/15）—— 联机协调器生命周期壳。
 *
 * 架构位置：BattleScene 只经本类（OnlineGameCoordinatorApi）与网络层交互；
 * TurnManager / Movement / Projectile 系统内零 if (isHost)。Host / Guest
 * 的协议分支集中在 OnlineHostChannel / OnlineGuestChannel，本类只负责：
 *
 * * Lobby 握手（PLAYER_READY → Host 汇齐 → GAME_START）
 * * Battle attach（按角色装配 channel / inputBus / damageSystem）
 * * Phase 15 同步状态机单一事实源（setSyncState → deps 转发 + 终局去重）
 * * 诊断（debugInfo / RTT / 保活 / getSyncDiagnostics）与断线路由
 * * 入站三防线与统一出站口（OnlineChannelUtils 实现，两 channel 复用）
 *
 * 生命周期：enterLobby → sendPlayerReady → attach → dispose。
 * Host = P1 = 权威；Guest = P2 = 意图客户端（GuestIntentBus 转 *_REQUEST）。
 * 红线：零 RTC API（只经 NetworkManager）；语义校验全在系统层；
 * outcome 广播内禁止 dispatch（重入，见 OnlineHostChannel）。
 */
export class OnlineGameCoordinator implements OnlineGameCoordinatorApi, OnlineChannelUtils {
  private readonly session: OnlineSession;
  private readonly nm: NetworkManager;
  private readonly createMatchIdentity: () => { matchId: string; seed: number };
  private readonly cancels: Array<() => void> = [];

  private lobbyHandlers: OnlineLobbyHandlers | null = null;
  private battleDeps: OnlineBattleDeps | null = null;
  private hostChannel: OnlineHostChannel | null = null;
  private guestChannel: OnlineGuestChannel | null = null;
  private started = false;
  private disposed = false;
  private selfReady = false;
  /** Host 专用：Guest 的 PLAYER_READY 是否已到 */
  private guestReady = false;
  /** Phase 16 对称 ready：Guest 侧记录 Host 的 PLAYER_READY（ResultScene 提示用） */
  private hostReady = false;
  private gameStart: GameStartPayload | null = null;

  /** 幂等防线：每消息类型的最近已处理 sequence（重复 / 重放防护） */
  private readonly lastSequence = new Map<NetworkMessageType, number>();
  private lastRxType: string | null = null;
  private lastTxType: string | null = null;
  private rejectedCount = 0;
  private lastRttMsValue: number | null = null;
  private keepAliveTimer: ReturnType<typeof setInterval> | null = null;
  /**
   * PLAYER_READY 低频重发（订阅时序防线）：对端可能先点 ENTER —— 其
   * Ready 在本端订阅前已投递丢失。重发直到 GAME_START（Host 收重复
   * Ready 幂等忽略）；dispose / started 时清除。原生 setInterval
   * （事件循环驱动，不依赖 rAF —— 后台页冻结时仍可发出）。
   */
  private readyRetryTimer: ReturnType<typeof setInterval> | null = null;

  /** Phase 15：同步状态单一事实源（channel 经 setSyncState 驱动） */
  private syncStateValue: OnlineSyncState = OnlineSyncState.SYNCED;
  /** onSyncFailure 终局去重（每场恰一次） */
  private syncFailureNotified = false;
  private readonly hostAckTimeoutMs: number;

  private inputBusValue: CommandBus | null = null;
  private damageSystemValue: DamageSystem | null = null;

  constructor(options: OnlineCoordinatorOptions) {
    this.session = options.session;
    this.nm = options.session.networkManager;
    this.createMatchIdentity = options.createMatchIdentity;
    this.hostAckTimeoutMs = options.hostAckTimeoutMs ?? 8_000;
    // 通道中断订阅与生命周期同寿（Lobby / Battle 各自回调槽转发）
    this.cancels.push(this.nm.onDisconnect((reason) => this.handleDisconnect(reason)));
  }

  get role(): 'host' | 'guest' {
    return this.session.role;
  }

  get localPlayerId(): PlayerId {
    return this.session.localPlayerId;
  }

  get remotePlayerId(): PlayerId {
    return this.session.remotePlayerId;
  }

  get transport(): OnlineSession['transport'] {
    return this.session.transport;
  }

  get lastRttMs(): number | null {
    return this.lastRttMsValue;
  }

  /** Phase 16：对端 PLAYER_READY 是否已到（对称 ready，ResultScene 提示用） */
  get opponentReady(): boolean {
    return this.role === 'host' ? this.guestReady : this.hostReady;
  }

  // ---- Lobby -----------------------------------------------------------

  enterLobby(handlers: OnlineLobbyHandlers): () => void {
    this.lobbyHandlers = handlers;
    const cancels = [
      this.nm.onMessage(NetworkMessageType.PLAYER_READY, (e) => this.handlePlayerReady(e)),
      this.nm.onMessage(NetworkMessageType.GAME_START, (e) => this.handleGameStart(e)),
    ];
    const cancel = () => {
      for (const c of cancels) {
        c();
      }
      if (this.lobbyHandlers === handlers) {
        this.lobbyHandlers = null;
      }
    };
    this.cancels.push(cancel);
    return cancel;
  }

  sendPlayerReady(): void {
    if (this.disposed) {
      return;
    }
    this.sendOut(NetworkMessageType.PLAYER_READY, { readyAt: Date.now() }, 0);
    this.selfReady = true;
    if (this.role === 'host' && this.guestReady && !this.started) {
      this.startGame();
    }
    // 订阅时序防线：对端可能先点 ENTER（其 PLAYER_READY 在本端订阅
    // 前已投递丢失）—— 低频重发直到 GAME_START（见字段注释）
    if (!this.started && this.readyRetryTimer === null) {
      this.readyRetryTimer = setInterval(() => {
        if (this.disposed || this.started) {
          this.clearReadyRetry();
          return;
        }
        this.sendOut(NetworkMessageType.PLAYER_READY, { readyAt: Date.now() }, 0);
      }, 1_500);
    }
  }

  private clearReadyRetry(): void {
    if (this.readyRetryTimer !== null) {
      clearInterval(this.readyRetryTimer);
      this.readyRetryTimer = null;
    }
  }

  /** Host：汇齐双方 PLAYER_READY → 构建权威初始快照并发送 GAME_START */
  private startGame(): void {
    if (this.started) {
      return;
    }
    const { matchId, seed } = this.createMatchIdentity();
    const state = createInitialGameState({ matchId, seed });
    const payload: GameStartPayload = {
      matchId,
      seed,
      hostPlayerId: 'P1',
      guestPlayerId: 'P2',
      initialState: buildSnapshot(state),
    };
    this.gameStart = payload;
    this.started = true;
    this.clearReadyRetry(); // 握手完成，停重发
    this.sendOut(NetworkMessageType.GAME_START, payload, 0);
    this.lobbyHandlers?.onStart(this.buildBootstrap());
  }

  private buildBootstrap(): OnlineBattleBootstrap {
    if (this.gameStart === null) {
      throw new Error('[OnlineGameCoordinator] bootstrap before GAME_START');
    }
    return { role: this.role, gameStart: this.gameStart, coordinator: this };
  }

  private handlePlayerReady(envelope: NetworkEnvelope<unknown>): void {
    if (!this.guardInbound(envelope, NetworkMessageType.PLAYER_READY, isPlayerReadyPayload)) {
      return;
    }
    if (this.started) {
      return; // 对局进行中重复 Ready 幂等
    }
    if (this.role === 'host') {
      this.guestReady = true;
      if (this.selfReady) {
        this.startGame();
      }
      return;
    }
    // Guest 侧对称记录（Phase 16 Rematch：ResultScene 展示对方已准备）
    this.hostReady = true;
  }

  private handleGameStart(envelope: NetworkEnvelope<unknown>): void {
    if (!this.guardInbound(envelope, NetworkMessageType.GAME_START, isGameStartPayload)) {
      return;
    }
    if (this.role !== 'guest' || this.started) {
      return; // Host 不消费自身广播；重复 GAME_START 幂等
    }
    this.gameStart = envelope.payload;
    this.started = true;
    this.clearReadyRetry(); // 握手完成，停重发
    this.lobbyHandlers?.onStart(this.buildBootstrap());
  }

  // ---- Battle ----------------------------------------------------------

  attach(deps: OnlineBattleDeps): void {
    if (this.disposed) {
      throw new Error('[OnlineGameCoordinator] attach rejected: disposed');
    }
    if (!this.started) {
      throw new Error('[OnlineGameCoordinator] attach rejected: GAME_START not received');
    }
    if (this.battleDeps !== null) {
      throw new Error('[OnlineGameCoordinator] attach called twice');
    }
    this.battleDeps = deps;

    if (this.role === 'host') {
      this.inputBusValue = deps.commandBus; // Host：本地权威执行，outcome 负责广播
      this.damageSystemValue = new ConcreteDamageSystem();
      this.hostChannel = new OnlineHostChannel(
        this.nm,
        this,
        {
          getState: deps.getState,
          commandBus: deps.commandBus,
          gameLogic: deps.gameLogic,
          resumeNextTurn: deps.resumeNextTurn,
        },
        { ackTimeoutMs: this.hostAckTimeoutMs },
      );
      this.cancels.push(this.hostChannel.attach());
      return;
    }
    // Guest：输入拦截为 *_REQUEST（不本地执行）；伤害 calculate-only
    this.inputBusValue = new GuestIntentBus({
      localPlayerId: this.localPlayerId,
      getState: () => deps.getState(),
      sendMoveRequest: (p) => this.sendOut(NetworkMessageType.MOVE_REQUEST, p, null),
      sendFireRequest: (p) => this.sendOut(NetworkMessageType.FIRE_REQUEST, p, null),
    });
    this.damageSystemValue = new GuestAuthoritativeDamage();
    this.guestChannel = new OnlineGuestChannel(this.nm, this.remotePlayerId, this, {
      getState: deps.getState,
      commandBus: deps.commandBus,
      turnManager: deps.turnManager,
      resumeNextTurn: deps.resumeNextTurn,
      showAuthoritativeDamage: deps.showAuthoritativeDamage,
      showRejected: deps.showRejected,
      setSyncLock: deps.setSyncLock,
      onSnapshotApplied: deps.onSnapshotApplied,
    });
    this.cancels.push(this.guestChannel.attach());
  }

  get inputBus(): CommandBus {
    if (this.inputBusValue === null) {
      throw new Error('[OnlineGameCoordinator] inputBus available only after attach()');
    }
    return this.inputBusValue;
  }

  get damageSystem(): DamageSystem {
    if (this.damageSystemValue === null) {
      throw new Error('[OnlineGameCoordinator] damageSystem available only after attach()');
    }
    return this.damageSystemValue;
  }

  isLocalTurn(): boolean {
    return this.requireBattleDeps().getState().currentPlayerId === this.localPlayerId;
  }

  startKeepAlive(): void {
    if (this.disposed || this.keepAliveTimer !== null) {
      return;
    }
    this.cancels.push(
      this.nm.onPong((envelope) => {
        this.lastRttMsValue = Math.max(0, Date.now() - envelope.payload.sentAt);
      }),
    );
    this.keepAliveTimer = setInterval(() => {
      try {
        this.nm.ping();
      } catch {
        // 通道已关：interval 由 dispose 清理
      }
    }, 2_000);
    this.cancels.push(() => {
      if (this.keepAliveTimer !== null) {
        clearInterval(this.keepAliveTimer);
        this.keepAliveTimer = null;
      }
    });
  }

  /** Host：发 TURN_RESULT；Guest：记录本地结算（display / Barrier 半条件） */
  notifyTurnResolved(impact: ProjectileImpact | null, result: DamageResult | null): void {
    this.requireBattleDeps(); // battle 期前置断言
    if (this.hostChannel !== null) {
      this.hostChannel.notifyTurnResolved(impact, result);
      return;
    }
    this.guestChannel?.notifyLocalResolve(impact);
  }

  /** Host：ACK Barrier 判定；Guest：Turn Barrier 双条件判定 */
  onLocalAttackResolved(): 'proceed' | 'waiting' {
    this.requireBattleDeps();
    if (this.hostChannel !== null) {
      return this.hostChannel.onLocalAttackResolved();
    }
    if (this.guestChannel !== null) {
      return this.guestChannel.onDwellComplete();
    }
    return 'waiting'; // 不可达（attach 必建其一）——防御收口
  }

  // ---- Phase 15：同步状态机 / 诊断 / DEBUG ------------------------------

  get syncState(): OnlineSyncState {
    return this.syncStateValue;
  }

  /** channel 驱动入口：记录 → 转发 onSyncStateChange；SYNC_FAILED 首次进入恰一次 onSyncFailure */
  setSyncState(next: OnlineSyncState, detail?: string): void {
    this.syncStateValue = next;
    this.battleDeps?.onSyncStateChange?.(next, detail);
    if (next === OnlineSyncState.SYNC_FAILED && !this.syncFailureNotified) {
      this.syncFailureNotified = true;
      this.battleDeps?.onSyncFailure?.();
    }
  }

  /** Guest：gameOver TURN_RESULT hash 确认；Host：权威 gameOver 即 true */
  isFinalStateConfirmed(): boolean {
    if (this.role === 'host') {
      return this.requireBattleDeps().getState().gameOver;
    }
    return this.guestChannel?.isFinalStateConfirmed ?? false;
  }

  getSyncDiagnostics(): StateSyncDiagnostics {
    const fromChannel =
      this.guestChannel?.syncDiagnostics ?? this.hostChannel?.syncDiagnostics;
    return (
      fromChannel ?? {
        recoveryCount: 0,
        lastSyncReason: null,
        localHash: null,
        hostHash: null,
      }
    );
  }

  /** DEBUG_GAME：Guest 侧制造 desync（下一次 TURN_RESULT 边界自动恢复）；Host no-op */
  debugForceDesync(): void {
    this.guestChannel?.debugForceDesync();
  }

  /**
   * SG-8：连接（ICE restart）恢复后的状态对账 —— 复用 Phase 15 恢复链。
   * Guest：STATE_SYNC_REQUEST(reason=CONNECTION_RECOVERED) → 权威快照；
   * Host no-op —— 权威端状态即事实，Guest 的请求会经既有快照链收敛。
   */
  requestPostReconnectSync(): void {
    if (this.disposed) {
      return;
    }
    this.guestChannel?.requestPostReconnectSync();
  }

  /** SG-8：连接层恢复标记（Host ACK 阶梯挂起 / 恢复窗口不误杀） */
  setConnectionRecoveryActive(active: boolean): void {
    this.hostChannel?.setAckLadderSuspended(active);
  }

  // ---- 断线 / 生命周期 --------------------------------------------------

  private handleDisconnect(reason?: string): void {
    if (this.disposed) {
      return;
    }
    const deps = this.battleDeps;
    if (deps !== null) {
      if (deps.getState().gameOver) {
        // 对局已结束的正常关闭 —— 不触发 OPPONENT DISCONNECTED
        console.warn('[OnlineGameCoordinator] post-game disconnect suppressed');
        return;
      }
      deps.onDisconnected(reason);
      return;
    }
    this.lobbyHandlers?.onDisconnected(reason);
  }

  debugInfo(): OnlineDebugInfo {
    const sync = this.getSyncDiagnostics();
    return {
      role: this.role,
      localPlayerId: this.localPlayerId,
      remotePlayerId: this.remotePlayerId,
      matchId: this.gameStart?.matchId ?? null,
      netState: this.nm.state,
      pingMs: this.lastRttMsValue,
      lastRxType: this.lastRxType,
      lastTxType: this.lastTxType,
      rejectedCount: this.rejectedCount,
      lastHashMatch: this.guestChannel?.lastHashMatch ?? null,
      syncState: this.syncStateValue,
      selfReady: this.selfReady,
      started: this.started,
      recoveryCount: sync.recoveryCount,
      lastSyncReason: sync.lastSyncReason,
      localHash: sync.localHash,
      hostHash: sync.hostHash,
    };
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.clearReadyRetry();
    for (const cancel of this.cancels) {
      cancel();
    }
    this.cancels.length = 0;
    this.lobbyHandlers = null;
    this.battleDeps = null;
    this.hostChannel = null;
    this.guestChannel = null;
    // 尽力而为通知对端（通道已关则静默）；Session 销毁归 SessionManager
    try {
      this.nm.setTurnId(0);
      this.nm.send(NetworkMessageType.DISCONNECT, { reason: 'USER_EXIT' });
    } catch {
      // 通道已断
    }
  }

  // ---- OnlineChannelUtils（两 channel 复用的共享口径） ------------------

  private requireBattleDeps(): OnlineBattleDeps {
    if (this.battleDeps === null) {
      throw new Error('[OnlineGameCoordinator] battle phase required (call attach first)');
    }
    return this.battleDeps;
  }

  /**
   * 入站三防线（顺序固定）：disposed → payload 形状 → matchId → senderId →
   * sequence 幂等。返回 false = 丢弃；lastRxType 最外层记录（含被丢弃消息）。
   * 类型谓词：true 时 envelope.payload 收窄为通过守卫的 T。
   */
  guardInbound<T>(
    envelope: NetworkEnvelope<unknown>,
    type: NetworkMessageType,
    isPayload: (value: unknown) => value is T,
  ): envelope is NetworkEnvelope<T> {
    this.lastRxType = envelope.type;
    if (this.disposed || envelope.type !== type) {
      return false;
    }
    if (envelope.matchId !== this.nm.matchId) {
      return false;
    }
    if (envelope.senderId !== this.remotePlayerId) {
      return false;
    }
    const last = this.lastSequence.get(type);
    if (last !== undefined && envelope.sequence <= last) {
      return false; // 重复 / 重放（有序通道下 sequence 单调）
    }
    this.lastSequence.set(type, envelope.sequence);
    return isPayload(envelope.payload);
  }

  /** 统一出站口：记录 lastTxType → 戳 turnId（battle = 权威回合，lobby = 0） */
  sendOut<T>(type: NetworkMessageType, payload: T, lobbyTurnId: number | null): void {
    this.lastTxType = type;
    const turnId =
      lobbyTurnId !== null
        ? lobbyTurnId
        : this.battleDeps !== null
          ? this.battleDeps.getState().turnId
          : 0;
    this.nm.setTurnId(turnId);
    this.nm.send(type, payload);
  }

  /** COMMAND_REJECTED 回执（rejectedCount 诊断口径归本类） */
  reject(commandType: 'MOVE' | 'FIRE', reason: CommandRejectedReason): void {
    this.rejectedCount += 1;
    this.sendOut(NetworkMessageType.COMMAND_REJECTED, { commandType, reason }, null);
  }
}
