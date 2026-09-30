import { describe, expect, it, beforeEach } from 'vitest';
import { GAME_CONFIG } from '../../src/game/config/GameConfig';
import { createInitialGameState, type GameState } from '../../src/game/state/GameState';
import { TurnPhase } from '../../src/game/state/TurnPhase';
import { AIController } from '../../src/game/ai/AIController';
import { solveTrajectory } from '../../src/game/ai/TrajectorySolver';
import { SeededRandom } from '../../src/game/random/SeededRandom';

/**
 * AIController（Phase 10，CODELY.md §18）：纯逻辑决策核心。
 * 验收：决策确定性 / 无解尽力弹 / 移动候选合法 / 难度误差幅度 /
 * 短路（gameOver / hasFired / 阶段 / 阵亡）/ 误差后速度空间同构。
 */

const { minLaunchSpeed, maxLaunchSpeed } = GAME_CONFIG.aiming;
const LAUNCH_Y = GAME_CONFIG.world.groundTopY + GAME_CONFIG.player.launcher.offsetY;

function makeState(): GameState {
  const state = createInitialGameState({ matchId: 'ai-test', seed: 42 });
  state.phase = TurnPhase.ACTION;
  return state;
}

describe('AIController', () => {
  let state: GameState;

  beforeEach(() => {
    state = makeState();
  });

  it('决策确定性：同 state + 同 seed rng → 完全相同的输出', () => {
    const controller = new AIController('normal');
    const a = controller.decide(state, new SeededRandom(7));
    const b = controller.decide(state, new SeededRandom(7));
    expect(a).toEqual(b);
  });

  it('P1 回合从出生位：原地可解 → 不移动、直接出弹', () => {
    const decision = new AIController('normal').decide(state, new SeededRandom(1));
    expect(decision.moveTargetX).toBeNull();
    expect(decision.fire).not.toBeNull();
  });

  it('P2 回合：135° 基准角 ± Normal 误差（≤ 8°）', () => {
    state.currentPlayerId = 'P2';
    const controller = new AIController('normal');
    for (let seed = 0; seed < 50; seed++) {
      const d = controller.decide(state, new SeededRandom(seed));
      expect(d.fire).not.toBeNull();
      expect(d.fire!.angleDeg).toBeGreaterThanOrEqual(135 - 8);
      expect(d.fire!.angleDeg).toBeLessThanOrEqual(135 + 8);
    }
  });

  it('Hard 难度误差收紧：角度 ≤ ±3°、力度 ≤ ±5%（以 solver 为基准）', () => {
    state.currentPlayerId = 'P2';
    const controller = new AIController('hard');
    const base = solveTrajectory({
      originX: state.players.P2.x,
      originY: LAUNCH_Y,
      targetX: state.players.P1.x,
    });
    expect(base).not.toBeNull();
    for (let seed = 0; seed < 50; seed++) {
      const d = controller.decide(state, new SeededRandom(seed));
      expect(Math.abs(d.fire!.angleDeg - base!.angleDeg)).toBeLessThanOrEqual(3);
      expect(d.fire!.speed).toBeGreaterThanOrEqual(base!.speed * 0.95 - 1e-6);
      expect(d.fire!.speed).toBeLessThanOrEqual(base!.speed * 1.05 + 1e-6);
    }
  });

  it('误差后速度仍在人类可达空间 [550, 2400]（含 clamp 兜底）', () => {
    state.currentPlayerId = 'P2';
    // 合成超远敌人：基础解必然贴上限速度，×(1+5%) 后依赖 clamp
    state.players.P1.x = -1000;
    for (let seed = 0; seed < 30; seed++) {
      const d = new AIController('hard').decide(state, new SeededRandom(seed));
      expect(d.fire!.speed).toBeGreaterThanOrEqual(minLaunchSpeed);
      expect(d.fire!.speed).toBeLessThanOrEqual(maxLaunchSpeed);
    }
  });

  it('超射程无解：尽力弹不为 null 且朝向敌方', () => {
    state.currentPlayerId = 'P2';
    state.players.P1.x = -6000; // 距离 10550，任何候选都无解
    const d = new AIController('normal').decide(state, new SeededRandom(3));
    expect(d.moveTargetX).toBeNull();
    expect(d.fire).not.toBeNull();
    expect(d.fire!.angleDeg).toBeGreaterThan(90); // 朝左敌方
    expect(d.fire!.angleDeg).toBeLessThan(180);
  });

  it('过近无解：先移动（远离）再发射，目标在己方 bounds 内', () => {
    // P1 在 850（阵地右缘），敌方合成在 1050（距离 200 < 最小落点偏移）
    state.currentPlayerId = 'P1';
    state.players.P1.x = 850;
    state.players.P2.x = 1050;
    const d = new AIController('normal').decide(state, new SeededRandom(5));
    expect(d.moveTargetX).not.toBeNull();
    const bounds = GAME_CONFIG.player.leftBounds;
    expect(d.moveTargetX!).toBeGreaterThanOrEqual(bounds.minX);
    expect(d.moveTargetX!).toBeLessThanOrEqual(bounds.maxX);
    expect(Math.abs(d.moveTargetX! - 850)).toBeGreaterThan(250);
    expect(d.moveTargetX!).toBeLessThan(850); // 远离敌方
    expect(d.fire).not.toBeNull();
    // 移动后位置确实可解（决策自洽）
    expect(
      solveTrajectory({
        originX: d.moveTargetX!,
        originY: LAUNCH_Y,
        targetX: 1050,
      })
    ).not.toBeNull();
  });

  it('旧兼容预算为 0：仍能在基地内移动再发射', () => {
    state.currentPlayerId = 'P1';
    state.players.P1.x = 850;
    state.players.P1.moveRemaining = 0;
    state.players.P2.x = 1050;
    const d = new AIController('normal').decide(state, new SeededRandom(6));
    expect(d.moveTargetX).not.toBeNull();
    expect(d.moveTargetX!).toBeGreaterThanOrEqual(GAME_CONFIG.player.leftBounds.minX);
    expect(d.moveTargetX!).toBeLessThanOrEqual(GAME_CONFIG.player.leftBounds.maxX);
    expect(d.fire).not.toBeNull();
  });

  it('短路：gameOver / 阶段非 ACTION / 已发射 / 已阵亡 → 空决策', () => {
    const controller = new AIController('normal');
    const empty = { moveTargetX: null, fire: null };

    state.gameOver = true;
    expect(controller.decide(state, new SeededRandom(1))).toEqual(empty);
    state.gameOver = false;

    state.phase = TurnPhase.PROJECTILE;
    expect(controller.decide(state, new SeededRandom(1))).toEqual(empty);
    state.phase = TurnPhase.ACTION;

    state.players.P1.hasFired = true;
    expect(controller.decide(state, new SeededRandom(1))).toEqual(empty);
    state.players.P1.hasFired = false;

    state.players.P1.isAlive = false;
    expect(controller.decide(state, new SeededRandom(1))).toEqual(empty);
    state.players.P1.isAlive = true;
  });
});
