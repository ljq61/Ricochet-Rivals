import { beforeEach, expect, it, vi } from 'vitest';
import type Phaser from 'phaser';
import { AirstrikeView } from '../../src/game/entities/AirstrikeView';
import { ART } from '../../src/game/config/ArtAssets';
import { GAME_CONFIG } from '../../src/game/config/GameConfig';
import { TurnPhase } from '../../src/game/state/TurnPhase';
import type { AirstrikeContext } from '../../src/game/state/AirstrikeState';

const effects = vi.hoisted(() => ({ impact: vi.fn(), sound: vi.fn(), engine: vi.fn(), drop: vi.fn(), stopEngine: vi.fn(), stopDrop: vi.fn() }));
vi.mock('../../src/game/entities/ProjectileEffects', () => ({
  ProjectileEffects: class { impact = effects.impact; },
}));
vi.mock('../../src/game/audio/SfxBus', () => ({
  SFX: { explosion: 'explosion', airstrikeEngine: 'engine', airstrikeDrop: 'drop' },
  SfxBus: class { play = effects.sound;
    loop = effects.engine.mockImplementation(() => effects.stopEngine);
    playOwned = effects.drop.mockImplementation(() => effects.stopDrop); },
}));
beforeEach(() => vi.clearAllMocks());

interface Sprite {
  x: number; y: number; width: number; height: number;
  flipX: boolean; visible: boolean; destroyed: boolean; scale: number;
}
interface TweenConfig {
  targets: Sprite; x?: number; y?: number; duration: number; ease: string; onComplete?: () => void;
}
function fixture() {
  const sprites: Sprite[] = [];
  const tweens: Array<{ config: TweenConfig; remove: ReturnType<typeof vi.fn> }> = [];
  const timers: Array<{ duration: number; callback: () => void; remove: ReturnType<typeof vi.fn> }> = [];
  const shake = vi.fn();
  const image = vi.fn((x: number, y: number) => {
    const state = { x, y, width: 1000, height: 400, flipX: false, visible: true, destroyed: false, scale: 1 };
    const sprite = new Proxy(state, { get: (obj, key) => key in obj ? obj[key as keyof Sprite] : (...args: unknown[]) => {
      if (key === 'setFlipX') obj.flipX = args[0] as boolean;
      if (key === 'setVisible') obj.visible = args[0] as boolean;
      if (key === 'setScale') obj.scale = args[0] as number;
      if (key === 'destroy') obj.destroyed = true;
      return sprite;
    } });
    sprites.push(sprite);
    return sprite;
  });
  const scene = { add: { image }, cameras: { main: { shake } },
    tweens: { add: (config: TweenConfig) => {
      const tween = { config, remove: vi.fn() }; tweens.push(tween); return tween;
    } }, time: { delayedCall: (duration: number, callback: () => void) => {
      const timer = { duration, callback, remove: vi.fn() }; timers.push(timer); return timer;
    } } } as unknown as Phaser.Scene;
  const finishTween = (index: number) => {
    const config = tweens[index]!.config;
    if (config.x !== undefined) config.targets.x = config.x;
    if (config.y !== undefined) config.targets.y = config.y;
    config.onComplete?.();
  };
  return { view: new AirstrikeView(scene), sprites, tweens, timers, shake, image, finishTween };
}
function context(ownerId: 'P1' | 'P2' = 'P1'): AirstrikeContext {
  return { itemId: 'airstrike-1', turnId: 3, ownerId,
    target: { x: ownerId === 'P1' ? 4550 : 450, y: 870 }, resumePhase: TurnPhase.ACTION };
}

