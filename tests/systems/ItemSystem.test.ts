import { describe, expect, it } from 'vitest';
import { GAME_CONFIG } from '../../src/game/config/GameConfig';
import type { FireCommand, UseItemCommand } from '../../src/game/commands/GameCommand';
import { createInitialGameState, TurnPhase, type GameState } from '../../src/game/state/GameState';
import type { WorldItemState } from '../../src/game/state/WorldItemState';
import { PLAYER_IDS, type WorldItemType } from '../../src/game/state/ids';
import { ItemSystem, findCrateShot, legalCrateCandidates } from '../../src/game/systems/ItemSystem';
import { FireSystem } from '../../src/game/systems/FireSystem';
import { ConcreteDamageSystem } from '../../src/game/systems/DamageSystem';
import { ExplosionSystem } from '../../src/game/systems/ExplosionSystem';
import { resolveOctopusTurn } from '../../src/game/systems/OctopusHazardSystem';
import { TurnManager } from '../../src/game/systems/TurnManager';
import { createFlightState, stepFlight } from '../../src/game/physics/flightSimulation';
import { SeededRandom, type RandomSource } from '../../src/game/random/SeededRandom';

const initial = (seed = 1): GameState => {
  const state = createInitialGameState({ matchId: 'items', seed });
  state.phase = TurnPhase.ACTION;
  return state;
};
const crate = (id: string, x = 1700, type: WorldItemType = 'heal'): WorldItemState => ({
  id, type, x, y: 440, active: true, spawnTurnId: 3, expiresAtTurnId: 9,
});
const heal = (overrides: Partial<UseItemCommand> = {}): UseItemCommand => ({
  type: 'USE_ITEM', playerId: 'P1', turnId: 1, itemId: 'heal', ...overrides,
});
const fire = (itemId?: string): FireCommand => ({ type: 'FIRE', playerId: 'P1', turnId: 1,
  weaponId: 'normal', startX: 450, startY: 896, velocityX: 1400, velocityY: -1400, seed: 1,
  ...(itemId === undefined ? {} : { itemId }),
});
const fixed = (value: number): RandomSource => ({ next: () => value,
  range: (min, max) => min + (max - min) * value,
  integer: (min, max) => min + Math.floor((max - min + 1) * value),
});

