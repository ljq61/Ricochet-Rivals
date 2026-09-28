import { describe, expect, it, beforeEach } from 'vitest';
import { createInitialGameState, TurnPhase, type GameState } from '../../src/game/state/GameState';
import { MovementSystem } from '../../src/game/systems/MovementSystem';
import type { MoveCommand } from '../../src/game/commands/GameCommand';
import { GAME_CONFIG } from '../../src/game/config/GameConfig';

function move(playerId: 'P1' | 'P2', targetX: number, turnId = 1): MoveCommand {
  return { type: 'MOVE', playerId, turnId, targetX };
}

describe('MovementSystem', () => {
  let state: GameState;
  const system = new MovementSystem();

  beforeEach(() => {
    state = createInitialGameState({ matchId: 'm-1', seed: 1 });
    // Phase 8：初始状态为 START，行动阶段由 TurnManager.startMatch 进入
    state.phase = TurnPhase.ACTION;
  });

  describe('P1 Bounds（左侧阵地 100–850）', () => {
    it('普通移动被接受，按距离消耗预算', () => {
      const result = system.execute(state, move('P1', 500));

      expect(result.accepted).toBe(true);
      expect(result.previousX).toBe(450);
      expect(result.nextX).toBe(500);
      expect(result.distanceConsumed).toBe(50);
      expect(result.remainingMovement).toBe(200);
      expect(state.players.P1.x).toBe(500);
      expect(state.players.P1.moveRemaining).toBe(200);
    });

    it('超出左边界时 clamp 到 minX=100', () => {
      // 预算调大以单独验证边界
      state.players.P1.moveRemaining = 10000;
      const result = system.execute(state, move('P1', -500));

      expect(result.accepted).toBe(true);
      expect(result.nextX).toBe(100);
      expect(result.distanceConsumed).toBe(350);
    });

    it('超出右边界时 clamp 到 maxX=850', () => {
      state.players.P1.moveRemaining = 10000;
      const result = system.execute(state, move('P1', 900));

      expect(result.accepted).toBe(true);
      expect(result.nextX).toBe(850);
      expect(result.distanceConsumed).toBe(400);
    });

    it('已在边界上继续向外移动会被拒绝', () => {
      state.players.P1.x = 850;
      const result = system.execute(state, move('P1', 900));

      expect(result.accepted).toBe(false);
      expect(result.reason).toBe('NO_MOVEMENT');
      expect(result.nextX).toBe(850);
    });
  });

  describe('P2 Bounds（右侧阵地 4150–4900）', () => {
    beforeEach(() => {
      state.currentPlayerId = 'P2';
    });

    it('普通移动被接受', () => {
      const result = system.execute(state, move('P2', 4600));

      expect(result.accepted).toBe(true);
      expect(result.nextX).toBe(4600);
      expect(result.distanceConsumed).toBe(50);
    });

    it('超出左边界时 clamp 到 minX=4150', () => {
      state.players.P2.moveRemaining = 10000;
      const result = system.execute(state, move('P2', 4100));

      expect(result.accepted).toBe(true);
      expect(result.nextX).toBe(4150);
    });

    it('超出右边界时 clamp 到 maxX=4900', () => {
      state.players.P2.moveRemaining = 10000;
      const result = system.execute(state, move('P2', 5200));

      expect(result.accepted).toBe(true);
      expect(result.nextX).toBe(4900);
    });
  });

  describe('Movement Budget（每回合 250px）', () => {
    it('预算耗尽后拒绝移动', () => {
      const first = system.execute(state, move('P1', 700)); // 消耗 250
      expect(first.accepted).toBe(true);
      expect(first.remainingMovement).toBe(0);

      const second = system.execute(state, move('P1', 710));
      expect(second.accepted).toBe(false);
      expect(second.reason).toBe('NO_MOVE_BUDGET');
      expect(state.players.P1.x).toBe(700);
    });

    it('长距离移动被预算截断', () => {
      const result = system.execute(state, move('P1', 900));

      // 目标被 clamp 到 850，但预算只剩 250：450 + 250 = 700
      expect(result.accepted).toBe(true);
      expect(result.nextX).toBe(700);
      expect(result.distanceConsumed).toBe(250);
      expect(result.remainingMovement).toBe(0);
    });

    it('剩余预算不足时移动到预算允许的位置', () => {
      system.execute(state, move('P1', 500)); // 消耗 50，剩 200
      const result = system.execute(state, move('P1', 800)); // 需要 300 > 200

      expect(result.accepted).toBe(true);
      expect(result.nextX).toBe(700);
      expect(result.distanceConsumed).toBe(200);
      expect(result.remainingMovement).toBe(0);
    });
  });

  describe('反向移动仍按实际距离消耗', () => {
    it('向右 100 再向左 40 = 消耗 140，而不是净位移 60', () => {
      system.execute(state, move('P1', 550)); // +100
      const result = system.execute(state, move('P1', 510)); // -40

      expect(result.accepted).toBe(true);
      expect(result.nextX).toBe(510);
      expect(result.distanceConsumed).toBe(40);
      expect(result.remainingMovement).toBe(110); // 250 - 100 - 40
      expect(state.players.P1.moveRemaining).toBe(110);
    });

    it('来回走动可以耗尽全部预算', () => {
      system.execute(state, move('P1', 550)); // +100
      system.execute(state, move('P1', 470)); // -80 → 180
      const result = system.execute(state, move('P1', 620)); // +150 需要 150 > 剩 70

      expect(result.accepted).toBe(true);
      expect(result.nextX).toBe(540); // 470 + 70
      expect(result.remainingMovement).toBe(0);

      const after = system.execute(state, move('P1', 500));
      expect(after.accepted).toBe(false);
      expect(after.reason).toBe('NO_MOVE_BUDGET');
    });
  });

  describe('Movement Disabled After Fire', () => {
    it('hasFired 后拒绝移动', () => {
      state.players.P1.hasFired = true;
      const result = system.execute(state, move('P1', 500));

      expect(result.accepted).toBe(false);
      expect(result.reason).toBe('ALREADY_FIRED');
      expect(state.players.P1.x).toBe(450);
      expect(state.players.P1.moveRemaining).toBe(250);
    });
  });

  describe('Command 校验', () => {
    it('turnId 不匹配时拒绝', () => {
      const result = system.execute(state, move('P1', 500, 99));

      expect(result.accepted).toBe(false);
      expect(result.reason).toBe('TURN_MISMATCH');
    });

    it('非当前回合玩家移动被拒绝', () => {
      const result = system.execute(state, move('P2', 4600));

      expect(result.accepted).toBe(false);
      expect(result.reason).toBe('NOT_CURRENT_PLAYER');
      expect(state.players.P2.x).toBe(GAME_CONFIG.player.spawn.P2);
    });

    it('gameOver 后拒绝移动', () => {
      state.gameOver = true;
      const result = system.execute(state, move('P1', 500));

      expect(result.accepted).toBe(false);
      expect(result.reason).toBe('GAME_OVER');
    });

    it('死亡玩家拒绝移动', () => {
      state.players.P1.isAlive = false;
      const result = system.execute(state, move('P1', 500));

      expect(result.accepted).toBe(false);
      expect(result.reason).toBe('PLAYER_DEAD');
    });

    it('原地不动（targetX = 当前位置）被拒绝且不消耗', () => {
      const result = system.execute(state, move('P1', 450));

      expect(result.accepted).toBe(false);
      expect(result.reason).toBe('NO_MOVEMENT');
      expect(result.distanceConsumed).toBe(0);
      expect(state.players.P1.moveRemaining).toBe(250);
    });
  });

  describe('TurnPhase 门禁（Phase 8）', () => {
    it('RETURN_HOME / AIM 阶段拒绝移动（Phase 9 Review Gate：点击瞄准即位置锁定）', () => {
      state.phase = TurnPhase.RETURN_HOME;
      const returnHome = system.execute(state, move('P1', 500));
      expect(returnHome.accepted).toBe(false);
      expect(returnHome.reason).toBe('WRONG_PHASE');

      state.phase = TurnPhase.AIM;
      const aim = system.execute(state, move('P1', 550));
      expect(aim.accepted).toBe(false);
      expect(aim.reason).toBe('WRONG_PHASE');
      expect(state.players.P1.x).toBe(450);
      expect(state.players.P1.moveRemaining).toBe(250);
    });

    it('PROJECTILE 阶段拒绝移动（发射后本回合锁定）', () => {
      state.phase = TurnPhase.PROJECTILE;
      const result = system.execute(state, move('P1', 500));

      expect(result.accepted).toBe(false);
      expect(result.reason).toBe('WRONG_PHASE');
      expect(state.players.P1.x).toBe(450);
    });

    it('RESOLVE / END / GAME_OVER / START 阶段拒绝移动', () => {
      for (const phase of [
        TurnPhase.RESOLVE,
        TurnPhase.END,
        TurnPhase.GAME_OVER,
        TurnPhase.START,
      ]) {
        state.phase = phase;
        const result = system.execute(state, move('P1', 500));
        expect(result.accepted, phase).toBe(false);
        expect(result.reason, phase).toBe('WRONG_PHASE');
      }
    });

    it('END（TURN_TRANSITION 相机移动中）拒绝移动，到位后 ACTION 恢复', () => {
      state.phase = TurnPhase.END;
      expect(system.execute(state, move('P1', 500)).accepted).toBe(false);

      state.phase = TurnPhase.ACTION;
      expect(system.execute(state, move('P1', 500)).accepted).toBe(true);
    });
  });
});
