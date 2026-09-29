import { GAME_CONFIG } from '../../config/GameConfig';
import type { MoveCommand, FireCommand } from '../../commands/GameCommand';
import { getLaunchOrigin } from '../../physics/aimMath';
import type { GameState } from '../../state/GameState';
import type { CommandRejectedReason } from './CommandRejectedReason';
import { NetworkMessageType } from '../NetworkMessageType';
import type { NetworkEnvelope } from '../NetworkEnvelope';
import type { NetworkManager } from '../NetworkManager';
import type { FireRequestPayload, OnlineBattleDeps } from './OnlineTypes';
import type { CommandOutcome } from '../../systems/GameLogic';
import { mapFireRejectReason, mapMovementRejectReason } from './OnlineReasonMap';
import type { PlayerId } from '../../state/ids';
import { buildSnapshot, buildTurnResultPayload, computeStateHash } from './AuthoritativeState';
import {
  isFireRequestPayload,
  isMoveRequestPayload,
  isStateSyncRequestPayload,
  isTurnResultAckPayload,
} from './OnlinePayloads';
import { OnlineSyncState } from './sync/OnlineSyncState';
import type { DamageResult } from '../../state/DamageResult';
import type { ProjectileImpact } from '../../state/ExplosionEvent';
import type { StateSyncDiagnostics, TurnResultPayload } from './OnlineTypes';

/**
 * Host 协议通道（Phase 14）—— 请求验证 + 权威广播的 Host 侧实现。
 *
 * * 请求级守卫（sender / turnId / 存活 / FIRE 参数防线）在此判定；
 *   语义校验（phase / 预算 / hasFired / clamp）全部交给系统层 ——
 *   Host 本地命令与 Guest 请求走同一条 commandBus → GameLogic 路径。
 * * outcome（accepted/rejected 均发）是广播的唯一汇聚点；
 *   **重入红线：outcome handler 内禁止 dispatch，只允许发送网络消息。**
 * * verdict 三态：accept（重建命令入总线）/ reject（回执 COMMAND_REJECTED）/
 *   drop（静默丢弃，如 future turn）。
 */

/** 请求级验证结论（纯函数产出，不含副作用） */
export type RequestVerdict =
  | { readonly kind: 'accept' }
  | { readonly kind: 'reject'; readonly reason: CommandRejectedReason }
  | { readonly kind: 'drop' };

/**
 * MOVE_REQUEST 请求级守卫。调用前提：payload 已过 isMoveRequestPayload、
 * envelope 已过 matchId/senderId/sequence 三防线（OnlineChannelGuard）。
 * payload 只需 playerId（FIRE_REQUEST 复用同一检查序列）。
 */
export function validateMoveRequest(
  state: GameState,
  envelope: NetworkEnvelope<unknown>,
  payload: { readonly playerId: PlayerId },
): RequestVerdict {
  if (payload.playerId !== envelope.senderId) {
    return { kind: 'reject', reason: 'INVALID_PLAYER' };
  }
  if (state.gameOver) {
    return { kind: 'reject', reason: 'INVALID_PHASE' };
  }
  if (envelope.turnId < state.turnId) {
    return { kind: 'reject', reason: 'STALE_TURN' };
  }
  if (envelope.turnId > state.turnId) {
    return { kind: 'drop' }; // future turn：不执行也不回执（顺序异常，warn 由调用方）
  }
  if (payload.playerId !== state.currentPlayerId) {
    return { kind: 'reject', reason: 'WRONG_TURN' };
  }
  if (!state.players[payload.playerId].isAlive) {
    return { kind: 'reject', reason: 'INVALID_PLAYER' };
  }
  return { kind: 'accept' };
}

/**
 * FIRE_REQUEST 请求级守卫：同 MOVE 全部检查 + FIRE 参数防线
 * （速度范围 / 起点贴近权威炮塔 / seed 一致 —— Guest 自报参数不可信）。
 */
