import { describe, expect, it, beforeEach } from 'vitest';
import { createInitialGameState, TurnPhase, type GameState } from '../../src/game/state/GameState';
import { FireSystem } from '../../src/game/systems/FireSystem';
import type { FireCommand } from '../../src/game/commands/GameCommand';
import { GAME_CONFIG } from '../../src/game/config/GameConfig';

function fire(playerId: 'P1' | 'P2', turnId = 1, overrides: Partial<FireCommand> = {}): FireCommand {
  return {
    type: 'FIRE',
    playerId,
    turnId,
    weaponId: 'normal',
    startX: 450,
    startY: GAME_CONFIG.world.groundTopY - 48,
    velocityX: 1000,
    velocityY: -700,
    seed: 1,
    ...overrides,
  };
}

describe('FireSystem', () => {
  let state: GameState;
  const system = new FireSystem();

  beforeEach(() => {
    state = createInitialGameState({ matchId: 'm-1', seed: 1 });
    // Phase 8：ACTION 阶段由 TurnManager.startMatch 进入
    state.phase = TurnPhase.ACTION;
  });

  it('接受合法发射并标记 hasFired（每回合限一次）', () => {
    const result = system.execute(state, fire('P1'));

    expect(result.accepted).toBe(true);
    expect(result.reason).toBeUndefined();
    expect(state.players.P1.hasFired).toBe(true);
    // 不修改其它状态
    expect(state.players.P1.x).toBe(GAME_CONFIG.player.spawn.P1);
    expect(state.players.P1.hp).toBe(GAME_CONFIG.player.maxHp);
  });

  it('同一回合第二次发射被拒绝', () => {
    system.execute(state, fire('P1'));
    const second = system.execute(state, fire('P1'));

    expect(second.accepted).toBe(false);
    expect(second.reason).toBe('ALREADY_FIRED');
  });

  it('发射后移动被 MovementSystem 拒绝（跨系统一致）', async () => {
    const { MovementSystem } = await import('../../src/game/systems/MovementSystem');
    system.execute(state, fire('P1'));

    const move = new MovementSystem().execute(state, { type: 'MOVE', playerId: 'P1', turnId: 1, targetX: 500 });
    expect(move.accepted).toBe(false);
    expect(move.reason).toBe('ALREADY_FIRED');
  });

  it('turnId 不匹配被拒绝', () => {
    const result = system.execute(state, fire('P1', 99));

    expect(result.accepted).toBe(false);
    expect(result.reason).toBe('TURN_MISMATCH');
  });

  it('非当前回合玩家发射被拒绝', () => {
    const result = system.execute(state, fire('P2'));

    expect(result.accepted).toBe(false);
    expect(result.reason).toBe('NOT_CURRENT_PLAYER');
    expect(state.players.P2.hasFired).toBe(false);
  });

  it('死亡玩家发射被拒绝', () => {
    state.players.P1.isAlive = false;
    const result = system.execute(state, fire('P1'));

    expect(result.accepted).toBe(false);
    expect(result.reason).toBe('PLAYER_DEAD');
  });

  it('gameOver 后发射被拒绝', () => {
    state.gameOver = true;
    const result = system.execute(state, fire('P1'));

    expect(result.accepted).toBe(false);
    expect(result.reason).toBe('GAME_OVER');
  });

  describe('TurnPhase 门禁（Phase 8）', () => {
    it('AIM 阶段允许发射（主路径：瞄准释放）', () => {
      state.phase = TurnPhase.AIM;
      const result = system.execute(state, fire('P1'));

      expect(result.accepted).toBe(true);
      expect(state.players.P1.hasFired).toBe(true);
    });

    it('RETURN_HOME 阶段允许发射（AI / 网络输入的合法窗口）', () => {
      state.phase = TurnPhase.RETURN_HOME;
      expect(system.execute(state, fire('P1')).accepted).toBe(true);
    });

    it('PROJECTILE 阶段拒绝二次发射', () => {
      state.phase = TurnPhase.PROJECTILE;
      const result = system.execute(state, fire('P1'));

      expect(result.accepted).toBe(false);
      expect(result.reason).toBe('WRONG_PHASE');
      expect(state.players.P1.hasFired).toBe(false);
    });

    it('RESOLVE / END / GAME_OVER / START 阶段拒绝发射', () => {
      for (const phase of [
        TurnPhase.RESOLVE,
        TurnPhase.END,
        TurnPhase.GAME_OVER,
        TurnPhase.START,
      ]) {
        state.phase = phase;
        const result = system.execute(state, fire('P1'));
        expect(result.accepted, phase).toBe(false);
        expect(result.reason, phase).toBe('WRONG_PHASE');
      }
    });
  });
});
