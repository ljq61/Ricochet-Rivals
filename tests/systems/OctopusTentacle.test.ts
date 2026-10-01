import { describe, expect, it, vi } from 'vitest';
import type Phaser from 'phaser';
import { GAME_CONFIG } from '../../src/game/config/GameConfig';
import { createInitialGameState, TurnPhase } from '../../src/game/state/GameState';
import { OctopusTentacle } from '../../src/game/systems/OctopusTentacle';

vi.mock('phaser', () => ({ default: { Math: { Clamp: (v: number, min: number, max: number) =>
  Math.min(max, Math.max(min, v)) } } }));

/** A small rendering adapter: visual drawing calls are inert, lifetime is observable. */
function fakeObject() {
  const object = { name: '', destroyed: false, destroy: vi.fn(() => { object.destroyed = true; }) };
  const methods = new Map<string, unknown>();
  const proxy = new Proxy(object, {
    get(target, key) {
      if (key in target) return Reflect.get(target, key);
      if (typeof key !== 'string') return undefined;
      if (!methods.has(key)) methods.set(key, vi.fn((...args: unknown[]) => {
        if (key === 'setName') target.name = String(args[0]);
        return proxy;
      }));
      return methods.get(key);
    },
  });
  return proxy;
}

/** Deterministic linear tween clock; no browser or Phaser-global DOM is required. */
function fixture() {
  const objects: ReturnType<typeof fakeObject>[] = [];
  const bodies = new Set<object>();
  type TweenConfig = {
    targets: Record<string, unknown> | Record<string, unknown>[];
    duration?: number;
    onUpdate?: () => void;
    onComplete?: () => void;
    [key: string]: unknown;
  };
  const tweens: { config: TweenConfig; elapsed: number; stopped: boolean;
    props: { key: string; from: number; to: number }[]; stop: () => void }[] = [];
  const scene = {
    add: {
      graphics: () => { const obj = fakeObject(); objects.push(obj); return obj; },
      text: () => { const obj = fakeObject(); objects.push(obj); return obj; },
    },
    textures: { exists: () => false },
    matter: {
      add: { rectangle: vi.fn(() => { const body = {}; bodies.add(body); return body; }) },
      world: { remove: vi.fn((body: object) => bodies.delete(body)) } as
        { remove: ReturnType<typeof vi.fn> } | null,
    },
    tweens: {
      add: vi.fn((config: TweenConfig) => {
        const target = Array.isArray(config.targets) ? null : config.targets;
        const props = target === null ? [] : Object.entries(config)
          .filter(([key, value]) => typeof value === 'number' && typeof target[key] === 'number')
          .map(([key, value]) => ({ key, from: target[key] as number, to: value as number }));
        const tween = { config, elapsed: 0, stopped: false, props,
          stop: () => { tween.stopped = true; } };
        tweens.push(tween);
        return tween;
      }),
      killTweensOf: vi.fn((object: object) => {
        for (const tween of tweens) {
          const targets = Array.isArray(tween.config.targets) ? tween.config.targets : [tween.config.targets];
          if (targets.includes(object as Record<string, unknown>)) tween.stop();
        }
      }),
    },
  };
  const tick = (ms: number) => {
    for (const tween of [...tweens]) {
      if (tween.stopped || tween.props.length === 0) continue;
      tween.elapsed += ms;
      const q = Math.min(1, tween.elapsed / (tween.config.duration ?? 1));
      const target = tween.config.targets as Record<string, unknown>;
      for (const prop of tween.props) target[prop.key] = prop.from + (prop.to - prop.from) * q;
      tween.config.onUpdate?.();
      if (q === 1 && !tween.stopped) {
        tween.stopped = true;
        tween.config.onComplete?.();
      }
    }
  };
  const hit = vi.fn(), focus = vi.fn();
  const tentacle = new OctopusTentacle(scene as unknown as Phaser.Scene, hit, focus);
  return { scene, tentacle, hit, focus, tick, objects, bodies };
}

function activeState() {
  const state = createInitialGameState({ matchId: 'tentacle-render', seed: 1 });
  state.turnId = 6;
  state.phase = TurnPhase.RESOLVE;
  state.octopus = { hp: 10, spawnTurnId: 1, lastResolvedTurnId: 6,
    lastAttackTurnId: null, lastAttackTarget: null };
  return state;
}