export function validateFireRequest(
  state: GameState,
  envelope: NetworkEnvelope<unknown>,
  payload: FireRequestPayload,
): RequestVerdict {
  const base = validateMoveRequest(state, envelope, payload);
  if (base.kind !== 'accept') {
    return base;
  }
  const speed = Math.hypot(payload.velocityX, payload.velocityY);
  const { minLaunchSpeed, maxLaunchSpeed } = GAME_CONFIG.aiming;
  if (speed < minLaunchSpeed || speed > maxLaunchSpeed) {
    return { kind: 'reject', reason: 'INVALID_FIRE' };
  }
  const origin = getLaunchOrigin(state.players[payload.playerId]);
  if (Math.hypot(payload.startX - origin.x, payload.startY - origin.y) > 5) {
    return { kind: 'reject', reason: 'INVALID_FIRE' };
  }
  if (payload.seed !== state.seed) {
    return { kind: 'reject', reason: 'INVALID_FIRE' };
  }
  return { kind: 'accept' };
}

/** Channel 与 Coordinator 的共享工具（由 Coordinator 注入，保持诊断口径统一） */
export interface OnlineChannelUtils {
  /**
   * 入站三防线（disposed / matchId / senderId / sequence 幂等 + payload 守卫）。
   * 类型谓词：返回 true 时 envelope.payload 收窄为通过守卫的 T。
   */
  guardInbound<T>(
    envelope: NetworkEnvelope<unknown>,
    type: NetworkMessageType,
    isPayload: (value: unknown) => value is T,
  ): envelope is NetworkEnvelope<T>;
  /** 统一出站口（记录 lastTxType + 权威回合戳记） */
  sendOut<T>(type: NetworkMessageType, payload: T, lobbyTurnId: number | null): void;
  /** COMMAND_REJECTED 回执（rejectedCount 由 Coordinator 维护） */
  reject(commandType: 'MOVE' | 'FIRE', reason: CommandRejectedReason): void;
  /**
   * Phase 15 同步状态迁移。单一事实源在 Coordinator（syncState 公共口径）：
   * channel 调用本方法，Coordinator 记录并转发 deps.onSyncStateChange，
   * 并在首次进入 SYNC_FAILED 时恰一次触发 deps.onSyncFailure。
   */
  setSyncState(next: OnlineSyncState, detail?: string): void;
}

/** Host 通道依赖（Coordinator attach 后注入） */
export interface OnlineHostChannelDeps {
  getState(): GameState;
  readonly commandBus: OnlineBattleDeps['commandBus'];
  readonly gameLogic: OnlineBattleDeps['gameLogic'];
  /**
   * Phase 15 ACK 补驱：dwell 已完成（onLocalAttackResolved 返回过
   * 'waiting'）而 ACK 后到时，Host 发出 TURN_END 后经此推进下一回合
   * （场景接线语义 = onLocalAttackResolved 返回 'proceed' 后的本地收尾）。
   */
  readonly resumeNextTurn: OnlineBattleDeps['resumeNextTurn'];
}

export interface OnlineHostChannelOptions {
  /** TURN_RESULT → ACK 等待超时（默认 8s；测试注入短值） */
  readonly ackTimeoutMs?: number;
}

export class OnlineHostChannel {
  private readonly nm: NetworkManager;
  private readonly utils: OnlineChannelUtils;
  private readonly deps: OnlineHostChannelDeps;
  /** 当前 dispatch 的命令是否来自 Guest 请求（决定被拒时回执归属） */
  private incomingRequest = false;

  /** ---- Phase 15：TURN_RESULT_ACK Barrier ---- */
  /** 待确认回合（TURN_RESULT.turnId）；null = 已确认 / 无等待 */
  private pendingAckTurn: number | null = null;
  /** 待确认 TURN_RESULT 的 stateHash（Host 状态在 Barrier 期冻结，二者恒相等） */
  private pendingAckHash: string | null = null;
  /** 最近一次发出的 TURN_RESULT（超时重发复用同一 payload —— 状态未变，重算必同值） */
  private lastTurnResult: TurnResultPayload | null = null;
  /** 场景是否已询问 dwell 完成（onLocalAttackResolved 返回过 'waiting'） */
  private dwellAsked = false;
  /** 重试阶梯阶段：1 = 重发 TURN_RESULT，2 = 推送 SNAPSHOT，3 = SYNC_FAILED */
  private ackRetryStage = 0;
  private ackTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly ackTimeoutMs: number;
  private lastSyncReasonValue: string | null = null;
  private localHashValue: string | null = null;
  /** 收到的 Guest ACK hash（诊断；Host 权威 hash 见 localHash） */
  private hostHashValue: string | null = null;
  /** gameOver TURN_RESULT 已被 Guest 确认（诊断） */
  private finalAckedValue = false;

