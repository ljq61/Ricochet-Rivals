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
import { buildTurnResultPayload } from './AuthoritativeState';
import { isFireRequestPayload, isMoveRequestPayload } from './OnlinePayloads';
import type { DamageResult } from '../../state/DamageResult';
import type { ProjectileImpact } from '../../state/ExplosionEvent';

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
}

/** Host 通道依赖（Coordinator attach 后注入） */
export interface OnlineHostChannelDeps {
  getState(): GameState;
  readonly commandBus: OnlineBattleDeps['commandBus'];
  readonly gameLogic: OnlineBattleDeps['gameLogic'];
}

export class OnlineHostChannel {
  private readonly nm: NetworkManager;
  private readonly utils: OnlineChannelUtils;
  private readonly deps: OnlineHostChannelDeps;
  /** 当前 dispatch 的命令是否来自 Guest 请求（决定被拒时回执归属） */
  private incomingRequest = false;

  constructor(
    nm: NetworkManager,
    utils: OnlineChannelUtils,
    deps: OnlineHostChannelDeps,
  ) {
    this.nm = nm;
    this.utils = utils;
    this.deps = deps;
  }

  /** 注册 Host 侧订阅；返回取消函数 */
  attach(): () => void {
    const cancels = [
      this.deps.gameLogic.onOutcome((outcome) => this.handleOutcome(outcome)),
      this.nm.onMessage(NetworkMessageType.MOVE_REQUEST, (e) => this.handleMoveRequest(e)),
      this.nm.onMessage(NetworkMessageType.FIRE_REQUEST, (e) => this.handleFireRequest(e)),
    ];
    return () => {
      for (const cancel of cancels) {
        cancel();
      }
    };
  }

  /** Host：结算完成 → 权威 TURN_RESULT（result 已 apply 进权威状态） */
  notifyTurnResolved(impact: ProjectileImpact | null, result: DamageResult | null): void {
    this.utils.sendOut(
      NetworkMessageType.TURN_RESULT,
      buildTurnResultPayload(this.deps.getState(), impact, result),
      null,
    );
  }

  /** Host：dwell 完成 → 授权下一 Turn（gameOver 时不发，场景自行收口） */
  onLocalAttackResolved(): 'proceed' {
    const state = this.deps.getState();
    if (!state.gameOver) {
      this.utils.sendOut(
        NetworkMessageType.TURN_END,
        {
          nextPlayerId: state.currentPlayerId === 'P1' ? 'P2' : 'P1',
          nextTurnId: state.turnId + 1,
        },
        null,
      );
    }
    return 'proceed';
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
