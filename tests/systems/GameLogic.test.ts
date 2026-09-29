import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { createInitialGameState, TurnPhase, type GameState } from '../../src/game/state/GameState';
import { GameLogic, type CommandOutcome, type GameLogicSystems } from '../../src/game/systems/GameLogic';
import { InMemoryCommandBus } from '../../src/game/commands/CommandBus';
import type { FireCommand } from '../../src/game/commands/GameCommand';
import { MovementSystem } from '../../src/game/systems/MovementSystem';
import { FireSystem } from '../../src/game/systems/FireSystem';
import type { ProjectileSystem } from '../../src/game/systems/ProjectileSystem';
import { GAME_CONFIG } from '../../src/game/config/GameConfig';

/**
 * GameLogic（Phase 14 契约扩展）：
 * CommandBus → GameLogic → Movement / Fire / Projectile 权威执行路径，
 * MOVE / FIRE 经系统执行后同步发射 CommandOutcome（accepted / rejected 都发）。
 * Host 本地输入与 Guest 网络请求共用此路径，outcome 即 Phase 14 广播源。
 */

function fire(playerId: 'P1' | 'P2', turnId = 1, overrides: Partial<FireCommand> = {}): FireCommand {
  return {
    type: 'FIRE',
    playerId,
    turnId,
    weaponId: 'normal',
    startX: GAME_CONFIG.player.spawn.P1,
    startY: GAME_CONFIG.world.groundTopY + GAME_CONFIG.player.launcher.offsetY,
    velocityX: 1000,
    velocityY: -700,
    seed: 1,
    ...overrides,
  };
}