  constructor(
    nm: NetworkManager,
    utils: OnlineChannelUtils,
    deps: OnlineHostChannelDeps,
    options: OnlineHostChannelOptions = {},
  ) {
    this.nm = nm;
    this.utils = utils;
    this.deps = deps;
    this.ackTimeoutMs = options.ackTimeoutMs ?? 8_000;
  }

  /** Phase 15 同步诊断（Host 恢复计数恒 0 —— 权威端无需恢复） */
  get syncDiagnostics(): StateSyncDiagnostics {
    return {
      recoveryCount: 0,
      lastSyncReason: this.lastSyncReasonValue,
      localHash: this.localHashValue ?? computeStateHash(this.deps.getState()),
      hostHash: this.hostHashValue,
    };
  }

  /** gameOver 的 TURN_RESULT 是否已被 Guest ACK（诊断；Host 转场不依赖它） */
  get finalAcked(): boolean {
    return this.finalAckedValue;
  }

  /** 注册 Host 侧订阅；返回取消函数 */
  attach(): () => void {
    const cancels = [
      this.deps.gameLogic.onOutcome((outcome) => this.handleOutcome(outcome)),
      this.nm.onMessage(NetworkMessageType.MOVE_REQUEST, (e) => this.handleMoveRequest(e)),
      this.nm.onMessage(NetworkMessageType.FIRE_REQUEST, (e) => this.handleFireRequest(e)),
      this.nm.onMessage(NetworkMessageType.TURN_RESULT_ACK, (e) => this.handleTurnResultAck(e)),
      this.nm.onMessage(NetworkMessageType.STATE_SYNC_REQUEST, (e) => this.handleStateSyncRequest(e)),
    ];
    return () => {
      this.clearAckTimer();
      for (const cancel of cancels) {
        cancel();
      }
    };
  }

  /**
   * Host：结算完成 → 权威 TURN_RESULT（result 已 apply 进权威状态）。
   * Phase 15 起 TURN_END 改由 ACK Barrier 放行（不再依赖场景节奏）。
   */
  notifyTurnResolved(impact: ProjectileImpact | null, result: DamageResult | null): void {
    const payload = buildTurnResultPayload(this.deps.getState(), impact, result);
    this.pendingAckTurn = payload.turnId;
    this.pendingAckHash = payload.stateHash;
    this.lastTurnResult = payload;
    this.localHashValue = payload.stateHash;
    this.dwellAsked = false;
    this.ackRetryStage = 0;
    this.utils.sendOut(NetworkMessageType.TURN_RESULT, payload, null);
    this.startAckTimer();
  }

  /**
   * Host：dwell 完成 → ACK 已到则授权下一 Turn；未到则 'waiting'
   * （ACK 到达时经 resumeNextTurn 补驱）。gameOver 不被 ACK 阻塞
   * （Host 本地已终局，ACK 仅用于 Guest gate 与诊断）。
   */
  onLocalAttackResolved(): 'proceed' | 'waiting' {
    const state = this.deps.getState();
    if (state.gameOver) {
      return 'proceed';
    }
    if (this.pendingAckTurn === null) {
      this.sendTurnEnd();
      return 'proceed';
    }
    this.dwellAsked = true;
    return 'waiting';
  }

  // ---- Phase 15：ACK Barrier 内部 --------------------------------------

