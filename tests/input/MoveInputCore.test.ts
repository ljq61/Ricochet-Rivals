import { describe, expect, it } from 'vitest';
import { MoveInputCore } from '../../src/game/input/MoveInputCore';
import { InMemoryCommandBus, type CommandBus } from '../../src/game/commands/CommandBus';
import type { GameCommand, MoveCommand } from '../../src/game/commands/GameCommand';
import { createInitialGameState, type GameState } from '../../src/game/state/GameState';
import { GAME_CONFIG } from '../../src/game/config/GameConfig';

/**
 * MoveInputCore（Phase 6.5）：
 * 键盘与触屏方向按钮共用的移动手感曲线 ——
 * 保证 Desktop / Mobile 只有输入采集差异，移动链路完全一致。
 *
 * 规则校验（边界 / 预算 / hasFired）在 MovementSystem（18 个单测覆盖），
 * 这里只验证输入层职责：direction → ramp → MoveCommand。
 */

function setup(options: {
  firstPlayer?: 'P1' | 'P2';
} = {}): { core: MoveInputCore; bus: CommandBus; state: GameState } {
  const state = createInitialGameState({
    matchId: 'test',
    seed: 1,
    firstPlayer: options.firstPlayer,
  });
  const bus = new InMemoryCommandBus();
  // Phase 8：热座输入跟随当前回合玩家（Provider 模式）
  const core = new MoveInputCore(
    () => state.currentPlayerId,
    () => state,
    bus
  );
  return { core, bus, state };
}

function collectCommands(bus: CommandBus): GameCommand[] {
  const commands: GameCommand[] = [];
  bus.subscribe((command) => commands.push(command));
  return commands;
}

const FRAME_MS = 16;
const { maxSpeed, acceleration } = GAME_CONFIG.player.movement;

describe('MoveInputCore — 加速曲线（键盘 / 触屏共享）', () => {
  it('按住方向逐帧加速到 maxSpeed，每帧发出 MoveCommand', () => {
    const { core, bus, state } = setup();
    const commands = collectCommands(bus);
    core.setDirection(1);

    const dt = FRAME_MS / 1000;
    const baseX = state.players.P1.x;
    let velocity = 0;
    for (let i = 0; i < 300; i++) {
      core.update(FRAME_MS);
      velocity = Math.min(maxSpeed, velocity + acceleration * dt);
      const command = commands[i] as MoveCommand;
      expect(command).toBeDefined();
      expect(command.type).toBe('MOVE');
      expect(command.playerId).toBe('P1');
      expect(command.turnId).toBe(1);
      expect(command.targetX).toBeCloseTo(baseX + velocity * dt, 9);
    }
    // 300 帧（4.8s）后收敛到 maxSpeed
    expect(velocity).toBe(maxSpeed);
  });

  it('松开立即停止（无惯性），不再发命令', () => {
    const { core, bus } = setup();
    const commands = collectCommands(bus);
    core.setDirection(1);
    core.update(FRAME_MS);
    core.update(FRAME_MS);
    const count = commands.length;

    core.setDirection(0);
    core.update(FRAME_MS);
    expect(commands.length).toBe(count); // 速度归零，无命令
  });

  it('反向输入：direction=-1 向左加速', () => {
    const { core, bus, state } = setup();
    const commands = collectCommands(bus);
    core.setDirection(-1);
    core.update(FRAME_MS);

    const first = commands[0] as MoveCommand;
    expect(first.type).toBe('MOVE');
    expect(first.targetX).toBeLessThan(state.players.P1.x);
  });

  it('setEnabled(false)：立即停且不产命令；恢复后继续工作', () => {
    const { core, bus } = setup();
    const commands = collectCommands(bus);
    core.setDirection(1);
    core.update(FRAME_MS);
    const count = commands.length;

    core.setEnabled(false);
    core.update(FRAME_MS);
    expect(commands.length).toBe(count);

    core.setEnabled(true);
    core.update(FRAME_MS);
    expect(commands.length).toBe(count + 1);
  });

  it('输入目标与当前回合玩家不一致（固定 Provider）：速度归零、不产命令', () => {
    // Phase 10 SP 场景：人类输入固定绑定 P1，AI 回合 currentPlayerId = P2
    const state = createInitialGameState({
      matchId: 'test',
      seed: 1,
      firstPlayer: 'P2',
    });
    const bus = new InMemoryCommandBus();
    const core = new MoveInputCore(() => 'P1', () => state, bus);
    const commands = collectCommands(bus);

    core.setDirection(1);
    core.update(FRAME_MS);
    expect(commands.length).toBe(0);
  });

  it('热座跟随：切换到 P2 回合后输入控制 P2', () => {
    const { core, bus, state } = setup();
    const commands = collectCommands(bus);
    state.currentPlayerId = 'P2';
    core.setDirection(1);
    core.update(FRAME_MS);

    const command = commands[0] as MoveCommand;
    expect(command.playerId).toBe('P2');
    // 首帧速度 = acceleration × dt
    const firstVelocity = (acceleration * FRAME_MS) / 1000;
    expect(command.targetX).toBeCloseTo(
      state.players.P2.x + firstVelocity * (FRAME_MS / 1000),
      9
    );
  });

  it('gameOver：不产命令', () => {
    const { core, bus, state } = setup();
    const commands = collectCommands(bus);
    state.gameOver = true;
    core.setDirection(1);
    core.update(FRAME_MS);
    expect(commands.length).toBe(0);
  });
});
