import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { createInitialGameState, type GameState } from '../../src/game/state/GameState';
import { TurnManager } from '../../src/game/systems/TurnManager';
import { TurnPhase } from '../../src/game/state/TurnPhase';
import { GAME_CONFIG } from '../../src/game/config/GameConfig';

/**
 * TurnManager（Phase 8，CODELY.md §10）：
 * ACTION → RETURN_HOME → AIM → PROJECTILE → RESOLVE → END → ACTION 循环；
 * 致死 → GAME_OVER（回合冻结，不切换）。
 * 验收项（TASKS Phase 8）：Turn increments / Player switches /
 * Move resets / Fire once only / Dead player triggers game over。
 */

describe('TurnManager', () => {
  let state: GameState;
  let manager: TurnManager;

  beforeEach(() => {
    state = createInitialGameState({ matchId: 't', seed: 1 });
    manager = new TurnManager(state);
  });

  describe('startMatch / beginTurn', () => {
    it('startMatch：进入首位玩家 ACTION，兼容占位与 hasFired 重置', () => {
      state.players.P1.moveRemaining = 0;
      state.players.P1.hasFired = true;

      manager.startMatch();

      expect(state.phase).toBe(TurnPhase.ACTION);
      expect(state.currentPlayerId).toBe('P1');
      expect(state.players.P1.moveRemaining).toBe(
        GAME_CONFIG.player.maxMovePerTurn
      );
      expect(state.players.P1.hasFired).toBe(false);
    });
  });

  describe('requestAim / cancelAim', () => {
    it('ACTION → RETURN_HOME → AIM，cancel 回 ACTION', () => {
      manager.startMatch();

      expect(manager.requestAim()).toBe(true);
      expect(state.phase).toBe(TurnPhase.RETURN_HOME);

      manager.notifyAimingStarted();
      expect(state.phase).toBe(TurnPhase.AIM);

      manager.cancelAim();
      expect(state.phase).toBe(TurnPhase.ACTION);
    });

    it('RETURN_HOME 中途取消直接回 ACTION', () => {
      manager.startMatch();
      manager.requestAim();

      manager.cancelAim();
      expect(state.phase).toBe(TurnPhase.ACTION);
    });

    it('已发射后拒绝发起瞄准', () => {
      manager.startMatch();
      state.players.P1.hasFired = true;

      expect(manager.requestAim()).toBe(false);
      expect(state.phase).toBe(TurnPhase.ACTION);
    });

    it('已阵亡玩家拒绝发起瞄准', () => {
      manager.startMatch();
      state.players.P1.isAlive = false;

      expect(manager.requestAim()).toBe(false);
    });

    it('非 ACTION 阶段拒绝发起瞄准（如 PROJECTILE）', () => {
      manager.startMatch();
      manager.requestAim();
      manager.notifyAimingStarted();
      manager.notifyProjectileLaunched();

      expect(manager.requestAim()).toBe(false);
      expect(state.phase).toBe(TurnPhase.PROJECTILE);
    });
  });

  describe('攻击流程相位', () => {
    it('launch → PROJECTILE；resolve → RESOLVE；endTurn → END；transition → ACTION', () => {
      manager.startMatch();
      manager.requestAim();
      manager.notifyAimingStarted();

      manager.notifyProjectileLaunched();
      expect(state.phase).toBe(TurnPhase.PROJECTILE);

      manager.notifyProjectileResolved(null);
      expect(state.phase).toBe(TurnPhase.RESOLVE);

      manager.endTurn();
      expect(state.phase).toBe(TurnPhase.END);

      manager.notifyTurnTransitionComplete();
      expect(state.phase).toBe(TurnPhase.ACTION);
    });

    it('RESOLVE 后再次 resolve 被忽略（幂等）', () => {
      manager.startMatch();
      manager.notifyProjectileLaunched();
      manager.notifyProjectileResolved(null);
      expect(state.phase).toBe(TurnPhase.RESOLVE);

      manager.notifyProjectileResolved(null);
      expect(state.phase).toBe(TurnPhase.RESOLVE);
    });
  });

  describe('endTurn：切换与重置（TASKS 验收项）', () => {
    it('Turn increments + Current Player switches', () => {
      manager.startMatch();
      manager.notifyProjectileLaunched();
      manager.notifyProjectileResolved(null);

      manager.endTurn();

      expect(state.turnId).toBe(2);
      expect(state.currentPlayerId).toBe('P2');
    });

    it('新玩家兼容占位 / hasFired 重置', () => {
      manager.startMatch();
      state.players.P2.moveRemaining = 37;
      state.players.P2.hasFired = true;
      manager.notifyProjectileLaunched();
      manager.notifyProjectileResolved(null);

      manager.endTurn();

      expect(state.players.P2.moveRemaining).toBe(
        GAME_CONFIG.player.maxMovePerTurn
      );
      expect(state.players.P2.hasFired).toBe(false);
    });

    it('完整循环 P1→P2→P1：turnId 3，P1 兼容占位重置', () => {
      manager.startMatch();
      state.players.P1.moveRemaining = 5;
      // 回合 1：P1 攻击
      manager.notifyProjectileLaunched();
      manager.notifyProjectileResolved(null);
      manager.endTurn();
      manager.notifyTurnTransitionComplete();
      expect(state.turnId).toBe(2);
      expect(state.currentPlayerId).toBe('P2');
      expect(state.players.P1.moveRemaining).toBe(5); // P1 尚未轮到，不重置

      // 回合 2：P2 攻击
      manager.notifyProjectileLaunched();
      manager.notifyProjectileResolved(null);
      manager.endTurn();
      manager.notifyTurnTransitionComplete();

      expect(state.turnId).toBe(3);
      expect(state.currentPlayerId).toBe('P1');
      expect(state.players.P1.moveRemaining).toBe(
        GAME_CONFIG.player.maxMovePerTurn
      );
      expect(state.players.P1.hasFired).toBe(false);
    });

    it('gameOver 时 endTurn 不切换（Dead player triggers game over）', () => {
      manager.startMatch();
      manager.notifyProjectileLaunched();
      state.gameOver = true; // DamageSystem.apply 已判定
      state.winnerId = 'P1';
      manager.notifyProjectileResolved(null);

      expect(state.phase).toBe(TurnPhase.GAME_OVER);

      manager.endTurn();
      expect(state.phase).toBe(TurnPhase.GAME_OVER);
      expect(state.turnId).toBe(1);
      expect(state.currentPlayerId).toBe('P1');
    });
  });

  describe('fire once only（发射后的相位门禁）', () => {
    it('hasFired 由 FireSystem 标记后，本回合内 requestAim 被拒', () => {
      manager.startMatch();
      state.players.P1.hasFired = true; // FireSystem 已标记

      expect(manager.requestAim()).toBe(false);
    });
  });

  describe('applyRemoteTurnEnd（Online Guest 专用，Phase 14）', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('RESOLVE 应用 Host TURN_END：END / turnId=Host 值 / 玩家切换 / 兼容占位与 hasFired 复位，且不告警', () => {
      manager.startMatch();
      manager.notifyProjectileLaunched();
      manager.notifyProjectileResolved(null);
      state.players.P2.moveRemaining = 0;
      state.players.P2.hasFired = true;
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      manager.applyRemoteTurnEnd('P2', 2);

      expect(state.phase).toBe(TurnPhase.END);
      expect(state.turnId).toBe(2);
      expect(state.currentPlayerId).toBe('P2');
      expect(state.players.P2.moveRemaining).toBe(
        GAME_CONFIG.player.maxMovePerTurn
      );
      expect(state.players.P2.hasFired).toBe(false);
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('gameOver 时忽略（幂等）', () => {
      manager.startMatch();
      manager.notifyProjectileLaunched();
      manager.notifyProjectileResolved(null);
      state.gameOver = true; // DamageSystem.apply 已判定
      state.players.P2.moveRemaining = 42;
      state.players.P2.hasFired = true;

      manager.applyRemoteTurnEnd('P2', 2);

      expect(state.phase).toBe(TurnPhase.RESOLVE);
      expect(state.turnId).toBe(1);
      expect(state.currentPlayerId).toBe('P1');
      expect(state.players.P2.moveRemaining).toBe(42);
      expect(state.players.P2.hasFired).toBe(true);
    });

    it('非 RESOLVE 相位（ACTION）忽略（幂等）', () => {
      manager.startMatch();

      manager.applyRemoteTurnEnd('P2', 2);

      expect(state.phase).toBe(TurnPhase.ACTION);
      expect(state.turnId).toBe(1);
      expect(state.currentPlayerId).toBe('P1');
      expect(state.players.P2.moveRemaining).toBe(
        GAME_CONFIG.player.maxMovePerTurn
      );
    });

    it('nextTurnId 异常（+5 而非 +1）：仍应用 Host 值并仅 console.warn', () => {
      manager.startMatch();
      manager.notifyProjectileLaunched();
      manager.notifyProjectileResolved(null);
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      manager.applyRemoteTurnEnd('P2', 5);

      expect(state.turnId).toBe(5);
      expect(state.phase).toBe(TurnPhase.END);
      expect(state.currentPlayerId).toBe('P2');
      expect(state.players.P2.hasFired).toBe(false);
      expect(warnSpy).toHaveBeenCalledTimes(1);
    });
  });
});
