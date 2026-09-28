import { describe, expect, it, beforeEach } from 'vitest';
import { GAME_CONFIG } from '../../src/game/config/GameConfig';
import { createInitialGameState, TurnPhase, type GameState } from '../../src/game/state/GameState';
import { InMemoryCommandBus } from '../../src/game/commands/CommandBus';
import type { GameCommand } from '../../src/game/commands/GameCommand';
import { MovementSystem } from '../../src/game/systems/MovementSystem';
import { FireSystem } from '../../src/game/systems/FireSystem';
import { AIInputSource } from '../../src/game/ai/AIInputSource';
import { SeededRandom } from '../../src/game/random/SeededRandom';
import { getLaunchOrigin } from '../../src/game/physics/aimMath';

/**
 * AIInputSource（Phase 10）：SP AI 输入适配器（InputSource 契约）。
 * 验收：思考→move→fire 时序（假时钟）/ phase 门禁 / 每回合至多一射 /
 * 命令链路经真实 MovementSystem / FireSystem 生效。
 *
 * 测试用真实系统订阅 Bus（复刻 GameLogic 路由，无 Phaser 依赖），
 * 证明 AI 命令与人类命令走同一校验链路。
 */

interface Harness {
  state: GameState;
  commands: GameCommand[];
  source: AIInputSource;
}

function createHarness(seed = 7): Harness {
  const state = createInitialGameState({ matchId: 'ai-input-test', seed: 99 });
  const bus = new InMemoryCommandBus();
  const commands: GameCommand[] = [];
  const movement = new MovementSystem();
  const fire = new FireSystem();
  bus.subscribe((command) => {
    commands.push(command);
    if (command.type === 'MOVE') {
      movement.execute(state, command);
    } else if (command.type === 'FIRE') {
      fire.execute(state, command);
    }
  });
  const source = new AIInputSource({
    playerId: 'P2',
    getState: () => state,
    commandBus: bus,
    rng: new SeededRandom(seed),
    difficulty: 'normal',
  });
  return { state, commands, source };
}

/** 假时钟：以 stepMs 步进累计 totalMs */
function advance(h: Harness, totalMs: number, stepMs = 16): void {
  for (let t = 0; t < totalMs; t += stepMs) {
    h.source.update(stepMs);
  }
}

function startP2Turn(h: Harness): void {
  h.state.currentPlayerId = 'P2';
  h.state.phase = TurnPhase.ACTION;
  h.source.setEnabled(true);
}

