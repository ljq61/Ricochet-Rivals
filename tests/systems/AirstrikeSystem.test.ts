import { describe, expect, it, vi } from 'vitest';
import { GAME_CONFIG } from '../../src/game/config/GameConfig';
import { InMemoryCommandBus } from '../../src/game/commands/CommandBus';
import type { FireCommand } from '../../src/game/commands/GameCommand';
import { createInitialGameState, TurnPhase } from '../../src/game/state/GameState';
import { AirstrikeSystem } from '../../src/game/systems/AirstrikeSystem';
import { FireSystem } from '../../src/game/systems/FireSystem';
import { GameLogic } from '../../src/game/systems/GameLogic';
import { ItemSystem } from '../../src/game/systems/ItemSystem';
import { MovementSystem } from '../../src/game/systems/MovementSystem';
import type { ProjectileSystem } from '../../src/game/systems/ProjectileSystem';
import { TurnManager } from '../../src/game/systems/TurnManager';

const fire = (): FireCommand => ({ type: 'FIRE', playerId: 'P1', turnId: 1,
  weaponId: 'normal', startX: 450, startY: 896, velocityX: 1400, velocityY: -1400, seed: 1 });
const use = { type: 'USE_ITEM', playerId: 'P1', turnId: 1, itemId: 'plane' } as const;
const initial = () => {
  const state = createInitialGameState({ matchId: 'airstrike', seed: 1 });
  state.phase = TurnPhase.ACTION;
  state.players.P1.inventory[1] = { id: 'plane', type: 'airstrike' };
  state.players.P1.inventory[2] = { id: 'heal', type: 'heal' };
  return state;
};