describe('item spawn windows', () => {
  const items = new ItemSystem();
  it('round one has none, first eligible second-round window is guaranteed and idempotent', () => {
    const state = initial();
    state.itemGeneration.firstWindowParity = 0;
    for (const turn of [1, 2]) {
      state.turnId = turn;
      expect(items.processTurnStart(state).spawned).toBeNull();
    }
    state.turnId = 3;
    const spawned = items.processTurnStart(state).spawned;
    expect(spawned).not.toBeNull();
    expect(items.processTurnStart(state).spawned).toBeNull();
    expect(state.items).toHaveLength(1);
    expect(spawned!.expiresAtTurnId).toBe(9);
  });
  it('seeded first windows do not favor the same actor across matches', () => {
    let first = 0;
    for (let seed = 0; seed < 10000; seed++) first += Number(initial(seed).itemGeneration.firstWindowParity === 0);
    expect(first / 10000).toBeGreaterThan(0.47);
    expect(first / 10000).toBeLessThan(0.53);
  });
  it('each crate survives exactly its six offered actions and Guest never regenerates', () => {
    const state = initial();
    state.itemGeneration.firstWindowParity = 0;
    state.turnId = 3;
    const spawned = items.processTurnStart(state).spawned!;
    for (let turn = 4; turn <= 8; turn++) {
      state.turnId = turn;
      items.processTurnStart(state);
      expect(state.items.some((item) => item.id === spawned.id)).toBe(true);
    }
    state.turnId = 9;
    items.processTurnStart(state);
    expect(state.items.some((item) => item.id === spawned.id)).toBe(false);
    const guest = initial(); guest.turnId = 3; guest.itemGeneration.firstWindowParity = 0;
    new TurnManager(guest, false).beginTurn('P1');
    expect(guest.items).toHaveLength(0);
    expect(guest.itemGeneration.lastWindowTurnId).toBe(0);
  });
  it('alternates one generation window within successive complete rounds', () => {
    const state = initial();
    state.itemGeneration.firstWindowParity = 0;
    const windows: number[] = [];
    for (let turn = 1; turn <= 12; turn++) {
      state.turnId = turn;
      state.items = [];
      items.processTurnStart(state, fixed(0));
      if (state.itemGeneration.lastWindowTurnId === turn) windows.push(turn);
    }
    expect(windows).toEqual([3, 6, 7, 10, 11]);
  });
  it('65% boundary and two misses force the third eligible check', () => {
    const state = initial();
    state.itemGeneration.firstWindowParity = 0;
    state.turnId = 3;
    items.processTurnStart(state, fixed(0));
    state.items = [];
    state.turnId = 6;
    expect(items.processTurnStart(state, fixed(0.65)).skipped).toBe('probability');
    expect(state.itemGeneration.misses).toBe(1);
    state.turnId = 7;
    expect(items.processTurnStart(state, fixed(0.99)).skipped).toBe('probability');
    state.turnId = 10;
    expect(items.processTurnStart(state, fixed(0.99)).spawned).not.toBeNull();
    expect(state.itemGeneration.misses).toBe(0);
    state.items = [];
    state.turnId = 11;
    expect(items.processTurnStart(state, fixed(0.64999)).spawned).not.toBeNull();
  });
  it('full field skips without consuming pity, expiration also runs off-window', () => {
    const state = initial();
    state.itemGeneration.firstWindowParity = 0;
    state.turnId = 6;
    state.itemGeneration.misses = 1;
    state.items = [crate('a'), crate('b', 3300)];
    expect(items.processTurnStart(state).skipped).toBe('full');
    expect(state.itemGeneration.misses).toBe(1);
    state.turnId = 9;
    expect(items.processTurnStart(state).expiredIds).toEqual(['a', 'b']);
    expect(state.items).toHaveLength(0);
  });
  it('no legal candidate leaves pity unchanged and exits finitely', () => {
    const state = initial();
    state.itemGeneration.firstWindowParity = 0;
    state.turnId = 3;
    state.itemGeneration.misses = 1;
    state.players.P1.x = Number.NaN;
    state.players.P2.x = Number.NaN;
    expect(items.processTurnStart(state).skipped).toBe('no-candidates');
    expect(state.itemGeneration.misses).toBe(1);
  });
  it('same seed/state yields same position/type/id, independently of AI RNG', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const a = initial(seed);
      const b = initial(seed);
      a.turnId = b.turnId = 3 + a.itemGeneration.firstWindowParity;
      for (let i = 0; i < seed; i++) new SeededRandom(seed).next();
      expect(items.processTurnStart(a)).toEqual(items.processTurnStart(b));
      expect(a).toEqual(b);
    }
  });
  it.each([[0, 'heal'], [0.26999, 'heal'], [0.27, 'damage_boost'], [0.53999, 'damage_boost'],
    [0.54, 'range_boost'], [0.75999, 'range_boost'], [0.76, 'homing'], [0.89999, 'homing'],
    [0.9, 'airstrike'], [0.99999, 'airstrike']] as const)(
    'type weight boundary %s selects %s', (random, type) => {
      const state = initial();
      state.turnId = 3;
      state.itemGeneration.firstWindowParity = 0;
      expect(items.processTurnStart(state, fixed(random)).spawned!.type).toBe(type);
    });
  it('both regions remain legal in normal and octopus scenes and every candidate is truly reachable', () => {
    for (const hazard of [false, true]) {
      const state = initial();
      if (hazard) state.octopus.spawnTurnId = 1;
      const regions = legalCrateCandidates(state);
      expect(regions[0]!.length).toBeGreaterThan(0);
      expect(regions[1]!.length).toBeGreaterThan(0);
      for (const point of regions.flat()) {
        expect(PLAYER_IDS.some((id) => findCrateShot(state, id, point) !== null)).toBe(true);
        expect(point.y).toBeGreaterThanOrEqual(240);
        expect(point.y).toBeLessThanOrEqual(620);
      }
    }
  });
  it('a skipped window never gets retried midway through its action', () => {
    const state = initial();
    state.itemGeneration.firstWindowParity = 0;
    state.turnId = 6;
    state.items = [crate('a'), crate('b', 3300)];
    items.processTurnStart(state);
    state.items = [];
    expect(items.processTurnStart(state).spawned).toBeNull();
  });
});