describe('GameLogic', () => {
  let state: GameState;
  let bus: InMemoryCommandBus;
  let logic: GameLogic;
  let launch: Mock;

  /** 订阅 outcome 并返回收集数组（闭包引用，dispatch 后断言） */
  const collectOutcomes = (): CommandOutcome[] => {
    const received: CommandOutcome[] = [];
    logic.onOutcome((outcome) => {
      received.push(outcome);
    });
    return received;
  };

  beforeEach(() => {
    state = createInitialGameState({ matchId: 'm', seed: 1 });
    state.phase = TurnPhase.ACTION; // 等价 startMatch 后的合法行动阶段
    bus = new InMemoryCommandBus();
    launch = vi.fn();
    const systems: GameLogicSystems = {
      movement: new MovementSystem(),
      fire: new FireSystem(),
      projectile: { launch } as unknown as ProjectileSystem,
    };
    logic = new GameLogic(state, bus, systems);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('MOVE outcome', () => {
    it('accepted：result.accepted true、nextX 正确、携带原命令', () => {
      const outcomes = collectOutcomes();
      const command = { type: 'MOVE', playerId: 'P1', turnId: 1, targetX: 600 } as const;

      bus.dispatch(command);

      expect(outcomes).toHaveLength(1);
      const outcome = outcomes[0];
      if (!outcome || outcome.kind !== 'MOVE') {
        throw new Error(`expected MOVE outcome, got ${JSON.stringify(outcome)}`);
      }
      expect(outcome.command).toEqual(command);
      expect(outcome.result.accepted).toBe(true);
      expect(outcome.result.previousX).toBe(GAME_CONFIG.player.spawn.P1);
      expect(outcome.result.nextX).toBe(600);
    });

    it('rejected（NOT_CURRENT_PLAYER）：accepted false 带 reason，世界不变', () => {
      const outcomes = collectOutcomes();

      bus.dispatch({ type: 'MOVE', playerId: 'P2', turnId: 1, targetX: 4300 });

      expect(outcomes).toHaveLength(1);
      const outcome = outcomes[0];
      if (!outcome || outcome.kind !== 'MOVE') {
        throw new Error(`expected MOVE outcome, got ${JSON.stringify(outcome)}`);
      }
      expect(outcome.result.accepted).toBe(false);
      expect(outcome.result.reason).toBe('NOT_CURRENT_PLAYER');
      expect(outcome.result.nextX).toBe(outcome.result.previousX);
      expect(state.players.P2.x).toBe(GAME_CONFIG.player.spawn.P2);
    });
  });

  describe('FIRE outcome', () => {
    it('accepted：projectile.launch 调用一次 + outcome', () => {
      const outcomes = collectOutcomes();
      const command = fire('P1');

      bus.dispatch(command);

      expect(launch).toHaveBeenCalledTimes(1);
      expect(launch).toHaveBeenCalledWith(command);
      expect(outcomes).toHaveLength(1);
      const outcome = outcomes[0];
      if (!outcome || outcome.kind !== 'FIRE') {
        throw new Error(`expected FIRE outcome, got ${JSON.stringify(outcome)}`);
      }
      expect(outcome.command).toBe(command);
      expect(outcome.result.accepted).toBe(true);
      expect(outcome.result.reason).toBeUndefined();
      expect(state.players.P1.hasFired).toBe(true);
    });

    it('rejected（ALREADY_FIRED）：launch 零调用 + outcome', () => {
      state.players.P1.hasFired = true; // FireSystem 已标记过的等价状态
      const outcomes = collectOutcomes();

      bus.dispatch(fire('P1'));

      expect(launch).not.toHaveBeenCalled();
      expect(outcomes).toHaveLength(1);
      const outcome = outcomes[0];
      if (!outcome || outcome.kind !== 'FIRE') {
        throw new Error(`expected FIRE outcome, got ${JSON.stringify(outcome)}`);
      }
      expect(outcome.result.accepted).toBe(false);
      expect(outcome.result.reason).toBe('ALREADY_FIRED');
      expect(state.players.P1.hasFired).toBe(true);
    });
  });

  describe('订阅生命周期与健壮性', () => {
    it('READY 保持被忽略：不产出 outcome', () => {
      const outcomes = collectOutcomes();

      bus.dispatch({ type: 'READY', playerId: 'P1' });

      expect(outcomes).toHaveLength(0);
    });

    it('取消订阅后不再收到 outcome', () => {
      const received: CommandOutcome[] = [];
      const unsubscribe = logic.onOutcome((outcome) => {
        received.push(outcome);
      });

      bus.dispatch({ type: 'MOVE', playerId: 'P1', turnId: 1, targetX: 600 });
      expect(received).toHaveLength(1);

      unsubscribe();
      bus.dispatch({ type: 'MOVE', playerId: 'P1', turnId: 1, targetX: 700 });
      expect(received).toHaveLength(1);
      // 系统执行不受订阅移除影响
      expect(state.players.P1.x).toBe(700);
    });

    it('destroy() 后零发射（防 scene.start 实例复用旧闭包复活）', () => {
      const outcomes = collectOutcomes();

      logic.destroy();
      bus.dispatch({ type: 'MOVE', playerId: 'P1', turnId: 1, targetX: 600 });

      expect(outcomes).toHaveLength(0);
      expect(launch).not.toHaveBeenCalled();
      expect(state.players.P1.x).toBe(GAME_CONFIG.player.spawn.P1);
    });

    it('handler 抛错不影响其余 handler 与系统执行', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const received: CommandOutcome[] = [];
      logic.onOutcome(() => {
        throw new Error('boom');
      });
      logic.onOutcome((outcome) => {
        received.push(outcome);
      });

      bus.dispatch({ type: 'MOVE', playerId: 'P1', turnId: 1, targetX: 600 });

      expect(received).toHaveLength(1);
      expect(errorSpy).toHaveBeenCalledTimes(1);
      // 系统执行不受 handler 异常影响
      expect(state.players.P1.x).toBe(600);

      // 后续命令继续正常执行与发射（不阻断命令执行）
      bus.dispatch({ type: 'MOVE', playerId: 'P1', turnId: 1, targetX: 650 });
      expect(received).toHaveLength(2);
      expect(errorSpy).toHaveBeenCalledTimes(2);
      expect(state.players.P1.x).toBe(650);
    });
  });
});
