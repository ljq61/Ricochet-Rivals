import { describe, expect, it } from 'vitest';
import { AIController } from '../../src/game/ai/AIController';
import { AIInputSource } from '../../src/game/ai/AIInputSource';
import { evaluateAIShot, withAIItems } from '../../src/game/ai/AIItemStrategy';
import { InMemoryCommandBus } from '../../src/game/commands/CommandBus';
import { createInitialGameState, TurnPhase } from '../../src/game/state/GameState';
import { SeededRandom } from '../../src/game/random/SeededRandom';
import { solveTrajectory } from '../../src/game/ai/TrajectorySolver';
import { ItemSystem, legalCrateCandidates } from '../../src/game/systems/ItemSystem';
import { FireSystem } from '../../src/game/systems/FireSystem';
import { AirstrikeSystem } from '../../src/game/systems/AirstrikeSystem';
import type { GameCommand } from '../../src/game/commands/GameCommand';

const initial = () => {
  const state = createInitialGameState({ matchId: 'ai-items', seed: 1, firstPlayer: 'P2' });
  state.phase = TurnPhase.ACTION;
  return state;
};
const plan = () => solveTrajectory({ originX: 4550, originY: 896, targetX: 450, targetY: 870 })!;

describe('public-state bounded AI item strategy', () => {
  it.each(['easy', 'normal', 'hard'] as const)('%s selects airstrike as an instant item without attaching it to normal FIRE', difficulty => {
    const state = initial(); state.players.P2.inventory[0] = { id: 'plane', type: 'airstrike' };
    const before = structuredClone(state);
    const decision = withAIItems(state, { moveTargetX: null, fire: plan() }, difficulty);
    expect(decision.airstrikeItemId).toBe('plane');
    expect(decision.fire?.itemId).toBeUndefined();
    expect(state).toEqual(before);
  });
  it('AI pauses without MOVE / FIRE until airstrike resolves, then keeps its ordinary shot', () => {
    const state = initial(); state.players.P2.inventory[0] = { id: 'plane', type: 'airstrike' };
    const bus = new InMemoryCommandBus(); const commands: GameCommand[] = [];
    bus.subscribe(command => {
      commands.push(command);
      if (command.type === 'USE_ITEM') new ItemSystem().execute(state, command);
      if (command.type === 'FIRE') new FireSystem().execute(state, command);
    });
    const ai = new AIInputSource({ playerId: 'P2', getState: () => state, commandBus: bus,
      rng: new SeededRandom(1), difficulty: 'hard' });
    ai.setEnabled(true); ai.update(16); ai.update(1000);
    expect(commands.map(command => command.type)).toEqual(['USE_ITEM']);
    expect(state.phase).toBe(TurnPhase.AIRSTRIKE);
    ai.update(5000); ai.update(5000);
    expect(commands).toHaveLength(1);
    new AirstrikeSystem().resolve(state);
    expect(state.players.P1.hp).toBe(8);
    ai.update(16); ai.update(1000);
    expect(commands.map(command => command.type)).toEqual(['USE_ITEM', 'FIRE']);
    expect(commands[1]).not.toHaveProperty('itemId');
    expect(state.players.P2.hasFired).toBe(true);
    expect(state.turnId).toBe(1);
  });
  it.each(['easy', 'normal', 'hard'] as const)('%s uses a real heal at low HP and keeps a normal shot', (difficulty) => {
    const state = initial(); state.players.P2.hp = 4;
    state.players.P2.inventory[0] = { id: 'health', type: 'heal' };
    const decision = new AIController(difficulty).decide(state, new SeededRandom(7919));
    expect(decision.healItemId).toBe('health');
    expect(decision.fire!.itemId).toBeUndefined();
    expect(state.players.P2.hp).toBe(4);
    expect(state.players.P2.inventory[0]!.id).toBe('health');
  });
  it('hard chooses a reliable boosted finisher ahead of healing', () => {
    const state = initial(); state.players.P2.hp = 4; state.players.P1.hp = 3;
    state.players.P2.inventory = [{ id: 'health', type: 'heal' }, { id: 'power', type: 'damage_boost' }, null];
    const decision = withAIItems(state, { moveTargetX: null, fire: plan() }, 'hard');
    expect(decision.healItemId).toBeUndefined();
    expect(decision.fire!.itemId).toBe('power');
  });
  it('the item quota prevents selecting a second item', () => {
    const state = initial(); state.players.P2.itemUsedThisTurn = true;
    state.players.P2.hp = 4;
    state.players.P2.inventory = [{ id: 'health', type: 'heal' }, { id: 'power', type: 'damage_boost' }, null];
    const decision = withAIItems(state, { moveTargetX: null, fire: plan() }, 'hard');
    expect(decision.healItemId).toBeUndefined(); expect(decision.fire!.itemId).toBeUndefined();
  });
  it('homing evaluation includes the octopus after activation and does not assume it hits', () => {
    const state = initial(); state.octopus.spawnTurnId = 1;
    expect(evaluateAIShot(state, { angleDeg: 165, speed: 2200 }, 'homing').damage).toBe(0);
    expect(evaluateAIShot(state, { angleDeg: 135, speed: 2200 }, 'homing').damage).toBe(2);
  });
  it('normal can seek visible supply when its existing attack is ineffective, easy does not', () => {
    const state = initial();
    const point = legalCrateCandidates(state)[1]![0]!;
    state.items = [{ id: 'visible', type: 'heal', ...point, active: true, spawnTurnId: 1, expiresAtTurnId: 7 }];
    const bad = { moveTargetX: null, fire: { angleDeg: 175, speed: 900 } };
    const easy = withAIItems(state, bad, 'easy');
    const normal = withAIItems(state, bad, 'normal');
    expect(easy).toEqual(bad);
    expect(normal.fire).not.toEqual(bad.fire);
    expect(evaluateAIShot(state, normal.fire!).pickups).toBe(1);
  });
  it('decisions are deterministic and read only, with seeded error also on collection shots', () => {
    const state = initial();
    state.players.P2.inventory[0] = { id: 'health', type: 'heal' };
    const before = structuredClone(state);
    const controller = new AIController('hard');
    expect(controller.decide(state, new SeededRandom(1))).toEqual(controller.decide(state, new SeededRandom(1)));
    expect(state).toEqual(before);
  });
  it('AIInputSource submits USE_ITEM then FIRE through the ordinary rules, without direct writes', () => {
    const state = initial(); state.players.P2.hp = 4;
    state.players.P2.inventory[0] = { id: 'health', type: 'heal' };
    const bus = new InMemoryCommandBus();
    const commands: GameCommand[] = [];
    bus.subscribe((command) => {
      commands.push(command);
      if (command.type === 'USE_ITEM') new ItemSystem().execute(state, command);
      if (command.type === 'FIRE') new FireSystem().execute(state, command);
    });
    const ai = new AIInputSource({ playerId: 'P2', getState: () => state, commandBus: bus,
      rng: new SeededRandom(1), difficulty: 'hard' });
    ai.setEnabled(true); ai.update(16); ai.update(1000);
    expect(commands.map((command) => command.type)).toEqual(['USE_ITEM', 'FIRE']);
    expect(state.players.P2.hp).toBe(6);
    expect(state.players.P2.hasFired).toBe(true);
    expect(state.players.P2.itemUsedThisTurn).toBe(true);
    expect(state.players.P2.inventory[0]).toBeNull();
  });
});