describe('continuous pickups and fixed slots', () => {
  const items = new ItemSystem();
  it('collects along a high-speed segment in contact order without changing flight properties', () => {
    const state = initial();
    state.items = [crate('far', 2200, 'homing'), crate('near', 1700)];
    const flight = createFlightState(fire());
    const previous = structuredClone(flight);
    const pickups = items.collectAlongSegment(state, 'P1', { x: 1000, y: 440 }, { x: 2400, y: 440 });
    expect(pickups.map((entry) => entry.itemId)).toEqual(['near', 'far']);
    expect(state.players.P1.inventory.map((entry) => entry?.id ?? null)).toEqual(['near', 'far', null]);
    expect(flight).toEqual(previous);
    expect(items.collectAlongSegment(state, 'P1', { x: 2400, y: 440 }, { x: 1000, y: 440 })).toEqual([]);
  });
  it('with one empty slot takes only first box, full slots keep world boxes and fixed positions', () => {
    const state = initial();
    state.players.P1.inventory = [{ id: 'a', type: 'heal' }, null, { id: 'b', type: 'homing' }];
    state.items = [crate('near'), crate('far', 2200)];
    items.collectAlongSegment(state, 'P1', { x: 1000, y: 440 }, { x: 2400, y: 440 });
    expect(state.players.P1.inventory.map((entry) => entry?.id)).toEqual(['a', 'near', 'b']);
    expect(state.items.map((entry) => entry.id)).toEqual(['far']);
    expect(items.collectAlongSegment(state, 'P1', { x: 2200, y: 440 }, { x: 2400, y: 440 })).toEqual([]);
    expect(state.items[0]!.id).toBe('far');
  });
  it('a parachute-only route does not collect, and picks are always awarded to shooter', () => {
    const state = initial();
    state.items = [crate('box')];
    expect(items.collectAlongSegment(state, 'P2', { x: 1500, y: 350 }, { x: 1900, y: 350 })).toEqual([]);
    items.collectAlongSegment(state, 'P2', { x: 1900, y: 440 }, { x: 1500, y: 440 });
    expect(state.players.P1.inventory).toEqual([null, null, null]);
    expect(state.players.P2.inventory[0]!.id).toBe('box');
  });
  it('never collects past a terminal collision, but permits pickup at exactly the contact point', () => {
    const state = initial();
    state.octopus.spawnTurnId = 1;
    state.items = [crate('behind', 2800), { ...crate('contact', 2427.5), y: 550 }];
    const flight = createFlightState(fire());
    flight.x = 2100; flight.y = 500; flight.velocityX = 2000; flight.velocityY = 0; flight.armed = true;
    const update = stepFlight(flight, state, 250);
    for (const segment of update.segments) items.collectAlongSegment(state, 'P1', segment.from, segment.to);
    expect(state.players.P1.inventory[0]!.id).toBe('contact');
    expect(state.items.map((item) => item.id)).toEqual(['behind']);
  });
});

