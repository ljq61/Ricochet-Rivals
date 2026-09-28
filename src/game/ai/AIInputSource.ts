import { GAME_CONFIG, type AIDifficulty } from '../config/GameConfig';
import type { CommandBus } from '../commands/CommandBus';
import type { FireCommand, MoveCommand } from '../commands/GameCommand';
import type { InputSource } from '../input/InputSource';
import { getLaunchOrigin } from '../physics/aimMath';
import type { RandomSource } from '../random/SeededRandom';
import { TurnPhase } from '../state/TurnPhase';
import type { GameState } from '../state/GameState';
import type { PlayerId } from '../state/ids';
import { AIController, type AIDecision, type AIFirePlan } from './AIController';
import { velocityFromAngleSpeed } from './TrajectorySolver';

/**
 * AIInputSource（Phase 10）—— SP AI 的输入适配器，实现 InputSource 契约。
 *
 * 与人类 / 未来网络输入完全同构：只产出 GameCommand（MOVE / FIRE），
 * 经 CommandBus → GameLogic → MovementSystem / FireSystem 校验执行，
 * 不触碰任何 PlayerState / Sprite / Camera / Scene 内部（架构红线）。
 *
 * 内部小状态机（表现层节奏，延迟全部 seeded）：
 *   idle →（轮到本方 ACTION 且未发射）→ thinking（思考 500~900ms）
 *     → 有移动：发 MOVE → moving（停顿 250~500ms）→ 发 FIRE
 *     → 无移动：直接发 FIRE
 *   发射后本回合静默（hasFired 由 FireSystem 标记，canAct 自然失效）。
 *
 * 表现延迟只存在于这一层；AIController.decide 保持纯函数零延迟。
 * 相机零耦合：FIRE 生效后 ProjectileSystem.onLaunched 事件链自动
 * 驱动 PROJECTILE_FOLLOW（与人类同一入口）。
 */

export interface AIInputSourceDeps {
  /** AI 控制的玩家（SP：P2） */
  playerId: PlayerId;
  getState: () => GameState;
  commandBus: CommandBus;
  /** SeededRandom（CODELY.md §16；SP 从 GameState.seed 构造） */
  rng: RandomSource;
  difficulty: AIDifficulty;
}

type AIMachinePhase = 'idle' | 'thinking' | 'moving';

export class AIInputSource implements InputSource {
  readonly playerId: PlayerId;

  private readonly getState: () => GameState;
  private readonly commandBus: CommandBus;
  private readonly rng: RandomSource;
  private readonly controller: AIController;

  private enabled = false;
  private phase: AIMachinePhase = 'idle';
  private elapsedMs = 0;
  private thinkDelayMs = 0;
  private postMoveDelayMs = 0;
  private decision: AIDecision | null = null;

  constructor(deps: AIInputSourceDeps) {
    this.playerId = deps.playerId;
    this.getState = deps.getState;
    this.commandBus = deps.commandBus;
    this.rng = deps.rng;
    this.controller = new AIController(deps.difficulty);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  update(deltaMs: number): void {
    if (!(deltaMs > 0)) {
      return;
    }
    const state = this.getState();

    // 门禁不满足（未激活 / 非本方回合 / 非法相位 / 已发射 / 已结束）：
    // 安全放弃并复位，等待下一次合法窗口
    if (!this.canAct(state)) {
      this.reset();
      return;
    }

    switch (this.phase) {
      case 'idle':
        this.engage(state);
        break;
      case 'thinking':
        this.tickThink(state, deltaMs);
        break;
      case 'moving':
        this.tickMoveWait(state, deltaMs);
        break;
    }
  }

  destroy(): void {
    this.reset();
  }

  // ---- 状态机 -------------------------------------------------------------

  /** 进入本方回合：掷思考延迟 + 决策（决策本身零延迟，延迟只影响节奏） */
  private engage(state: GameState): void {
    this.thinkDelayMs = this.rng.range(
      GAME_CONFIG.ai.thinkDelayMs.min,
      GAME_CONFIG.ai.thinkDelayMs.max
    );
    this.postMoveDelayMs = this.rng.range(
      GAME_CONFIG.ai.postMoveDelayMs.min,
      GAME_CONFIG.ai.postMoveDelayMs.max
    );
    this.decision = this.controller.decide(state, this.rng);
    this.elapsedMs = 0;
    this.phase = 'thinking';
  }

  private tickThink(state: GameState, deltaMs: number): void {
    this.elapsedMs += deltaMs;
    if (this.elapsedMs < this.thinkDelayMs) {
      return;
    }
    const decision = this.decision;
    if (!decision?.fire) {
      this.reset(); // 防御：无有效决策不空转（正常流程不会发生）
      return;
    }
    if (decision.moveTargetX !== null) {
      const command: MoveCommand = {
        type: 'MOVE',
        playerId: this.playerId,
        turnId: state.turnId,
        targetX: decision.moveTargetX,
      };
      this.commandBus.dispatch(command);
      this.elapsedMs = 0;
      this.phase = 'moving';
      return;
    }
    this.fire(state, decision.fire);
  }

  private tickMoveWait(state: GameState, deltaMs: number): void {
    this.elapsedMs += deltaMs;
    if (this.elapsedMs < this.postMoveDelayMs) {
      return;
    }
    const decision = this.decision;
    if (!decision?.fire) {
      this.reset();
      return;
    }
    this.fire(state, decision.fire);
  }

  /** 组装并提交 FireCommand（start 用发射瞬间的炮塔位置 —— 移动后坐标正确） */
  private fire(state: GameState, plan: AIFirePlan): void {
    const player = state.players[this.playerId];
    const origin = getLaunchOrigin(player);
    const { velocityX, velocityY } = velocityFromAngleSpeed(
      plan.angleDeg,
      plan.speed
    );
    const command: FireCommand = {
      type: 'FIRE',
      playerId: this.playerId,
      turnId: state.turnId,
      weaponId: player.weaponId,
      startX: origin.x,
      startY: origin.y,
      velocityX,
      velocityY,
      seed: state.seed,
    };
    this.commandBus.dispatch(command);
    // 本回合静默（hasFired 已由 FireSystem 标记，canAct 之后自然失效）
    this.reset();
  }

  /** 行动门禁：与 FireSystem 校验集对齐并严格窄化（仅 ACTION） */
  private canAct(state: GameState): boolean {
    return (
      this.enabled &&
      !state.gameOver &&
      state.currentPlayerId === this.playerId &&
      state.phase === TurnPhase.ACTION &&
      state.players[this.playerId].isAlive &&
      !state.players[this.playerId].hasFired
    );
  }

  private reset(): void {
    this.phase = 'idle';
    this.decision = null;
    this.elapsedMs = 0;
    this.thinkDelayMs = 0;
    this.postMoveDelayMs = 0;
  }
}
