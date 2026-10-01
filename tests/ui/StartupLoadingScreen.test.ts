import { EventEmitter } from 'node:events';
import type Phaser from 'phaser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { finishStartupLoadingAfterRender, isStartupLoadingVisible,
  removeStartupLoading, updateStartupLoading } from '../../src/game/ui/StartupLoadingScreen';

function fixture() {
  const elements = new Map(['startup-loading', 'startup-loading-progress', 'startup-loading-fill',
    'startup-loading-status'].map((id) => [id, {
    style: { width: '' }, textContent: '', attributes: {} as Record<string, string>,
    setAttribute(key: string, value: string) { this.attributes[key] = value; },
    remove: vi.fn(() => { elements.delete(id); }),
  }]));
  vi.stubGlobal('document', { getElementById: (id: string) => elements.get(id) ?? null });
  const gameEvents = new EventEmitter(), sceneEvents = new EventEmitter();
  const scene = { game: { events: gameEvents }, events: sceneEvents } as unknown as Phaser.Scene;
  return { elements, gameEvents, sceneEvents, scene };
}

afterEach(() => vi.unstubAllGlobals());

describe('StartupLoadingScreen lifecycle', () => {
  it('shows actual loader progress and ignores nonfinite values', () => {
    const { elements } = fixture();
    updateStartupLoading(0.37);
    expect(elements.get('startup-loading-progress')!.attributes['aria-valuenow']).toBe('37');
    expect(elements.get('startup-loading-fill')!.style.width).toBe('37%');
    expect(elements.get('startup-loading-status')!.textContent).toContain('37%');
    updateStartupLoading(Number.NaN);
    expect(elements.get('startup-loading-fill')!.style.width).toBe('37%');
    updateStartupLoading(2);
    expect(elements.get('startup-loading-fill')!.style.width).toBe('100%');
  });

  it('keeps the overlay until the first completed menu render and releases its listener', () => {
    const { scene, elements, gameEvents, sceneEvents } = fixture();
    const overlay = elements.get('startup-loading')!;
    finishStartupLoadingAfterRender(scene);
    expect(isStartupLoadingVisible()).toBe(true);
    expect(overlay.remove).not.toHaveBeenCalled();
    expect(elements.get('startup-loading-progress')!.attributes['aria-valuenow']).toBe('100');
    gameEvents.emit('postrender');
    expect(isStartupLoadingVisible()).toBe(false);
    expect(overlay.remove).toHaveBeenCalledTimes(1);
    expect(sceneEvents.listenerCount('shutdown')).toBe(0);
    expect(gameEvents.listenerCount('postrender')).toBe(0);
    gameEvents.emit('postrender');
    expect(overlay.remove).toHaveBeenCalledTimes(1);
  });

  it('cancels a pending dismissal on shutdown so the next scene owns completion', () => {
    const { scene, gameEvents, sceneEvents } = fixture();
    finishStartupLoadingAfterRender(scene);
    sceneEvents.emit('shutdown');
    expect(gameEvents.listenerCount('postrender')).toBe(0);
    gameEvents.emit('postrender');
    expect(isStartupLoadingVisible()).toBe(true);
    const nextEvents = new EventEmitter();
    const nextScene = { game: { events: gameEvents }, events: nextEvents } as unknown as Phaser.Scene;
    finishStartupLoadingAfterRender(nextScene);
    gameEvents.emit('postrender');
    expect(isStartupLoadingVisible()).toBe(false);
    expect(nextEvents.listenerCount('shutdown')).toBe(0);
  });

  it('tolerates teardown before rendering and repeated completion after the DOM is removed', () => {
    const { scene, gameEvents, elements } = fixture();
    const overlay = elements.get('startup-loading')!;
    finishStartupLoadingAfterRender(scene);
    removeStartupLoading(); // main.ts uses this for the game DESTROY event.
    removeStartupLoading();
    gameEvents.emit('postrender');
    finishStartupLoadingAfterRender(scene);
    updateStartupLoading(0.5);
    expect(overlay.remove).toHaveBeenCalledTimes(1);
    expect(gameEvents.listenerCount('postrender')).toBe(0);
  });
});