describe('use one item per action', () => {
  const items = new ItemSystem();
  it.each([[8, 10], [9, 10]])('heals %i to %i, consumes fixed slot, keeps the shot available', (hp, after) => {
    const state = initial(); state.players.P1.hp = hp;
    state.players.P1.inventory[1] = { id: 'heal', type: 'heal' };
    expect(items.execute(state, heal())).toMatchObject({ accepted: true, hpBefore: hp, hpAfter: after });
    expect(state.players.P1.inventory).toEqual([null, null, null]);
    expect(state.players.P1.itemUsedThisTurn).toBe(true);
    expect(new FireSystem().execute(state, fire()).accepted).toBe(true);
  });
  it.each(['GAME_OVER', 'WRONG_PHASE', 'TURN_MISMATCH', 'NOT_CURRENT_PLAYER', 'PLAYER_DEAD',
    'ALREADY_FIRED', 'ITEM_ALREADY_USED', 'ITEM_NOT_OWNED', 'NOT_HEAL_ITEM', 'FULL_HP'] as const)(
    '%s rejects without deleting or healing', (reason) => {
      const state = initial(); state.players.P1.hp = 8;
      state.players.P1.inventory[0] = { id: 'heal', type: 'heal' };
      const cmd = heal();
      if (reason === 'GAME_OVER') state.gameOver = true;
      if (reason === 'WRONG_PHASE') state.phase = TurnPhase.RETURN_HOME;
      if (reason === 'TURN_MISMATCH') cmd.turnId = 2;
      if (reason === 'NOT_CURRENT_PLAYER') state.currentPlayerId = 'P2';
      if (reason === 'PLAYER_DEAD') state.players.P1.hp = 0;
      if (reason === 'ALREADY_FIRED') state.players.P1.hasFired = true;
      if (reason === 'ITEM_ALREADY_USED') state.players.P1.itemUsedThisTurn = true;
      if (reason === 'ITEM_NOT_OWNED') cmd.itemId = 'foreign';
      if (reason === 'NOT_HEAL_ITEM') state.players.P1.inventory[0]!.type = 'homing';
      if (reason === 'FULL_HP') state.players.P1.hp = 10;
      const before = structuredClone(state);
      expect(items.execute(state, cmd)).toEqual({ accepted: false, reason });
      expect(state).toEqual(before);
    });
  it('accepted heal cannot repeat or be followed by a boosted shot; next action resets budget only', () => {
    const state = initial(); state.players.P1.hp = 6;
    state.players.P1.inventory = [{ id: 'heal', type: 'heal' }, { id: 'boost', type: 'damage_boost' }, null];
    items.execute(state, heal());
    expect(items.execute(state, heal()).accepted).toBe(false);
    expect(new FireSystem().execute(state, fire('boost')).reason).toBe('ITEM_ALREADY_USED');
    expect(state.players.P1.inventory[1]!.id).toBe('boost');
    new TurnManager(state).beginTurn('P1');
    expect(state.players.P1.itemUsedThisTurn).toBe(false);
    expect(state.players.P1.inventory[1]!.id).toBe('boost');
  });
  it('attack selection rejected at fire keeps inventory; accepted fire consumes exactly one and records immutable effect', () => {
    const state = initial();
    state.players.P1.inventory = [{ id: 'boost', type: 'damage_boost' }, { id: 'range', type: 'range_boost' }, null];
    const system = new FireSystem();
    expect(system.execute(state, { ...fire('boost'), turnId: 99 }).accepted).toBe(false);
    expect(state.players.P1.inventory[0]).not.toBeNull();
    expect(system.execute(state, fire('boost')).shot).toMatchObject({ itemId: 'boost', itemType: 'damage_boost' });
    expect(state.players.P1.inventory).toEqual([null, { id: 'range', type: 'range_boost' }, null]);
    expect(system.execute(state, fire('range')).accepted).toBe(false);
  });
  it('picked-up homing cannot change the already accepted ordinary shot', () => {
    const state = initial();
    new FireSystem().execute(state, fire());
    const shot = structuredClone(state.acceptedShot);
    state.items = [crate('homing', 1700, 'homing')];
    items.collectAlongSegment(state, 'P1', { x: 1500, y: 440 }, { x: 1900, y: 440 });
    expect(state.acceptedShot).toEqual(shot);
    expect(state.acceptedShot!.itemType).toBeUndefined();
  });
  it('healing leaves a previously spawned octopus and laser timing untouched', () => {
    const state = initial(); state.players.P1.hp = 4;
    state.octopus.spawnTurnId = 1;
    state.players.P1.inventory[0] = { id: 'heal', type: 'heal' };
    const previous = structuredClone(state.octopus);
    items.execute(state, heal());
    expect(state.octopus).toEqual(previous);
  });
});

describe('projectile-bound effect damage', () => {
  it.each([
    ['damage_boost', 0, 3], ['damage_boost', 100, 2], ['damage_boost', 141, 0],
    ['range_boost', 80, 2], ['range_boost', 200, 1], ['range_boost', 211, 0],
    [undefined, 80, 1], [undefined, 141, 0],
  ] as const)('%s at AABB distance %i gives %i and leaves global config untouched', (itemType, distance, damage) => {
    const state = initial();
    const result = new ExplosionSystem({ damage: new ConcreteDamageSystem() }).explode(state, {
      x: state.players.P2.x - 60 - distance, y: 870, ownerId: 'P1', weaponId: 'normal', turnId: 1, itemType,
    });
    expect(result.players.find((entry) => entry.playerId === 'P2')!.damage).toBe(damage);
    expect(GAME_CONFIG.explosion).toMatchObject({ radius: 140, directDamage: 2, splashDamage: 1 });
    expect(result.explosion.radius).toBe(itemType === 'range_boost' ? 210 : 140);
  });
  it('boosts self damage and octopus damage but not its laser', () => {
    const state = initial();
    const explosion = new ExplosionSystem({ damage: new ConcreteDamageSystem() });
    explosion.explode(state, { x: 450, y: 870, ownerId: 'P1', weaponId: 'normal', turnId: 1, itemType: 'damage_boost' });
    expect(state.players.P1.hp).toBe(7);
    state.octopus.spawnTurnId = 1; state.turnId = 6;
    const impact = { x: 2500, y: 400, ownerId: 'P1' as const, weaponId: 'normal' as const,
      turnId: 6, itemType: 'damage_boost' as const };
    resolveOctopusTurn(state, impact, null);
    expect(state.octopus.hp).toBe(12);
    const target = state.octopus.lastAttackTarget!;
    expect(state.players[target].hp).toBe(target === 'P1' ? 6 : 9);
  });
});