describe('OctopusTentacle lifecycle and laser presentation', () => {
  it('shutdown after Matter clears its world cancels FX and resolves pending work without a ghost hit', async () => {
    const { scene, tentacle, hit, tick, objects } = fixture();
    const state = activeState();
    tentacle.restore(state);
    state.octopus.lastAttackTurnId = 6;
    state.octopus.lastAttackTarget = 'P2';
    tentacle.refresh(state);
    const idle = tentacle.whenIdle();
    expect(tentacle.isAttacking).toBe(true);
    scene.matter.world = null;
    expect(() => tentacle.destroy()).not.toThrow();
    await idle;
    tick(5000);
    expect(hit).not.toHaveBeenCalled();
    expect(tentacle.isActive).toBe(false);
    expect(tentacle.attackPhase).toBe('idle');
    expect(objects.every((obj) => obj.destroyed)).toBe(true);
    expect(() => tentacle.destroy()).not.toThrow();
  });

  it('restored attack history is considered handled and never replays an old laser', () => {
    const { tentacle, hit, focus, tick, bodies } = fixture();
    const state = activeState();
    state.octopus.lastAttackTurnId = 6;
    state.octopus.lastAttackTarget = 'P1';
    tentacle.restore(state);
    expect(bodies.size).toBe(1);
    for (let frame = 0; frame < 3; frame++) tentacle.refresh(state);
    tick(5000);
    expect(tentacle.hasPendingLaserHit(state)).toBe(false);
    expect(tentacle.attackPhase).toBe('idle');
    expect(focus).not.toHaveBeenCalled();
    expect(hit).not.toHaveBeenCalled();
  });

  it('early authoritative death during PROJECTILE preserves the old collider until RESOLVE', () => {
    const { scene, tentacle, bodies } = fixture();
    const state = activeState();
    tentacle.restore(state);
    state.phase = TurnPhase.PROJECTILE;
    state.octopus.hp = 0;
    tentacle.refresh(state);
    expect(tentacle.isActive).toBe(true);
    expect(bodies.size).toBe(1);
    expect(scene.matter.world?.remove).not.toHaveBeenCalled();
    state.phase = TurnPhase.RESOLVE;
    tentacle.refresh(state);
    expect(tentacle.isActive).toBe(false);
    expect(bodies.size).toBe(0);
    expect(scene.matter.world?.remove).toHaveBeenCalledTimes(1);
    tentacle.refresh(state);
    expect(scene.matter.world?.remove).toHaveBeenCalledTimes(1);
  });

  it('an unseen laser charges for 500 ms, sweeps for 600 ms, hits at midpoint once, and deduplicates refreshes', async () => {
    const { tentacle, hit, focus, tick } = fixture();
    const state = activeState();
    state.octopus.lastAttackTurnId = 6;
    state.octopus.lastAttackTarget = 'P2';
    tentacle.refresh(state);
    const idle = tentacle.whenIdle();
    expect(tentacle.attackPhase).toBe('charging');
    expect(tentacle.hasPendingLaserHit(state)).toBe(true);
    expect(focus).toHaveBeenCalledTimes(1);
    tick(GAME_CONFIG.octopus.chargeDurationMs - 1);
    expect(tentacle.attackPhase).toBe('charging');
    expect(hit).not.toHaveBeenCalled();
    tentacle.refresh(state);
    tick(1);
    expect(tentacle.attackPhase).toBe('sweeping');
    expect(focus).toHaveBeenCalledTimes(2);
    tick(GAME_CONFIG.octopus.sweepDurationMs / 2 - 1);
    expect(hit).not.toHaveBeenCalled();
    tick(1);
    expect(hit).toHaveBeenCalledExactlyOnceWith('P2');
    expect(tentacle.hasPendingLaserHit(state)).toBe(false);
    tentacle.refresh(state);
    tick(GAME_CONFIG.octopus.sweepDurationMs / 2 - 1);
    expect(tentacle.attackPhase).toBe('sweeping');
    tick(1);
    await idle;
    expect(tentacle.attackPhase).toBe('idle');
    tentacle.refresh(state);
    tick(5000);
    expect(hit).toHaveBeenCalledTimes(1);
    expect(focus).toHaveBeenCalledTimes(2);
  });

  it('snapshot restore cancels pending presentation and permits only a new turn to attack', async () => {
    const { tentacle, hit, tick } = fixture();
    const state = activeState();
    state.octopus.lastAttackTurnId = 6;
    state.octopus.lastAttackTarget = 'P2';
    tentacle.refresh(state);
    const oldIdle = tentacle.whenIdle();
    tick(250);
    tentacle.restore(structuredClone(state));
    await oldIdle;
    tick(5000);
    expect(hit).not.toHaveBeenCalled();
    expect(tentacle.isAttacking).toBe(false);
    tentacle.refresh(state);
    expect(tentacle.isAttacking).toBe(false);
    state.turnId = 7;
    state.octopus.lastResolvedTurnId = 7;
    state.octopus.lastAttackTurnId = 7;
    state.octopus.lastAttackTarget = 'P1';
    tentacle.refresh(state);
    tick(GAME_CONFIG.octopus.chargeDurationMs + GAME_CONFIG.octopus.sweepDurationMs);
    await tentacle.whenIdle();
    expect(hit).toHaveBeenCalledExactlyOnceWith('P1');
  });
});
