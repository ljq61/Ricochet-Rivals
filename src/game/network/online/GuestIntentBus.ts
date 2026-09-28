import type { CommandBus } from '../../commands/CommandBus';
import type { GameCommand } from '../../commands/GameCommand';
import type { GameState } from '../../state/GameState';
import { TurnPhase } from '../../state/TurnPhase';
import type {
  FireRequestPayload,
  MoveRequestPayload,
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
}

export class GuestIntentBus implements CommandBus {
  private readonly localPlayerId: PlayerId;
  private readonly remotePlayerId: PlayerId;
  private readonly deps: GuestIntentBusDeps;

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
    if (command.type === 'MOVE') {
      const state = this.deps.getState();
      if (
        state.phase === TurnPhase.ACTION &&
        Number.isFinite(command.targetX)
      ) {
        this.deps.sendMoveRequest({ playerId: command.playerId, targetX: command.targetX });
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
