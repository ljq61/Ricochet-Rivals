import type { CommandBus } from '../commands/CommandBus';
import type {
  FireCommand,
  GameCommand,
  MoveCommand,
  UseItemCommand,
} from '../commands/GameCommand';
import type { GameState } from '../state/GameState';
import type { FireResult, FireSystem } from './FireSystem';
import type { MovementResult, MovementSystem } from './MovementSystem';
import type { ProjectileSystem } from './ProjectileSystem';
import { ItemSystem, type UseItemResult } from './ItemSystem';
import type { AirstrikeContext, AirstrikeResult } from '../state/AirstrikeState';
import { AirstrikeSystem } from './AirstrikeSystem';

export interface GameLogicSystems {
  movement: MovementSystem;
  fire: FireSystem;
  projectile: ProjectileSystem;
  items?: ItemSystem;
  airstrike?: AirstrikeSystem;
}

/**
 * 命令执行结果（Phase 14 Host 广播源）：
 * MOVE / FIRE 不论 accepted 还是 rejected 都产出 outcome ——
 * Host 用 reject reason 构造 COMMAND_REJECTED 回执广播给 Guest。
 * READY 保持被忽略，不产出 outcome。
 */
export type CommandOutcome =
  | {
      readonly kind: 'MOVE';
      readonly command: MoveCommand;
      readonly result: MovementResult;
    }
  | {
      readonly kind: 'FIRE';
      readonly command: FireCommand;
      readonly result: FireResult;
    }
  | { readonly kind: 'USE_ITEM'; readonly command: UseItemCommand; readonly result: UseItemResult };

/**
 * Game Logic 核心：订阅 CommandBus，把命令路由到对应系统。
 *
 * 这是所有输入（Human / AI / Network）的共同终点，
 * Scene 只负责把 Bus 和系统连接起来，不参与路由。
 *
 * FIRE：先经 FireSystem 校验（每回合限一次），通过后由
 * ProjectileSystem 生成炮弹（TASKS Phase 5 流程）。
 * Phase 7 在炮弹爆炸处接 ExplosionEvent → DamageSystem，
 * Phase 8 扩展完整回合流程。
 * Phase 14：MOVE / FIRE 经系统执行后同步对全部订阅者发射
 * CommandOutcome（accepted / rejected 都发）——Host 本地输入与
 * Guest 网络请求走同一条 validate+execute 路径，订阅 outcome
 * 即可把权威执行结果广播出去；无订阅者时行为与离线模式一致。
 */
export class GameLogic {
  private readonly unsubscribe: () => void;
  private readonly airstrikeStartedHandlers = new Set<(context: AirstrikeContext) => void>();
  private readonly airstrikeResolvedHandlers = new Set<(result: AirstrikeResult) => void>();

  private readonly outcomeHandlers = new Set<
    (outcome: CommandOutcome) => void
  >();

  constructor(
    private readonly state: GameState,
    commandBus: CommandBus,
    private readonly systems: GameLogicSystems
  ) {
    this.unsubscribe = commandBus.subscribe(this.handleCommand);
  }

  /**
   * 订阅命令执行结果（accepted / rejected 均会发射）。
   * 返回取消函数，风格对齐 CommandBus.subscribe /
   * ProjectileSystem.onLaunched。单个 handler 抛错只
   * console.error，不阻断其余 handler 与命令执行。
   */
  onOutcome(handler: (outcome: CommandOutcome) => void): () => void {
    this.outcomeHandlers.add(handler);
    return () => {
      this.outcomeHandlers.delete(handler);
    };
  }

  onAirstrikeStarted(handler: (context: AirstrikeContext) => void): () => void {
    this.airstrikeStartedHandlers.add(handler);
    return () => { this.airstrikeStartedHandlers.delete(handler); };
  }

  onAirstrikeResolved(handler: (result: AirstrikeResult) => void): () => void {
    this.airstrikeResolvedHandlers.add(handler);
    return () => { this.airstrikeResolvedHandlers.delete(handler); };
  }

  resolveAirstrike(expected?: { itemId: string; turnId: number }): AirstrikeResult | null {
    const result = (this.systems.airstrike ?? new AirstrikeSystem()).resolve(this.state, expected);
    if (result) this.emitAirstrike(this.airstrikeResolvedHandlers, result);
    return result;
  }

  private emitAirstrike<T>(handlers: Set<(value: T) => void>, value: T): void {
    for (const handler of handlers) {
      try { handler(value); } catch (error) {
        console.error('[GameLogic] Airstrike handler threw:', error);
      }
    }
  }

  private readonly handleCommand = (command: GameCommand): void => {
    if (command.type === 'MOVE') {
      const result = this.systems.movement.execute(this.state, command);
      this.emitOutcome({ kind: 'MOVE', command, result });
    } else if (command.type === 'FIRE') {
      const result = this.systems.fire.execute(this.state, command);
      if (result.accepted) {
        this.systems.projectile.launch(command, result.shot);
      }
      this.emitOutcome({ kind: 'FIRE', command, result });
    } else if (command.type === 'USE_ITEM') {
      const result = (this.systems.items ?? new ItemSystem()).execute(this.state, command);
      this.emitOutcome({ kind: 'USE_ITEM', command, result });
      if (result.accepted && result.airstrike) this.emitAirstrike(this.airstrikeStartedHandlers, result.airstrike);
    }
  };

  private emitOutcome(outcome: CommandOutcome): void {
    for (const handler of this.outcomeHandlers) {
      try {
        handler(outcome);
      } catch (error) {
        // 对齐 NetworkManager 的 handler 兜底风格：单个订阅者异常不阻断广播
        console.error('[GameLogic] CommandOutcome handler threw:', error);
      }
    }
  }

  destroy(): void {
    this.unsubscribe();
    // 防 scene.start 实例复用后旧闭包复活（同 C1 幽灵 AI 坑）
    this.outcomeHandlers.clear();
    this.airstrikeStartedHandlers.clear();
    this.airstrikeResolvedHandlers.clear();
  }
}
