import type { CommandBus } from '../../commands/CommandBus';
import type { GameCommand } from '../../commands/GameCommand';
import type { GameState } from '../../state/GameState';
import { TurnPhase } from '../../state/TurnPhase';
import type {
  FireRequestPayload,
  MoveRequestPayload,
  UseItemRequestPayload,
} from './OnlineTypes';
import type { PlayerId } from '../../state/ids';

/**
 * Guest 意图总线（Phase 14）—— 联机 Guest 侧的 CommandBus 实现。
 *
 * 场景把本实例交给 TouchControls / DesktopControls / AimController
 * （替代真实执行总线）：本地人类命令在此被拦截为 *_REQUEST 上报
 * Host，**绝不本地执行**（Guest 是 Input Client；权威结果经
 * MOVE / FIRE 广播回来后才由 Coordinator 注入真实总线本地播放）。
 *
 * * MOVE：仅 ACTION 相位转发（表现层降噪 —— 与 MovementSystem 同门禁；
 *   权威校验仍在 Host，此处拦截不构成规则层）；payload 无 turnId
 *   （envelope 由 NetworkManager 戳记）。
 * * FIRE：ACTION / RETURN_HOME / AIM 三相位转发（与 FireSystem 门禁
 *   一致）；canonical 参数 7 字段全 finite 才上报（NaN / ∞ 直接丢弃）。
 * * READY：离线语义，联机忽略。
 * * remote playerId 命令：权威命令理论上不进本总线（Coordinator 直接
 *   注入真实总线）—— 防御性 warn + 丢弃。
 * * subscribe：永不被调用（意图总线不本地派发、不持有真实 bus），
 *   返回 no-op 取消函数以满足 CommandBus 接口。
 *
 * 纯逻辑零 Phaser 依赖；Vitest node 环境可测。
 */
export interface GuestIntentBusDeps {
  readonly localPlayerId: PlayerId;
  readonly getState: () => GameState;
  readonly sendMoveRequest: (payload: MoveRequestPayload) => void;
  readonly sendFireRequest: (payload: FireRequestPayload) => void;
  readonly sendUseItemRequest?: (payload: UseItemRequestPayload) => void;
  readonly onItemUsePendingChange?: (pending: boolean) => void;
  readonly onItemUseTimeout?: () => void;
}

export class GuestIntentBus implements CommandBus {
  private readonly localPlayerId: PlayerId;
  private readonly remotePlayerId: PlayerId;
  private readonly deps: GuestIntentBusDeps;

  private pendingOperationId: string | null = null;
  private operationCounter = 0;
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;

  get itemUsePending(): boolean { return this.pendingOperationId !== null; }

  clearPendingItemUse(operationId?: string): void {
    if (operationId !== undefined && operationId !== this.pendingOperationId) return;
    if (this.pendingTimer !== null) clearTimeout(this.pendingTimer);
    this.pendingTimer = null;
    if (this.pendingOperationId === null) return;
    this.pendingOperationId = null;
    this.deps.onItemUsePendingChange?.(false);
  }

  destroy(): void { this.clearPendingItemUse(); }

  constructor(deps: GuestIntentBusDeps) {
    this.deps = deps;
    this.localPlayerId = deps.localPlayerId;
    this.remotePlayerId = deps.localPlayerId === 'P1' ? 'P2' : 'P1';
  }

  dispatch(command: GameCommand): void {
    if (command.playerId === this.remotePlayerId) {
      // 权威命令走 Coordinator → 真实总线，不进意图总线 —— 防御
      console.warn(
        `[GuestIntentBus] dropped authoritative command for ${command.playerId} (must enter via real bus)`,
      );
      return;
    }
    if (command.playerId !== this.localPlayerId) {
      // PlayerId 只有 P1/P2，上面两支已全覆盖 —— 逻辑不可达，防御收口
      console.warn(`[GuestIntentBus] dropped command with unknown player ${String(command.playerId)}`);
      return;
    }
    if (command.type === 'USE_ITEM') {
      const state = this.deps.getState();
      const phaseAllows = state.phase === TurnPhase.ACTION || state.phase === TurnPhase.AIM;
      if (this.itemUsePending || !this.deps.sendUseItemRequest || !phaseAllows ||
        command.turnId !== state.turnId || state.currentPlayerId !== this.localPlayerId ||
        state.gameOver || state.players[this.localPlayerId].hasFired || state.players[this.localPlayerId].itemUsedThisTurn) return;
      const operationId = command.operationId ?? `item:${state.turnId}:${++this.operationCounter}`;
      if (command.itemId.length === 0 || command.itemId.length > 128 || operationId.length === 0 || operationId.length > 128) return;
      this.pendingOperationId = operationId;
      this.deps.onItemUsePendingChange?.(true);
      this.pendingTimer = setTimeout(() => {
        this.pendingTimer = null;
        this.deps.onItemUseTimeout?.();
      }, 8_000);
      try {
        this.deps.sendUseItemRequest({ playerId: command.playerId, itemId: command.itemId, operationId, resumePhase: state.phase as TurnPhase.ACTION | TurnPhase.AIM });
      } catch (error) {
        this.clearPendingItemUse();
        throw error;
      }
      return;
    }
    if (this.itemUsePending) return;
    if (command.type === 'MOVE') {
      const state = this.deps.getState();
      if (
        state.phase === TurnPhase.ACTION &&
        Number.isFinite(command.targetX)
      ) {
        // 本地 State 等待权威回包，因此传递本帧意图增量；Host 用其
        // 当前权威位置累加，不能把尚未回包的旧位置当作新目标。
        this.deps.sendMoveRequest({
          playerId: command.playerId,
          deltaX: command.targetX - state.players[command.playerId].x,
          targetX: command.targetX, // 旧Host继续读取absolute意图，新Host优先deltaX。
        });
      }
      return;
    }
    if (command.type === 'FIRE') {
      const state = this.deps.getState();
      const phaseAllows =
        state.phase === TurnPhase.ACTION ||
        state.phase === TurnPhase.RETURN_HOME ||
        state.phase === TurnPhase.AIM;
      if (
        phaseAllows &&
        Number.isFinite(command.startX) &&
        Number.isFinite(command.startY) &&
        Number.isFinite(command.velocityX) &&
        Number.isFinite(command.velocityY) &&
        Number.isFinite(command.seed)
      ) {
        this.deps.sendFireRequest({
          playerId: command.playerId,
          weaponId: command.weaponId,
          startX: command.startX,
          startY: command.startY,
          velocityX: command.velocityX,
          velocityY: command.velocityY,
          seed: command.seed,
          ...(command.itemId === undefined ? {} : { itemId: command.itemId }),
        });
      }
      return;
    }
    // READY：离线语义（对局开始提示），联机零处理
  }

  subscribe(_handler: (command: GameCommand) => void): () => void {
    // 意图总线从不本地派发 —— no-op（防 noUnusedParameters 豁免已加下划线）
    return () => {
      /* no-op：GuestIntentBus 无订阅者语义 */
    };
  }
}