it.each(['P1', 'P2'] as const)('flies from %s rear, preserves speed after release and drops at the frozen target', (ownerId) => {
  const f = fixture(), impact = vi.fn(), complete = vi.fn(), flight = context(ownerId);
  const target = { ...flight.target };
  f.view.play(flight, impact, complete);
  const plane = f.sprites[0]!;
  const startX = ownerId === 'P1' ? -200 : GAME_CONFIG.world.width + 200;
  expect(plane.x).toBe(startX);
  expect(plane.flipX).toBe(ownerId === 'P2');
  expect(f.image).toHaveBeenCalledWith(startX, GAME_CONFIG.items.airstrikeAltitudeY, ART.airstrikePlane, 'plane');
  expect(f.view.followTarget).toEqual({ x: startX, y: plane.y });
  expect(f.view.debugState.stage).toBe('flying');
  expect(effects.engine).toHaveBeenCalledExactlyOnceWith('engine');
  expect(effects.drop).not.toHaveBeenCalled();
  expect(f.tweens[0]!.config.duration).toBe(GAME_CONFIG.items.airstrikeFlightMs);
  flight.target.x = 999; // A replaced network state cannot redirect an accepted flight.
  f.finishTween(0);
  const bomb = f.sprites[1]!, exit = f.tweens[1]!.config;
  expect(bomb.x).toBe(target.x);
  expect(f.view.debugState.stage).toBe('dropping');
  expect(effects.drop).toHaveBeenCalledExactlyOnceWith('drop');
  expect(f.view.followTarget).toEqual({ x: bomb.x, y: bomb.y });
  expect((exit.x! - target.x) / exit.duration).toBeCloseTo((target.x - startX) / GAME_CONFIG.items.airstrikeFlightMs);
  expect(f.tweens[2]!.config.y).toBe(target.y);
  f.finishTween(2);
  // Even accidentally repeated tween callbacks cannot repeat damage or sounds.
  f.tweens[2]!.config.onComplete?.();
  expect(impact).toHaveBeenCalledOnce();
  expect(effects.stopDrop).toHaveBeenCalledOnce();
  expect(impact.mock.calls[0]![0].target).toEqual(target);
  expect(effects.impact).toHaveBeenCalledWith(target.x, target.y);
  expect(effects.sound).toHaveBeenCalledOnce();
  expect(f.shake).toHaveBeenCalledOnce();
  expect(bomb.visible).toBe(false);
  expect(plane.destroyed).toBe(false);
  expect(f.view.isPlaying).toBe(true);
  expect(f.view.debugState.stage).toBe('holding');
  expect(f.timers[0]!.duration).toBe(GAME_CONFIG.items.airstrikeImpactHoldMs);
  f.timers[0]!.callback();
  f.timers[0]!.callback();
  expect(complete).toHaveBeenCalledOnce();
  expect(effects.stopEngine).toHaveBeenCalledOnce();
  expect(f.view.isPlaying).toBe(false);
  expect(f.view.followTarget).toBeNull();
  expect(f.sprites.every(sprite => sprite.destroyed)).toBe(true);
});

it.each(['flying', 'dropping', 'holding'] as const)('cancels %s without allowing stale callbacks to advance the scene', (stage) => {
  const f = fixture(), impact = vi.fn(), complete = vi.fn();
  f.view.play(context(), impact, complete);
  if (stage !== 'flying') f.finishTween(0);
  if (stage === 'holding') f.finishTween(2);
  impact.mockClear();
  const oldTweens = [...f.tweens], oldTimers = [...f.timers];
  f.view.cancel();
  expect(effects.stopEngine).toHaveBeenCalledOnce();
  if (stage !== 'flying') expect(effects.stopDrop).toHaveBeenCalledOnce();
  oldTweens.forEach(tween => { expect(tween.remove).toHaveBeenCalledOnce(); tween.config.onComplete?.(); });
  oldTimers.forEach(timer => { expect(timer.remove).toHaveBeenCalledWith(false); timer.callback(); });
  expect(impact).not.toHaveBeenCalled();
  expect(complete).not.toHaveBeenCalled();
  expect(f.view.debugState).toMatchObject({ stage: 'idle', itemId: null, plane: null, bomb: null });
  expect(f.sprites.every(sprite => sprite.destroyed)).toBe(true);
});

it('invalidates a previous replay and safely supports cancellation inside the authority callback', () => {
  const f = fixture(), oldImpact = vi.fn(), oldComplete = vi.fn(), newComplete = vi.fn();
  f.view.play(context(), oldImpact, oldComplete);
  f.finishTween(0);
  const oldDrop = f.tweens[2]!.config.onComplete;
  f.view.play(context('P2'), () => f.view.destroy(), newComplete);
  oldDrop?.();
  expect(oldImpact).not.toHaveBeenCalled();
  expect(f.view.debugState.ownerId).toBe('P2');
  f.finishTween(3);
  f.finishTween(5);
  expect(f.view.isPlaying).toBe(false);
  expect(f.timers).toHaveLength(0);
  expect(oldComplete).not.toHaveBeenCalled();
  expect(newComplete).not.toHaveBeenCalled();
});
