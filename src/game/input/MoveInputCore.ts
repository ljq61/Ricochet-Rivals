import { GAME_CONFIG } from '../config/GameConfig';
import type { CommandBus } from '../commands/CommandBus';
import type { MoveCommand } from '../commands/GameCommand';
import type { GameState } from '../state/GameState';
import type { PlayerId } from '../state/ids';
import { moveToward } from '../utils/MathUtils';

/**
 * 本地移动输入共享核心（Phase 6.5；Phase 8 起跟随当前回合玩家）。
 *
 * playerId 由 Provider 提供：本地热座模式输入 = 当前回合玩家
 * （Local 2P：P1/P2 共用同一键盘/触屏，Phase 9 全流程验证）；
 * Single Player（Phase 10）在 AI 回合由场景 setEnabled(false)
 * 禁用人类输入，AIInputSource 驱动 P2 —— 架构不变。
 *
 * 键盘（KeyboardMoveInput）与触屏方向按钮（TouchControls）只负责把
 * 各自的物理输入归一成 direction（−1/0/+1），加速曲线、每帧 MoveCommand
 * 打包全部在这里 —— 桌面与移动端共用同一套移动手感与命令链路：
 *
 *   direction → velocity ramp → MoveCommand(targetX)
 *     → CommandBus → MovementSystem（阶段 / 边界 / 预算 / hasFired 校验）
 *
 * 输入层不含规则：校验全部在 MovementSystem（纯逻辑）。
 */
export class MoveInputCore {
  private readonly getPlayerId: () => PlayerId;
  private readonly getState: () => GameState;
  private readonly commandBus: CommandBus;

  private enabled = true;
  private direction: -1 | 0 | 1 = 0;
  private velocity = 0; // px/s，带符号

  constructor(
    getPlayerId: () => PlayerId,
    getState: () => GameState,
    commandBus: CommandBus
  ) {
    this.getPlayerId = getPlayerId;
    this.getState = getState;
    this.commandBus = commandBus;
  }

  /** 本输入当前控制的玩家（热座模式 = 当前回合玩家） */
  get playerId(): PlayerId {
    return this.getPlayerId();
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.velocity = 0;
    }
  }

  /** 由输入适配器每帧写入归一方向（键盘或触屏按钮） */
  setDirection(direction: -1 | 0 | 1): void {
    this.direction = direction;
  }

  /**
   * 每帧：按住加速到 maxSpeed（GameConfig），松开立即停止
   * （不保留惯性，避免白白消耗移动预算）；
   * 有速度时把期望位置包装成 MoveCommand 交给 CommandBus。
   */
  update(deltaMs: number): void {
    const state = this.getState();
    const playerId = this.getPlayerId();
    if (
      !this.enabled ||
      state.gameOver ||
      state.currentPlayerId !== playerId
    ) {
      this.velocity = 0;
      return;
    }

    const dt = deltaMs / 1000;
    const { maxSpeed, acceleration } = GAME_CONFIG.player.movement;

    if (this.direction !== 0) {
      this.velocity = moveToward(
        this.velocity,
        this.direction * maxSpeed,
        acceleration * dt
      );
    } else {
      // 松开立即停止（无惯性）
      this.velocity = 0;
    }

    if (this.velocity === 0) {
      return;
    }

    const player = state.players[playerId];
    const command: MoveCommand = {
      type: 'MOVE',
      playerId,
      turnId: state.turnId,
      targetX: player.x + this.velocity * dt,
    };
    this.commandBus.dispatch(command);
  }
}