  /**
   * 重试阶梯（上限 3 级，绝不无限循环）：
   * 超时#1 → 重发 TURN_RESULT；超时#2 → 改推主动 STATE_SNAPSHOT
   * （Guest 无请求也接受 —— 推送即恢复）；超时#3 → SYNC_FAILED 终局。
   */
  private onAckTimeout(): void {
    this.ackTimer = null;
    if (this.pendingAckTurn === null) {
      return; // ACK 已到（clearAckTimer 竞态兜底）
    }
    this.ackRetryStage += 1;
    if (this.ackRetryStage === 1) {
      this.lastSyncReasonValue = `ACK_TIMEOUT_RETRY(turn:${this.pendingAckTurn})`;
      if (this.lastTurnResult !== null) {
        this.utils.sendOut(NetworkMessageType.TURN_RESULT, this.lastTurnResult, null);
      }
      this.startAckTimer();
      return;
    }
    if (this.ackRetryStage === 2) {
      this.lastSyncReasonValue = `ACK_TIMEOUT_PUSH_SNAPSHOT(turn:${this.pendingAckTurn})`;
      this.sendStateSnapshot();
      this.startAckTimer();
      return;
    }
    this.lastSyncReasonValue = `SYNC_FAILED_NO_ACK(turn:${this.pendingAckTurn})`;
    this.pendingAckTurn = null;
    this.pendingAckHash = null;
    this.utils.setSyncState(OnlineSyncState.SYNC_FAILED, 'HOST_ACK_EXHAUSTED');
  }

  private startAckTimer(): void {
    this.clearAckTimer();
    this.ackTimer = setTimeout(() => this.onAckTimeout(), this.ackTimeoutMs);
  }

  private clearAckTimer(): void {
    if (this.ackTimer !== null) {
      clearTimeout(this.ackTimer);
      this.ackTimer = null;
    }
  }

  private handleTurnResultAck(envelope: NetworkEnvelope<unknown>): void {
    if (
      !this.utils.guardInbound(envelope, NetworkMessageType.TURN_RESULT_ACK, isTurnResultAckPayload)
    ) {
      return;
    }
    const payload = envelope.payload;
    if (this.pendingAckTurn === null || payload.turnId !== this.pendingAckTurn) {
      console.warn(
        `[OnlineHostChannel] 忽略非预期 TURN_RESULT_ACK（turn ${payload.turnId}，等待 ${this.pendingAckTurn ?? 'none'}）`,
      );
      return;
    }
    const localHash = computeStateHash(this.deps.getState());
    if (payload.stateHash !== localHash || payload.stateHash !== this.pendingAckHash) {
      // Guest 状态与权威不一致 —— 不确认不推进；其恢复链 / 本端 SNAPSHOT 阶梯会收敛
      this.lastSyncReasonValue = `ACK_HASH_MISMATCH(turn:${payload.turnId})`;
      return;
    }
    this.hostHashValue = payload.stateHash;
    this.clearAckTimer();
    this.pendingAckTurn = null;
    this.pendingAckHash = null;
    if (this.deps.getState().gameOver) {
      this.finalAckedValue = true;
      return; // 终局无 TURN_END（Guest 场景经 isFinalStateConfirmed gate 收口）
    }
    if (this.dwellAsked) {
      this.dwellAsked = false;
      this.sendTurnEnd();
      this.deps.resumeNextTurn(); // ACK 后到补驱（唯一驱动方，避免回调/返回值双驱动）
    }
    // ACK 先到：onLocalAttackResolved 将直接放行（'proceed' 路径场景自驱）
  }

  /** Guest 恢复请求 → 回当前权威快照（不信任 Guest 自报 hash，仅诊断记录） */
  private handleStateSyncRequest(envelope: NetworkEnvelope<unknown>): void {
    if (
      !this.utils.guardInbound(
        envelope,
        NetworkMessageType.STATE_SYNC_REQUEST,
        isStateSyncRequestPayload,
      )
    ) {
      return;
    }
    this.lastSyncReasonValue = `SYNC_REQUEST:${envelope.payload.reason}(turn:${envelope.payload.expectedTurnId})`;
    this.sendStateSnapshot();
  }

