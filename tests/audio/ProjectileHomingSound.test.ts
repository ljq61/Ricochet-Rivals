import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type Phaser from 'phaser';
import { SfxBus, SFX } from '../../src/game/audio/SfxBus';
import { Projectile } from '../../src/game/entities/Projectile';
import { ProjectileSystem } from '../../src/game/systems/ProjectileSystem';
import { createInitialGameState } from '../../src/game/state/GameState';
import { resetUserSettingsForTest, toggleSound } from '../../src/game/settings/UserSettings';
import type { FireCommand } from '../../src/game/commands/GameCommand';
import type { ShotContext } from '../../src/game/state/ItemState';

vi.mock('phaser', async () => {
  const { EventEmitter } = await import('node:events');
  return { default: { Events: { EventEmitter }, Physics: { Matter: { Matter: { Body: {
    setPosition: (body: { position: unknown }, point: unknown) => { body.position = point; },
  } } } } } };
});
vi.mock('../../src/game/entities/ProjectileEffects', () => ({ ProjectileEffects: class {
  update() {} impact() {} finish() {}
} }));

const fire: FireCommand = { type: 'FIRE', playerId: 'P1', turnId: 1, weaponId: 'normal',
  startX: 450, startY: 896, velocityX: 1400, velocityY: -1400, seed: 1 };
const guide = (): ShotContext => ({ ownerId: 'P1', turnId: 1, itemType: 'homing', homingActivated: true });

function setup(assetExists = true) {
  const events = new EventEmitter();
  const visual = Object.fromEntries(['setOrigin', 'setDisplaySize', 'setDepth', 'setPosition',
    'setRotation', 'setTint', 'setVisible', 'destroy'].map(key => [key, vi.fn().mockReturnThis()]));
  const sounds: Array<{ play: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn> }> = [];
  const add = vi.fn(() => {
    const sound = { play: vi.fn(), stop: vi.fn(), destroy: vi.fn() };
    sounds.push(sound);
    return sound;
  });
  const scene = { events, cache: { audio: { exists: () => assetExists } }, sound: { add },
    textures: { exists: () => true }, add: { image: () => visual },
    matter: { add: { circle: () => ({ position: {} }), rectangle: () => ({ position: {} }) },
      world: { remove: vi.fn() } } } as unknown as Phaser.Scene;
  return { scene, events, sounds, add, visual };
}

describe('homing missile loop lifecycle', () => {
  beforeEach(() => resetUserSettingsForTest());
  afterEach(() => resetUserSettingsForTest());

  it('starts only on actual lock and repeated visual feedback does not duplicate the loop', () => {
    const h = setup();
    const shot = guide(); shot.homingActivated = false;
    const projectile = new Projectile(h.scene, 'guide', fire, shot);
    projectile.tick(700);
    projectile.showHomingLock();
    expect(h.add).not.toHaveBeenCalled();
    shot.homingActivated = true;
    projectile.showHomingLock(); projectile.showHomingLock();
    expect(h.add).toHaveBeenCalledExactlyOnceWith(SFX.itemHoming, { volume: 0.35, loop: true });
    expect(h.sounds[0]!.play).toHaveBeenCalledOnce();
    projectile.destroy();
  });

  it('ordinary projectiles remain silent even if lock feedback is mistakenly requested', () => {
    const h = setup();
    const projectile = new Projectile(h.scene, 'normal', fire);
    projectile.showHomingLock(); projectile.tick(1000);
    expect(h.add).not.toHaveBeenCalled();
    projectile.destroy();
  });

  it.each(['impact', 'out-of-bounds', 'destroy', 'shutdown'] as const)(
    '%s stops the loop immediately and a subsequent sound toggle cannot restart it', (ending) => {
      const h = setup(); const projectile = new Projectile(h.scene, 'guide', fire, guide());
      projectile.showHomingLock();
      if (ending === 'impact') projectile.beginImpact();
      if (ending === 'out-of-bounds') projectile.destroyWithoutExplosion();
      if (ending === 'destroy') projectile.destroy();
      if (ending === 'shutdown') h.events.emit('shutdown');
      expect(h.sounds[0]!.stop).toHaveBeenCalledOnce();
      expect(h.sounds[0]!.destroy).toHaveBeenCalledOnce();
      expect(h.events.listenerCount('shutdown')).toBe(0);
      toggleSound(); toggleSound();
      expect(h.add).toHaveBeenCalledOnce();
      projectile.destroy();
      expect(h.sounds[0]!.destroy).toHaveBeenCalledOnce();
    });

  it('muting destroys immediately and unmuting a still-flying missile restores exactly one sound', () => {
    const h = setup(); const projectile = new Projectile(h.scene, 'guide', fire, guide());
    projectile.showHomingLock();
    toggleSound();
    expect(h.sounds[0]!.destroy).toHaveBeenCalledOnce();
    projectile.showHomingLock();
    expect(h.add).toHaveBeenCalledOnce();
    toggleSound();
    expect(h.add).toHaveBeenCalledTimes(2);
    expect(h.sounds[1]!.play).toHaveBeenCalledOnce();
    projectile.showHomingLock();
    expect(h.add).toHaveBeenCalledTimes(2);
    projectile.beginImpact();
    expect(h.sounds[1]!.destroy).toHaveBeenCalledOnce();
    projectile.destroy();
  });

  it('an initially muted missile can become audible after lock, but never after disposal', () => {
    toggleSound();
    const h = setup(); const projectile = new Projectile(h.scene, 'guide', fire, guide());
    projectile.showHomingLock(); expect(h.add).not.toHaveBeenCalled();
    toggleSound(); expect(h.add).toHaveBeenCalledOnce();
    projectile.destroy(); toggleSound(); toggleSound();
    expect(h.add).toHaveBeenCalledOnce();
  });

  it('a missing sound asset stays playable and unregisters all listeners when stopped', () => {
    const h = setup(false); const stop = new SfxBus(h.scene).loop(SFX.itemHoming);
    expect(h.add).not.toHaveBeenCalled();
    stop(); stop();
    expect(h.events.listenerCount('shutdown')).toBe(0);
    toggleSound(); toggleSound(); expect(h.add).not.toHaveBeenCalled();
  });

  it.each([true, false])('authority=%s starts from local simulation at 800ms and clears recovery audio', (authority) => {
    const h = setup(); const system = new ProjectileSystem(h.scene);
    const state = createInitialGameState({ matchId: 'homing-audio', seed: 1 });
    const shot = guide(); shot.homingActivated = false;
    system.setAuthority(authority); system.launch(fire, shot);
    for (let frame = 0; frame < 47; frame++) system.update(state, 1000 / 60);
    expect(h.add).not.toHaveBeenCalled();
    system.update(state, 1000 / 60);
    expect(h.add).toHaveBeenCalledOnce();
    expect(shot.homingActivated).toBe(authority);
    system.clearInFlightSimulations();
    expect(h.sounds[0]!.destroy).toHaveBeenCalledOnce();
    for (let frame = 0; frame < 120; frame++) system.update(state, 1000 / 60);
    toggleSound(); toggleSound();
    expect(h.add).toHaveBeenCalledOnce();
    system.destroy();
  });
});