describe('authority airstrike rules', () => {
  it.each([TurnPhase.ACTION, TurnPhase.AIM] as const)('instant use from %s freezes target without spending normal shot or movement', phase => {
    const state = initial(); state.phase = phase;
    const before = structuredClone(state);
    const result = new ItemSystem().execute(state, use);
    expect(result).toMatchObject({ accepted: true, airstrike: { itemId: 'plane', ownerId: 'P1', turnId: 1,
      target: { x: state.players.P2.x, y: state.players.P2.y - GAME_CONFIG.player.collision.height / 2 }, resumePhase: phase } });
    expect(state.phase).toBe(TurnPhase.AIRSTRIKE);
    expect(state.players.P1.inventory).toEqual([null, null, before.players.P1.inventory[2]]);
    expect(state.players.P1.itemUsedThisTurn).toBe(true);
    expect(state.players.P1.hasFired).toBe(false);
    expect(state.players.P1.moveRemaining).toBe(before.players.P1.moveRemaining);
    expect(state.acceptedShot).toBeNull();
    expect(state.turnId).toBe(1);
    expect(state.players.P2.hp).toBe(10);
  });

  it('airstrike reaching low HP births octopus without resolving an action or laser', () => {
    const state = createInitialGameState({ matchId: 'threshold', seed: 1 });
    state.phase = TurnPhase.ACTION;
    state.players.P1.inventory[0] = { id: 'airstrike', type: 'airstrike' };
    state.players.P2.hp = 6;
    new ItemSystem().execute(state, { type: 'USE_ITEM', playerId: 'P1', turnId: 1, itemId: 'airstrike' });
    new AirstrikeSystem().resolve(state);
    expect(state.players.P2.hp).toBe(4);
    expect(state.octopus.spawnTurnId).toBe(1);
    expect(state.octopus.lastResolvedTurnId).toBe(0);
    expect(state.octopus.lastAttackTurnId).toBeNull();
    expect(state.turnId).toBe(1);
  });

  it('locks MOVE / FIRE / USE_ITEM and normal turn transitions until bombing completes', () => {
    const state = initial(); new ItemSystem().execute(state, use);
    const before = structuredClone(state);
    expect(new MovementSystem().execute(state, { type: 'MOVE', playerId: 'P1', turnId: 1, targetX: 650 }).reason).toBe('WRONG_PHASE');
    expect(new FireSystem().execute(state, fire()).reason).toBe('WRONG_PHASE');
    expect(new ItemSystem().execute(state, { ...use, itemId: 'heal' }).reason).toBe('WRONG_PHASE');
    const turns = new TurnManager(state);
    expect(turns.requestAim()).toBe(false);
    turns.endTurn(); turns.notifyTurnTransitionComplete();
    expect(state).toEqual(before);
  });

  it.each([TurnPhase.ACTION, TurnPhase.AIM] as const)('bomb deals normal direct damage once and restores %s, leaving a normal FIRE available', phase => {
    const state = initial(); state.phase = phase;
    state.octopus.spawnTurnId = 1;
    const octopus = structuredClone(state.octopus);
    new ItemSystem().execute(state, use);
    const system = new AirstrikeSystem();
    expect(system.resolve(state, { itemId: 'plane', turnId: 1 })?.damage.players[1]).toMatchObject({ playerId: 'P2', damage: 2, hpAfter: 8 });
    expect(state.phase).toBe(phase);
    expect(state.pendingAirstrike).toBeNull();
    expect(system.resolve(state)).toBeNull();
    expect(state.players.P2.hp).toBe(8);
    expect(state.octopus).toEqual(octopus);
    expect(state.turnId).toBe(1);
    expect(state.currentPlayerId).toBe('P1');
    expect(new ItemSystem().execute(state, { ...use, itemId: 'heal' }).reason).toBe('ITEM_ALREADY_USED');
    expect(new FireSystem().execute(state, fire()).accepted).toBe(true);
    expect(state.players.P1.hasFired).toBe(true);
  });

  it('invalid turn / item / owner callbacks cannot apply stale damage or clear pending', () => {
    const state = initial(); new ItemSystem().execute(state, use);
    const expected = structuredClone(state);
    const system = new AirstrikeSystem();
    expect(system.resolve(state, { itemId: 'old', turnId: 1 })).toBeNull();
    expect(system.resolve(state, { itemId: 'plane', turnId: 0 })).toBeNull();
    expect(state).toEqual(expected);
    state.turnId = 2;
    expect(system.resolve(state)).toBeNull();
    state.turnId = 1; state.currentPlayerId = 'P2';
    expect(system.resolve(state)).toBeNull();
    expect(state.players.P2.hp).toBe(10);
  });

  it('lethal bomb follows ordinary winner rules and ends without advancing turn', () => {
    const state = initial(); state.players.P2.hp = 2;
    new ItemSystem().execute(state, use);
    new AirstrikeSystem().resolve(state);
    expect(state).toMatchObject({ gameOver: true, winnerId: 'P1', phase: TurnPhase.GAME_OVER, turnId: 1, pendingAirstrike: null });
    expect(state.players.P2.isAlive).toBe(false);
    expect(state.players.P1.hasFired).toBe(false);
  });

  it('FIRE never mounts airstrike and invalid use remains atomic', () => {
    const state = initial(); const before = structuredClone(state);
    expect(new FireSystem().execute(state, { ...fire(), itemId: 'plane' }).reason).toBe('NOT_ATTACK_ITEM');
    expect(new ItemSystem().execute(state, { ...use, turnId: 2 }).reason).toBe('TURN_MISMATCH');
    expect(new ItemSystem().execute(state, { ...use, playerId: 'P2' }).reason).toBe('NOT_CURRENT_PLAYER');
    state.phase = TurnPhase.RETURN_HOME;
    expect(new ItemSystem().execute(state, use).reason).toBe('WRONG_PHASE');
    state.phase = TurnPhase.ACTION;
    expect(state).toEqual(before);
  });

  it('uses frozen public target and ordinary AABB direct / splash damage instead of auto-writing enemy HP', () => {
    const state = initial(); new ItemSystem().execute(state, use);
    const target = state.pendingAirstrike!.target;
    state.players.P2.x = target.x + GAME_CONFIG.player.collision.width / 2 + 100;
    const result = new AirstrikeSystem().resolve(state)!;
    expect(result.context.target).toEqual(target);
    expect(result.damage.players[1]).toMatchObject({ damage: 1, hpAfter: 9 });
  });

  it('GameLogic emits started after accepted outcome and emits resolved once, with unsubscribe / destroy cleanup', () => {
    const state = initial(); const bus = new InMemoryCommandBus();
    const logic = new GameLogic(state, bus, { movement: new MovementSystem(), fire: new FireSystem(),
      projectile: { launch: vi.fn() } as unknown as ProjectileSystem });
    const order: string[] = [];
    logic.onOutcome(() => order.push('outcome'));
    logic.onAirstrikeStarted(() => order.push('started'));
    const resolved = vi.fn(); logic.onAirstrikeResolved(resolved);
    const removed = vi.fn(); logic.onAirstrikeStarted(removed)();
    bus.dispatch(use);
    expect(order).toEqual(['outcome', 'started']);
    expect(removed).not.toHaveBeenCalled();
    logic.resolveAirstrike({ itemId: 'plane', turnId: 1 });
    logic.resolveAirstrike();
    expect(resolved).toHaveBeenCalledTimes(1);
    expect(resolved.mock.calls[0]![0].context.itemId).toBe('plane');
    logic.destroy(); state.players.P1.itemUsedThisTurn = false;
    state.players.P1.inventory[1] = { id: 'plane', type: 'airstrike' };
    bus.dispatch(use);
    expect(order).toEqual(['outcome', 'started']);
    expect(state.phase).toBe(TurnPhase.ACTION);
  });
});