  private sendStateSnapshot(): void {
    const state = this.deps.getState();
    this.utils.sendOut(
      NetworkMessageType.STATE_SNAPSHOT,
      {
        snapshot: buildSnapshot(state),
        stateHash: computeStateHash(state),
        generatedAtTurnId: state.turnId,
      },
      null,
    );
  }

  private sendTurnEnd(): void {
    const state = this.deps.getState();
    this.utils.sendOut(
      NetworkMessageType.TURN_END,
      {
        nextPlayerId: state.currentPlayerId === 'P1' ? 'P2' : 'P1',
        nextTurnId: state.turnId + 1,
      },
      null,
    );
  }

  // ---- 内部 ------------------------------------------------------------

  /** outcome 广播汇聚点（重入红线：只 send 不 dispatch） */
  private handleOutcome(outcome: CommandOutcome): void {
    if (outcome.result.accepted) {
      if (outcome.kind === 'MOVE') {
        this.utils.sendOut(NetworkMessageType.MOVE, {
          playerId: outcome.command.playerId,
          x: outcome.result.nextX,
          moveRemaining: outcome.result.remainingMovement,
        }, null);
      } else {
        const { type: _type, ...canonical } = outcome.command;
        this.utils.sendOut(NetworkMessageType.FIRE, canonical, null);
      }
      return;
    }
    if (this.incomingRequest) {
      const reason =
        outcome.kind === 'MOVE'
          ? mapMovementRejectReason(outcome.result.reason ?? 'WRONG_PHASE')
          : mapFireRejectReason(outcome.result.reason ?? 'WRONG_PHASE');
      this.utils.reject(outcome.kind, reason);
    }
    // Host 本地命令被拒 → 静默（离线行为不变）
  }

  private handleMoveRequest(envelope: NetworkEnvelope<unknown>): void {
    if (
      !this.utils.guardInbound(envelope, NetworkMessageType.MOVE_REQUEST, isMoveRequestPayload)
    ) {
      return;
    }
    const verdict = validateMoveRequest(this.deps.getState(), envelope, envelope.payload);
    if (verdict.kind === 'drop') {
      console.warn(
        `[OnlineHostChannel] dropped future MOVE_REQUEST (turn ${envelope.turnId})`,
      );
      return;
    }
    if (verdict.kind === 'reject') {
      this.utils.reject('MOVE', verdict.reason);
      return;
    }
    const state = this.deps.getState();
    // 语义校验（phase / 预算 / hasFired / clamp）在 dispatch 路径内由系统层完成
    const command: MoveCommand = {
      type: 'MOVE',
      playerId: envelope.payload.playerId,
      turnId: state.turnId,
      targetX: envelope.payload.targetX,
    };
    this.dispatchIncoming(command);
  }

  private handleFireRequest(envelope: NetworkEnvelope<unknown>): void {
    if (
      !this.utils.guardInbound(envelope, NetworkMessageType.FIRE_REQUEST, isFireRequestPayload)
    ) {
      return;
    }
    const verdict = validateFireRequest(this.deps.getState(), envelope, envelope.payload);
    if (verdict.kind === 'drop') {
      console.warn(
        `[OnlineHostChannel] dropped future FIRE_REQUEST (turn ${envelope.turnId})`,
      );
      return;
    }
    if (verdict.kind === 'reject') {
      this.utils.reject('FIRE', verdict.reason);
      return;
    }
    const state = this.deps.getState();
    const command: FireCommand = {
      type: 'FIRE',
      playerId: envelope.payload.playerId,
      turnId: state.turnId,
      weaponId: envelope.payload.weaponId,
      startX: envelope.payload.startX,
      startY: envelope.payload.startY,
      velocityX: envelope.payload.velocityX,
      velocityY: envelope.payload.velocityY,
      seed: envelope.payload.seed,
    };
    this.dispatchIncoming(command);
  }

  /** 以"来自 Guest"标记 dispatch —— 被拒时 outcome 转 COMMAND_REJECTED 回执 */
  private dispatchIncoming(command: MoveCommand | FireCommand): void {
    this.incomingRequest = true;
    try {
      this.deps.commandBus.dispatch(command);
    } finally {
      this.incomingRequest = false;
    }
  }
}
