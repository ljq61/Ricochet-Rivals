import { describe, expect, it, vi } from 'vitest';
import type Phaser from 'phaser';
import type { FireCommand } from '../../src/game/commands/GameCommand';
import { ProjectileSystem } from '../../src/game/systems/ProjectileSystem';
import { createInitialGameState, TurnPhase } from '../../src/game/state/GameState';
import { createFlightState } from '../../src/game/physics/flightSimulation';
import type { ShotContext } from '../../src/game/state/ItemState';
import { FireSystem } from '../../src/game/systems/FireSystem';
import { findCrateShot } from '../../src/game/systems/ItemSystem';

vi.mock('phaser', async () => {
  const { EventEmitter } = await import('node:events');
  return { default: { Events: { EventEmitter }, Physics: { Matter: { Matter: { Body: {
    setPosition: (body: { position: unknown }, point: unknown) => { body.position = point; },
  } } } } } };
});
vi.mock('../../src/game/entities/Projectile', () => ({ Projectile: class {
  state: ReturnType<typeof createFlightState>;
  shot: ShotContext;
  turnId: number;
  constructor(_scene: unknown, id: string, command: FireCommand, shot?: ShotContext) {
    this.state = createFlightState(command, id);
    this.shot = shot ?? { ownerId: command.playerId, turnId: command.turnId, homingActivated: false };
    this.turnId = command.turnId;
  }
  get position() { return { x: this.state.x, y: this.state.y }; }
  beginImpact() { this.state.status = 'exploding'; }
  destroyWithoutExplosion() { this.state.status = 'destroyed'; }
  showHomingLock() {}
  tick() {}
  destroy() {}
} }));

function setup(authority = true) {
  const state = createInitialGameState({ matchId: 'projectile-items', seed: 1 });
  state.phase = TurnPhase.ACTION;
  const scene = { matter: { add: { rectangle: (x: number, y: number) => ({ position: { x, y } }) },
    world: { remove: vi.fn() } } } as unknown as Phaser.Scene;
  const projectile = new ProjectileSystem(scene);
  projectile.setAuthority(authority);
  const fire: FireCommand = { type: 'FIRE', playerId: 'P1', turnId: 1,
    weaponId: 'normal', startX: 450, startY: 896, velocityX: 1400, velocityY: -1400, seed: 1 };
  const launch = (command = fire) => {
    const result = new FireSystem().execute(state, command);
    expect(result.accepted).toBe(true);
    projectile.launch(command, result.shot);
  };
  return { state, projectile, fire, launch };
}
const crate = (id = 'crate', x = 1600, y = 440) => ({ id, type: 'heal' as const, x, y, active: true,
  spawnTurnId: 1, expiresAtTurnId: 7 });

describe('projectile item authority integration', () => {
  it('collects using production sweeps without changing current flight or modifier', () => {
    const withCrate = setup(); const withoutCrate = setup();
    const item = crate();
    const velocity = findCrateShot(withCrate.state, 'P1', item)!;
    withCrate.state.items = [item];
    const pickup = vi.fn(); withCrate.projectile.onPickup(pickup);
    withCrate.launch({ ...withCrate.fire, ...velocity });
    withoutCrate.launch({ ...withoutCrate.fire, ...velocity });
    for (let frame = 0; frame < 120; frame++) {
      withCrate.projectile.update(withCrate.state, 1000 / 60);
      withoutCrate.projectile.update(withoutCrate.state, 1000 / 60);
    }
    expect(pickup).toHaveBeenCalledTimes(1);
    expect(withCrate.state.players.P1.inventory[0]!.id).toBe('crate');
    expect(withCrate.state.acceptedShot!.itemType).toBeUndefined();
    expect(withCrate.projectile.activeProjectiles).toEqual(withoutCrate.projectile.activeProjectiles);
  });
  it('Guest flight predicts visually but never awards a pickup or writes its lock to public state', () => {
    const { state, projectile, fire, launch } = setup(false);
    state.items = [crate('near', 490, 865)];
    state.players.P1.inventory[0] = { id: 'guide', type: 'homing' };
    const pickup = vi.fn(); const changed = vi.fn();
    projectile.onPickup(pickup); projectile.onItemChanged(changed);
    launch({ ...fire, itemId: 'guide' });
    for (let frame = 0; frame < 60; frame++) projectile.update(state, 1000 / 60);
    expect(pickup).not.toHaveBeenCalled(); expect(changed).not.toHaveBeenCalled();
    expect(state.items[0]!.id).toBe('near');
    expect(state.players.P1.inventory).toEqual([null, null, null]);
    expect(state.acceptedShot!.homingActivated).toBe(false);
  });
  it('Host exposes one lock event and updates the accepted shot context', () => {
    const { state, projectile, fire, launch } = setup();
    state.players.P1.inventory[0] = { id: 'guide', type: 'homing' };
    const changed = vi.fn(); projectile.onItemChanged(changed);
    launch({ ...fire, itemId: 'guide' });
    for (let frame = 0; frame < 60; frame++) projectile.update(state, 1000 / 60);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(changed).toHaveBeenCalledWith('homing', 'guide');
    expect(state.acceptedShot!.homingActivated).toBe(true);
    expect(state.acceptedShot!.homingTarget).toEqual({ x: 4550, y: 870 });
  });
  it.each([true, false])('authority=%s full-inventory cosmetic feedback is once and keeps the wooden box', (authority) => {
    const { state, projectile, launch } = setup(authority);
    state.players.P1.inventory = ['a', 'b', 'c'].map((id) => ({ id, type: 'heal' }));
    state.items = [crate('near', 490, 865)];
    const notice = vi.fn(); projectile.onInventoryFull(notice);
    launch();
    for (let frame = 0; frame < 10; frame++) projectile.update(state, 1000 / 60);
    expect(notice).toHaveBeenCalledTimes(1);
    expect(state.items).toHaveLength(1);
    expect(state.players.P1.inventory.map((item) => item!.id)).toEqual(['a', 'b', 'c']);
  });
  it('pickup and collision notifications are ordered and nothing behind the octopus is awarded', () => {
    const { state, projectile, fire, launch } = setup();
    state.octopus.spawnTurnId = 1;
    state.items = [crate('near', 2300, 520), crate('behind', 2800, 520)];
    const events: string[] = [];
    projectile.onPickup((pickup) => events.push(pickup.itemId));
    projectile.onImpact(() => events.push('impact'));
    launch({ ...fire, startX: 2100, startY: 500, velocityX: 2400, velocityY: 0 });
    projectile.update(state, 200); projectile.update(state, 200);
    expect(events).toEqual(['near', 'impact']);
    expect(state.items.map((item) => item.id)).toEqual(['behind']);
  });
  it('clearing an in-flight simulation prevents all stale lock/pickup events', () => {
    const { state, projectile, fire, launch } = setup();
    state.players.P1.inventory[0] = { id: 'guide', type: 'homing' };
    const changed = vi.fn(); projectile.onItemChanged(changed);
    launch({ ...fire, itemId: 'guide' });
    projectile.update(state, 200); projectile.update(state, 200);
    projectile.clearInFlightSimulations();
    for (let frame = 0; frame < 60; frame++) projectile.update(state, 1000 / 60);
    expect(changed).not.toHaveBeenCalled();
    expect(projectile.activeProjectiles).toHaveLength(0);
  });
});
