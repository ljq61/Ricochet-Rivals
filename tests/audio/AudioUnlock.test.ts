import { describe, expect, it, vi } from 'vitest';
import { AudioUnlock } from '../../src/game/audio/AudioUnlock';
import { SfxBus, SFX } from '../../src/game/audio/SfxBus';
import { resetUserSettingsForTest, toggleSound } from '../../src/game/settings/UserSettings';
import type Phaser from 'phaser';

function setup(state = 'suspended') {
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  const win = new EventTarget();
  const context = { state, resume: vi.fn(async () => { context.state = 'running'; }) };
  const sound = { context, locked: true, unlocked: false };
  const unlock = new AudioUnlock(sound, doc as unknown as Document, win as unknown as Window);
  return { doc, win, context, sound, unlock };
}

describe('native gesture audio unlock', () => {
  it('resumes synchronously on the first pointer gesture before a scene transition', async () => {
    const h = setup();
    h.doc.dispatchEvent(new Event('pointerdown'));
    expect(h.context.resume).toHaveBeenCalledOnce();
    await Promise.resolve();
    expect(h.sound.unlocked).toBe(true);
    h.unlock.destroy();
  });

  it('retries a rejected gesture at touch release and only unlocks a running context', async () => {
    const h = setup();
    h.context.resume.mockRejectedValueOnce(new Error('activation required'));
    h.doc.dispatchEvent(new Event('pointerdown'));
    await Promise.resolve();
    expect(h.sound.unlocked).toBe(false);
    h.doc.dispatchEvent(new Event('touchend'));
    await Promise.resolve();
    expect(h.context.resume).toHaveBeenCalledTimes(2);
    expect(h.sound.unlocked).toBe(true);
    h.unlock.destroy();
  });

  it('does not report unlocked when resume resolves without running', async () => {
    const h = setup('interrupted');
    h.context.resume.mockImplementation(async () => {});
    h.doc.dispatchEvent(new Event('pointerup'));
    await Promise.resolve();
    expect(h.sound.unlocked).toBe(false);
    h.unlock.destroy();
  });

  it('waits for interaction, then resumes an interrupted context on foreground return', async () => {
    const h = setup();
    h.doc.dispatchEvent(new Event('visibilitychange'));
    expect(h.context.resume).not.toHaveBeenCalled();
    h.doc.dispatchEvent(new Event('keydown'));
    await Promise.resolve();
    h.context.state = 'interrupted';
    h.doc.visibilityState = 'hidden';
    h.doc.dispatchEvent(new Event('visibilitychange'));
    expect(h.context.resume).toHaveBeenCalledOnce();
    h.doc.visibilityState = 'visible';
    h.doc.dispatchEvent(new Event('visibilitychange'));
    expect(h.context.resume).toHaveBeenCalledTimes(2);
    h.unlock.destroy();
  });

  it('removes listeners and ignores completion after game destruction', async () => {
    const h = setup();
    let resolve!: () => void;
    h.context.resume.mockImplementation(() => new Promise<void>((done) => { resolve = done; }));
    h.doc.dispatchEvent(new Event('pointerdown'));
    h.unlock.destroy();
    h.context.state = 'running';
    resolve();
    await Promise.resolve();
    expect(h.sound.unlocked).toBe(false);
    h.doc.dispatchEvent(new Event('pointerup'));
    h.win.dispatchEvent(new Event('focus'));
    expect(h.context.resume).toHaveBeenCalledOnce();
  });

  it('keeps sound preference in effect after unlocking', async () => {
    resetUserSettingsForTest();
    const h = setup();
    const play = vi.fn();
    const bus = new SfxBus({ cache: { audio: { exists: () => true } }, sound: { play } } as unknown as Phaser.Scene);
    toggleSound();
    h.doc.dispatchEvent(new Event('pointerdown'));
    await Promise.resolve();
    bus.play(SFX.launch);
    expect(play).not.toHaveBeenCalled();
    toggleSound();
    bus.play(SFX.launch);
    expect(play).toHaveBeenCalledOnce();
    h.unlock.destroy();
    resetUserSettingsForTest();
  });
});
