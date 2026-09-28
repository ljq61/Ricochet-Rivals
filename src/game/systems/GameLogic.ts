import type { CommandBus } from '../commands/CommandBus';
import type { GameCommand } from '../commands/GameCommand';
import type { GameState } from '../state/GameState';
import type { FireSystem } from './FireSystem';
import type { MovementSystem } from './MovementSystem';
import type { ProjectileSystem } from './ProjectileSystem';

export interface GameLogicSystems {
  movement: MovementSystem;
  fire: FireSystem;
  projectile: ProjectileSystem;
}

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
 */
export class GameLogic {
  private readonly unsubscribe: () => void;

  constructor(
    private readonly state: GameState,
    commandBus: CommandBus,
    private readonly systems: GameLogicSystems
  ) {
    this.unsubscribe = commandBus.subscribe(this.handleCommand);
  }

  private readonly handleCommand = (command: GameCommand): void => {
    if (command.type === 'MOVE') {
      this.systems.movement.execute(this.state, command);
    } else if (command.type === 'FIRE') {
      const result = this.systems.fire.execute(this.state, command);
      if (result.accepted) {
        this.systems.projectile.launch(command);
      }
    }
  };

  destroy(): void {
    this.unsubscribe();
  }
}
