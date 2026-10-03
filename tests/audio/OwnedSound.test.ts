import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type Phaser from 'phaser';
import { SfxBus, SFX } from '../../src/game/audio/SfxBus';
import { resetUserSettingsForTest, toggleSound } from '../../src/game/settings/UserSettings';
vi.mock('phaser', () => ({ default: {} }));
beforeEach(resetUserSettingsForTest);
afterEach(resetUserSettingsForTest);
function setup(exists = true) {
  const events = new EventEmitter();
  const sound = Object.assign(new EventEmitter(), { play: vi.fn(), stop: vi.fn(), destroy: vi.fn() });
  const add = vi.fn(() => sound);
  const scene = { events, cache: { audio: { exists: () => exists } }, sound: { add } } as unknown as Phaser.Scene;
  return { bus: new SfxBus(scene), sound, events, add };
}
it.each(['mute', 'complete', 'shutdown', 'cancel'])('owned bomb sound ends on %s and never resumes after a setting toggle', ending => {
  const h = setup(); const stop = h.bus.playOwned(SFX.airstrikeDrop);
  expect(h.add).toHaveBeenCalledExactlyOnceWith(SFX.airstrikeDrop, { volume: 0.5, loop: false });
  if (ending === 'mute') toggleSound();
  if (ending === 'complete') h.sound.emit('complete');
  if (ending === 'shutdown') h.events.emit('shutdown');
  if (ending === 'cancel') stop();
  stop();
  expect(h.sound.stop).toHaveBeenCalledOnce();
  expect(h.sound.destroy).toHaveBeenCalledOnce();
  expect(h.events.listenerCount('shutdown')).toBe(0);
  expect(h.sound.listenerCount('complete')).toBe(0);
  toggleSound(); toggleSound();
  expect(h.add).toHaveBeenCalledOnce();
});
it.each(['muted', 'missing'])('does not delay a %s bomb sound until a later setting toggle', ending => {
  const h = setup(ending !== 'missing'); if (ending === 'muted') toggleSound();
  const stop = h.bus.playOwned(SFX.airstrikeDrop); toggleSound(); stop();
  expect(h.add).not.toHaveBeenCalled();
  expect(h.events.listenerCount('shutdown')).toBe(0);
});
