import type { GameCommand } from './GameCommand';

/**
 * CommandBus 契约（CODELY.md §4）：
 * 所有 InputSource（Human / AI / Network）通过 Bus 提交命令，
 * Game Logic 只从 Bus 消费，不感知命令来源。
 */
export interface CommandBus {
  dispatch(command: GameCommand): void;

  subscribe(
    handler: (command: GameCommand) => void
  ): () => void;
}

/**
 * 同步内存实现。单机 / 本地双人足够；
 * 网络模式下 Guest 的命令经网络转发后仍汇入同一个 Bus。
 */
export class InMemoryCommandBus implements CommandBus {
  private readonly handlers = new Set<(command: GameCommand) => void>();

  dispatch(command: GameCommand): void {
    for (const handler of this.handlers) {
      handler(command);
    }
  }

  subscribe(handler: (command: GameCommand) => void): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }
}