describe('AIInputSource', () => {
  let h: Harness;

  beforeEach(() => {
    h = createHarness();
  });

  it('P2 回合：思考延迟内零命令；延迟后仅发一次 FIRE（无需移动）', () => {
    startP2Turn(h);

    advance(h, 400);
    expect(h.commands.length).toBe(0);

    advance(h, 1000); // > thinkDelay max 900
    expect(h.commands.length).toBe(1);
    // 发射瞬间读取当前位置（出生位未动）
    const origin = getLaunchOrigin(h.state.players.P2);
    const first = h.commands[0];
    if (!first || first.type !== 'FIRE') throw new Error('expected FIRE');
    expect(first).toMatchObject({
      playerId: 'P2',
      turnId: 1,
      startX: origin.x,
      startY: origin.y,
      seed: h.state.seed,
    });
    // 速度空间与人类同构
    const cmd = first;
    const speed = Math.hypot(cmd.velocityX, cmd.velocityY);
    expect(speed).toBeGreaterThanOrEqual(GAME_CONFIG.aiming.minLaunchSpeed);
    expect(speed).toBeLessThanOrEqual(GAME_CONFIG.aiming.maxLaunchSpeed);
    expect(cmd.velocityX).toBeLessThan(0); // P2 朝左敌方

    // 真实 FireSystem 已生效（hasFired）
    expect(h.state.players.P2.hasFired).toBe(true);
  });

  it('每回合至多一射：FIRE 后继续 update 不再产生命令', () => {
    startP2Turn(h);
    advance(h, 1500);
    expect(h.commands.length).toBe(1);
    advance(h, 3000);
    expect(h.commands.length).toBe(1);
  });

  it('需要移动的决策：先 MOVE 后 FIRE，FIRE 原点为移动后坐标', () => {
    startP2Turn(h);
    // 合成近敌：距离 250 < 最小落点偏移 − 容差 → 必须移动后求解
    h.state.players.P1.x = 4800;

    // > thinkDelay max 900：MOVE 必已发出（思考是第一条命令）；
    // 不假设 postMove 停顿是否已过 —— seed 固定，think+停顿可能同窗完成
    advance(h, 1000);
    const move = h.commands.find((c) => c.type === 'MOVE');
    if (!move || move.type !== 'MOVE') throw new Error('expected MOVE');
    expect(h.commands.indexOf(move)).toBe(0); // MOVE 是第一条命令
    expect(h.commands.filter((c) => c.type === 'MOVE').length).toBe(1);
    const bounds = GAME_CONFIG.player.rightBounds;
    expect(move.targetX).toBeGreaterThanOrEqual(bounds.minX);
    expect(move.targetX).toBeLessThanOrEqual(bounds.maxX);
    expect(Math.abs(move.targetX - 4550)).toBeLessThanOrEqual(
      GAME_CONFIG.player.maxMovePerTurn
    );
    // 真实 MovementSystem 已执行
    expect(h.state.players.P2.x).toBe(move.targetX);

    // 停顿完成后 → FIRE（> postMoveDelay max 500，必须已发出且仅一条）
    advance(h, 600);
    const fire = h.commands.find((c) => c.type === 'FIRE');
    if (!fire || fire.type !== 'FIRE') throw new Error('expected FIRE');
    expect(h.commands.indexOf(fire)).toBe(1); // FIRE 在 MOVE 之后
    expect(h.commands.filter((c) => c.type === 'FIRE').length).toBe(1);
    expect(fire.startX).toBe(move.targetX); // 移动后的发射原点
    expect(h.state.players.P2.hasFired).toBe(true);
  });

  it('门禁：enabled=false / 非本方回合 / 非法相位 / 已发射 / gameOver → 零命令', () => {
    // 未激活
    h.state.currentPlayerId = 'P2';
    h.state.phase = TurnPhase.ACTION;
    advance(h, 2000);
    expect(h.commands.length).toBe(0);

    // 激活但非本方回合
    startP2Turn(h);
    h.state.currentPlayerId = 'P1';
    advance(h, 2000);
    expect(h.commands.length).toBe(0);

    // 本方回合但相位非 ACTION
    h.state.currentPlayerId = 'P2';
    h.state.phase = TurnPhase.PROJECTILE;
    advance(h, 2000);
    expect(h.commands.length).toBe(0);

    // 已发射
    h.state.phase = TurnPhase.ACTION;
    h.state.players.P2.hasFired = true;
    advance(h, 2000);
    expect(h.commands.length).toBe(0);

    // 游戏结束
    h.state.players.P2.hasFired = false;
    h.state.gameOver = true;
    advance(h, 2000);
    expect(h.commands.length).toBe(0);
  });

  it('回合切换后重新行动：第二回合再次思考并发射', () => {
    startP2Turn(h);
    advance(h, 1500);
    expect(h.commands.length).toBe(1);

    // 回合切给人类，再切回 P2（预算 / hasFired 重置 = TurnManager 职责）
    h.state.turnId = 2;
    h.state.currentPlayerId = 'P1';
    advance(h, 1000);
    expect(h.commands.length).toBe(1);

    h.state.turnId = 3;
    h.state.currentPlayerId = 'P2';
    h.state.players.P2.hasFired = false;
    h.state.players.P2.moveRemaining = GAME_CONFIG.player.maxMovePerTurn;
    advance(h, 1500);
    expect(h.commands.length).toBe(2);
    const second = h.commands[1];
    if (!second || second.type !== 'FIRE') throw new Error('expected FIRE');
    expect(second.turnId).toBe(3);
  });

  it('时序确定性：同 seed + 同 delta 序列 → 命令出现时机一致', () => {
    const a = createHarness(21);
    const b = createHarness(21);
    startP2Turn(a);
    startP2Turn(b);
    for (let i = 0; i < 150; i++) {
      a.source.update(16);
      b.source.update(16);
      expect(a.commands.length).toBe(b.commands.length);
    }
    expect(a.commands).toEqual(b.commands);
  });

  it('setEnabled(false) 中断思考，重新启用后重新决策发射', () => {
    startP2Turn(h);
    advance(h, 300); // 思考中
    h.source.setEnabled(false);
    advance(h, 2000);
    expect(h.commands.length).toBe(0);

    h.source.setEnabled(true);
    advance(h, 1500);
    expect(h.commands.length).toBe(1);
    const reactivated = h.commands[0];
    if (!reactivated || reactivated.type !== 'FIRE') {
      throw new Error('expected FIRE');
    }
  });
});
