import Phaser from 'phaser';
import type { CommandBus } from '../commands/CommandBus';
import type { GameState } from '../state/GameState';
import type { PlayerId } from '../state/ids';
import { MoveInputCore } from './MoveInputCore';
import type { InputSource } from './InputSource';

/**
 * 桌面键盘移动输入（Phase 2；Phase 6.5 起为纯适配器）。
 *
 * - A / D 与 Left / Right 按住时持续移动
 * - 只负责把按键状态归一成 direction，加速 / 命令全部在
 *   MoveInputCore —— 与触屏方向按钮共用同一套移动手感
 * - 控制目标 = 当前回合玩家（Phase 8 热座回合切换后自动跟随；
 *   Phase 10 SP 时 AI 回合由场景 setEnabled(false) 禁用）
 * - 阻止方向键触发浏览器滚动等默认行为
 *
 * 输入层不包含任何游戏规则逻辑。
 */
export class KeyboardMoveInput implements InputSource {
  private readonly core: MoveInputCore;
  private leftKeys: readonly Phaser.Input.Keyboard.Key[] = [];
  private rightKeys: readonly Phaser.Input.Keyboard.Key[] = [];

  constructor(
    scene: Phaser.Scene,
    getState: () => GameState,
    commandBus: CommandBus
  ) {
    this.core = new MoveInputCore(
      () => getState().currentPlayerId,
      getState,
      commandBus
    );

    const keyboard = scene.input.keyboard;
    if (keyboard) {
      keyboard.addCapture('A,D,LEFT,RIGHT');
      const keys = keyboard.addKeys('A,D,LEFT,RIGHT') as Record<
        'A' | 'D' | 'LEFT' | 'RIGHT',
        Phaser.Input.Keyboard.Key
      >;
      this.leftKeys = [keys.A, keys.LEFT];
      this.rightKeys = [keys.D, keys.RIGHT];
    }
  }

  get playerId(): PlayerId {
    return this.core.playerId;
  }

  setEnabled(enabled: boolean): void {
    this.core.setEnabled(enabled);
  }

  update(deltaMs: number): void {
    if (this.leftKeys.length === 0) {
      return;
    }

    const leftDown = this.leftKeys.some((key) => key.isDown);
    const rightDown = this.rightKeys.some((key) => key.isDown);
    this.core.setDirection(
      ((rightDown ? 1 : 0) - (leftDown ? 1 : 0)) as -1 | 0 | 1
    );
    this.core.update(deltaMs);
  }

  destroy(): void {
    this.leftKeys = [];
    this.rightKeys = [];
    this.core.setEnabled(false);
  }
}
