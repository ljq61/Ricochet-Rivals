import { describe, expect, it } from 'vitest';
import { ItemInputController } from '../../src/game/input/ItemInputController';
import { InMemoryCommandBus } from '../../src/game/commands/CommandBus';
import type { GameCommand, FireCommand } from '../../src/game/commands/GameCommand';
import { createInitialGameState, TurnPhase } from '../../src/game/state/GameState';

function setup() {
  const state = createInitialGameState({ matchId: 'items-input', seed: 1 });
  state.phase = TurnPhase.ACTION;
  state.players.P1.inventory = [
    { id: 'boost', type: 'damage_boost' }, { id: 'heal', type: 'heal' }, null,
  ];
  const commands: GameCommand[] = [];
  const bus = new InMemoryCommandBus();
  bus.subscribe(command => commands.push(command));
  let allowed = true;
  const input = new ItemInputController({ bus, getState: () => state,
    canUse: () => allowed, canControl: () => allowed });
  const fire: FireCommand = { type: 'FIRE', playerId: 'P1', turnId: 1,
    weaponId: 'normal', startX: 450, startY: 896,
    velocityX: 1800, velocityY: -1400, seed: 1 };
  return { state, commands, input, fire, lock: () => { allowed = false; } };
}

describe('local item reservations', () => {
  it('airstrike is an instant command with a distinct operation id, clears shot reservation and cannot send input during flight', () => {
    const { state, input, commands, fire } = setup();
    state.players.P1.inventory[2] = { id: 'plane', type: 'airstrike' };
    input.select('boost'); input.select('plane');
    expect(input.selectedItemId).toBeNull();
    expect(commands[0]).toMatchObject({ type: 'USE_ITEM', itemId: 'plane' });
    expect(commands[0]).toHaveProperty('operationId', 'items-input:1:airstrike:1');
    state.phase = TurnPhase.AIRSTRIKE;
    input.select('boost'); input.select('plane'); input.dispatch(fire);
    input.dispatch({ type: 'MOVE', playerId: 'P1', turnId: 1, targetX: 650 });
    expect(commands).toHaveLength(1);
  });
  it('reserves without consuming and decorates only a fire command', () => {
    const { state, input, fire, commands } = setup();
    input.select('boost');
    expect(commands).toEqual([]);
    expect(state.players.P1.inventory[0]?.id).toBe('boost');
    input.dispatch(fire);
    expect(commands[0]).toMatchObject({ type: 'FIRE', itemId: 'boost' });
    // The bus did not accept this fire, so the reservation is retained.
    expect(input.selectedItemId).toBe('boost');
  });

  it('second tap cancels and changing turns clears the old selection', () => {
    const { state, input } = setup();
    input.select('boost'); input.select('boost');
    expect(input.selectedItemId).toBeNull();
    input.select('boost'); state.turnId++;
    expect(input.selectedItemId).toBeNull();
  });

  it('accepted consumption clears reservation without moving slots', () => {
    const { state, input } = setup();
    input.select('boost'); state.players.P1.inventory[0] = null;
    state.players.P1.itemUsedThisTurn = true;
    expect(input.selectedItemId).toBeNull();
    expect(state.players.P1.inventory[1]?.id).toBe('heal');
  });

  it('full HP does not send a heal; valid heals carry distinct operation ids', () => {
    const { state, input, commands } = setup();
    input.select('heal'); expect(commands).toEqual([]);
    state.players.P1.hp = 8;
    input.select('heal'); input.select('heal');
    expect(commands).toHaveLength(2);
    expect(commands[0]).toMatchObject({ type: 'USE_ITEM', itemId: 'heal' });
    expect(commands[0]).not.toEqual(commands[1]);
  });

  it('pending heal/recovery gate blocks all human commands', () => {
    const { input, fire, commands, lock } = setup();
    input.select('boost'); lock();
    input.dispatch(fire); input.select('heal');
    expect(commands).toEqual([]);
  });

  it('RETURN_HOME and flight do not allow selecting an item', () => {
    const { input, state } = setup();
    for (const phase of [TurnPhase.RETURN_HOME, TurnPhase.PROJECTILE, TurnPhase.END]) {
      state.phase = phase; input.select('boost');
      expect(input.selectedItemId).toBeNull();
    }
  });
});
