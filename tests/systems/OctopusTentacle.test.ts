import { describe, expect, it, vi } from 'vitest';
import type Phaser from 'phaser';
import { GAME_CONFIG } from '../../src/game/config/GameConfig';
import { SFX } from '../../src/game/audio/SfxBus';
import { createInitialGameState, TurnPhase } from '../../src/game/state/GameState';
import { OctopusTentacle } from '../../src/game/systems/OctopusTentacle';

vi.mock('phaser', () => ({ default: { Math: { Clamp: (v: number, min: number, max: number) =>
  Math.min(max, Math.max(min, v)) } } }));

/** A small rendering adapter: visual drawing calls are inert, lifetime is observable. */
function fakeObject() {
  const object = { name: '', destroyed: false, x: 0, y: 0, rotation: 0, alpha: 1,
    frame: { width: 512, height: 512 }, cropCalls: [] as unknown[][],
    roundedRectCalls: [] as number[][],
    destroy: vi.fn(() => { object.destroyed = true; }) };
  const methods = new Map<string, unknown>();
  const proxy = new Proxy(object, {
    get(target, key) {
      if (key in target) return Reflect.get(target, key);
      if (typeof key !== 'string') return undefined;
      if (!methods.has(key)) methods.set(key, vi.fn((...args: unknown[]) => {
        if (key === 'setName') target.name = String(args[0]);
        if (key === 'setAlpha') target.alpha = Number(args[0]);
        if (key === 'setCrop') target.cropCalls.push(args);
        if (key === 'fillRoundedRect') target.roundedRectCalls.push(args as number[]);
        return proxy;
      }));
      return methods.get(key);
    },
  });
  return proxy;
}

/** Deterministic linear tween clock; no browser or Phaser-global DOM is required. */
function fixture(withSprite = false) {
  const objects: ReturnType<typeof fakeObject>[] = [];
  const bodies = new Set<object>();
  let now = 0;
  const timers: { due: number; callback: () => void; canceled: boolean }[] = [];
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
      sprite: (x: number, y: number) => {
        const obj = fakeObject(); obj.x = x; obj.y = y; objects.push(obj); return obj;
      },
      graphics: () => { const obj = fakeObject(); objects.push(obj); return obj; },
      text: () => { const obj = fakeObject(); objects.push(obj); return obj; },
    },
    textures: { exists: () => withSprite },
    anims: { exists: () => true },
    // SfxBus 素材门禁放行；play 出口即断言目标（音效键名序列）
    cache: { audio: { exists: () => true } },
    sound: { play: vi.fn() },
    time: {
      delayedCall: vi.fn((delay: number, callback: () => void) => {
        const timer = { due: now + delay, callback, canceled: false };
        timers.push(timer);
        return { remove: () => { timer.canceled = true; }, destroy: () => { timer.canceled = true; } };
      }),
    },
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
    now += ms;
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
    for (const timer of timers) {
      if (!timer.canceled && timer.due <= now) {
        timer.canceled = true;
        timer.callback();
      }
    }
  };
  const hit = vi.fn(), focus = vi.fn(), complete = vi.fn();
  const tentacle = new OctopusTentacle(scene as unknown as Phaser.Scene, hit, focus, complete);
  return { scene, tentacle, hit, focus, complete, tick, objects, bodies };
}

function activeState() {
  const state = createInitialGameState({ matchId: 'tentacle-render', seed: 1 });
  state.turnId = 6;
  state.phase = TurnPhase.RESOLVE;
  state.octopus = { hp: GAME_CONFIG.octopus.maxHp, spawnTurnId: 1, lastResolvedTurnId: 6,
    lastAttackTurnId: null, lastAttackTarget: null };
  return state;
}

describe('OctopusTentacle lifecycle and laser presentation', () => {
  it('shutdown after Matter clears its world cancels FX and resolves pending work without a ghost hit', async () => {
    const { scene, tentacle, hit, complete, tick, objects } = fixture();
    const state = activeState();
    tentacle.restore(state);
    complete.mockClear(); // restore also releases any prior camera presentation
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
    expect(complete).toHaveBeenCalledTimes(1);
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
    expect(scene.sound.play).not.toHaveBeenCalled();
    state.phase = TurnPhase.RESOLVE;
    tentacle.refresh(state);
    expect(tentacle.isActive).toBe(false);
    expect(bodies.size).toBe(0);
    expect(scene.matter.world?.remove).toHaveBeenCalledTimes(1);
    tentacle.refresh(state);
    expect(scene.matter.world?.remove).toHaveBeenCalledTimes(1);
    expect(scene.sound.play).toHaveBeenCalledTimes(1);
  });

  it('keeps every HP segment inside the original health bar width', () => {
    const { tentacle, objects } = fixture();
    tentacle.restore(activeState());
    const rects = objects.find((obj) => obj.name === 'octopus-health')!.roundedRectCalls.slice(1);
    expect(rects).toHaveLength(GAME_CONFIG.octopus.maxHp);
    expect(rects.every(([x, , width]) => x! >= -109 && width! > 0 && x! + width! <= 109.001)).toBe(true);
  });

  it.each([false, true])('defeat dissolves once and holds the turn until all visuals finish (sprite: %s)', async (withSprite) => {
    const { scene, tentacle, tick, objects, bodies } = fixture(withSprite);
    const state = activeState();
    tentacle.restore(state);
    tick(1500); // finish emergence before defeat
    state.octopus.hp = 0;
    tentacle.refresh(state);
    let idle = false;
    const wait = tentacle.whenIdle().then(() => { idle = true; });
    expect(tentacle.isActive).toBe(false);
    expect(tentacle.isAttacking).toBe(true);
    expect(tentacle.attackPhase).toBe('dissolving');
    expect(bodies.size).toBe(0);
    expect(objects.some((obj) => obj.name === 'octopus-dissolve' && !obj.destroyed)).toBe(true);
    expect(scene.sound.play).toHaveBeenCalledExactlyOnceWith(SFX.octopusDeath, expect.any(Object));
    for (let frame = 0; frame < 5; frame++) tentacle.refresh(state);
    tick(GAME_CONFIG.octopus.deathDurationMs / 2);
    await Promise.resolve();
    expect(idle).toBe(false);
    expect(tentacle.deathProgress).toBeCloseTo(0.5);
    if (withSprite) {
      const sprite = objects.find((obj) => obj.name === 'octopus-visual')!;
      expect(sprite.cropCalls.at(-1)).toEqual([0, 256, 512, 256]);
    }
    tick(GAME_CONFIG.octopus.deathDurationMs / 2 - 1);
    expect(tentacle.isAttacking).toBe(true);
    tick(1);
    await wait;
    expect(idle).toBe(true);
    expect(tentacle.isAttacking).toBe(false);
    expect(tentacle.deathProgress).toBe(1);
    expect(objects.every((obj) => obj.destroyed)).toBe(true);
    tentacle.refresh(state);
    tick(5000);
    expect(scene.sound.play).toHaveBeenCalledTimes(1);
    expect(bodies.size).toBe(0);
  });

  it.each(['dead', 'alive', 'destroy'] as const)('cancels defeat on %s recovery/cleanup without replay or ghost visuals', async (kind) => {
    const { scene, tentacle, tick, objects, bodies } = fixture(true);
    const state = activeState();
    tentacle.restore(state);
    tick(1500);
    state.octopus.hp = 0;
    tentacle.refresh(state);
    const oldIdle = tentacle.whenIdle();
    tick(200);
    const oldObjects = [...objects];
    if (kind === 'destroy') {
      scene.matter.world = null; // Phaser may have already shut down its Matter world.
      tentacle.destroy();
    }
    else {
      if (kind === 'alive') state.octopus.hp = GAME_CONFIG.octopus.maxHp;
      tentacle.restore(state);
    }
    await oldIdle;
    tick(5000);
    expect(oldObjects.every((obj) => obj.destroyed)).toBe(true);
    expect(tentacle.isAttacking).toBe(false);
    expect(tentacle.deathProgress).toBe(0);
    expect(tentacle.isActive).toBe(kind === 'alive');
    expect(bodies.size).toBe(kind === 'alive' ? 1 : 0);
    expect(scene.sound.play).toHaveBeenCalledTimes(1);
    if (kind === 'dead') {
      tentacle.refresh(state);
      expect(tentacle.hasPendingLaserHit(state)).toBe(false);
      expect(scene.sound.play).toHaveBeenCalledTimes(1);
    }
  });

  it.each([false, true])('restoring an already defeated snapshot stays silent with a prior visual: %s', async (priorVisual) => {
    const { scene, tentacle, tick, objects, hit } = fixture();
    const state = activeState();
    if (priorVisual) tentacle.restore(state);
    state.octopus.hp = 0;
    state.octopus.lastAttackTurnId = 6;
    state.octopus.lastAttackTarget = 'P2';
    tentacle.restore(state);
    tentacle.refresh(state);
    await tentacle.whenIdle();
    tick(5000);
    expect(tentacle.isActive).toBe(false);
    expect(tentacle.hasPendingLaserHit(state)).toBe(false);
    expect(objects.every((obj) => obj.destroyed)).toBe(true);
    expect(scene.sound.play).not.toHaveBeenCalled();
    expect(hit).not.toHaveBeenCalled();
  });

  it.each(['P1', 'P2'] as const)('focuses before charging, holds, then continuously sweeps to %s and hits only at the endpoint', async (target) => {
    const { scene, tentacle, hit, focus, complete, tick } = fixture();
    const state = activeState();
    state.octopus.lastAttackTurnId = 6;
    state.octopus.lastAttackTarget = target;
    tentacle.refresh(state);
    const idle = tentacle.whenIdle();
    expect(tentacle.attackPhase).toBe('focusing');
    expect(tentacle.hasPendingLaserHit(state)).toBe(true);
    expect(focus).toHaveBeenCalledTimes(1);
    expect(focus.mock.calls[0]?.[2]).toBe(450);
    expect(scene.sound.play).not.toHaveBeenCalled();
    tick(449);
    expect(tentacle.attackPhase).toBe('focusing');
    expect(tentacle.laserVisual?.end).toBeNull();
    expect(hit).not.toHaveBeenCalled();
    tentacle.refresh(state);
    tick(1);
    expect(tentacle.attackPhase).toBe('charging');
    // 粒子聚集开始 → 蓄力音效（focusing 段保持安静）
    expect(scene.sound.play.mock.calls.map((call) => call[0])).toEqual([SFX.laserCharge]);
    tick(499);
    expect(tentacle.attackPhase).toBe('charging');
    expect(tentacle.laserVisual?.end).toBeNull();
    tick(1);
    expect(tentacle.attackPhase).toBe('holding');
    tick(199);
    expect(tentacle.attackPhase).toBe('holding');
    expect(tentacle.laserVisual?.end).toBeNull();
    expect(hit).not.toHaveBeenCalled();
    expect(focus).toHaveBeenCalledTimes(1);
    tick(1);
    expect(tentacle.attackPhase).toBe('sweeping');
    // 光束出射 → 扫射音效追加（蓄力不重复触发）
    expect(scene.sound.play.mock.calls.map((call) => call[0]))
      .toEqual([SFX.laserCharge, SFX.laserSweep]);
    const start = structuredClone(tentacle.laserVisual!);
    expect(start.end).not.toBeNull();
    expect(start.progress).toBe(0);
    expect(start.target).toBe(target);
    const direction = target === 'P1' ? -1 : 1;
    const startAngle = Math.atan2(start.end!.x - start.tip.x, start.end!.y - start.tip.y);
    expect(startAngle).toBeCloseTo(direction * Math.PI / 6, 5);
    expect(start.end!.y).toBe(GAME_CONFIG.world.groundTopY);
    let previous = start;
    for (let frame = 0; frame < 7; frame++) {
      tick(100);
      const visual = structuredClone(tentacle.laserVisual!);
      expect((visual.end!.x - previous.end!.x) * direction).toBeGreaterThan(0);
      expect(visual.end!.y).toBeCloseTo(start.end!.y, 5);
      expect(visual.progress).toBeGreaterThan(previous.progress);
      expect(visual.tip).toEqual(start.tip);
      const camera = focus.mock.calls.at(-1)!;
      expect(camera[0]).toBeCloseTo(GAME_CONFIG.octopus.x +
        (visual.end!.x - GAME_CONFIG.octopus.x) * visual.progress, 5);
      expect(camera[2]).toBe(0);
      expect(hit).not.toHaveBeenCalled();
      expect(tentacle.hasPendingLaserHit(state)).toBe(true);
      tentacle.refresh(state);
      previous = visual;
    }
    tick(99);
    expect(hit).not.toHaveBeenCalled();
    expect(scene.sound.play.mock.calls.map((call) => call[0]))
      .toEqual([SFX.laserCharge, SFX.laserSweep]);
    expect(tentacle.isAttacking).toBe(true);
    tick(1);
    await idle;
    expect(hit).toHaveBeenCalledExactlyOnceWith(target);
    const bounds = target === 'P1' ? GAME_CONFIG.player.leftBounds : GAME_CONFIG.player.rightBounds;
    expect(focus.mock.calls.at(-1)?.[0]).toBeCloseTo((bounds.minX + bounds.maxX) / 2, 5);
    expect(focus.mock.calls.at(-1)?.[2]).toBe(0);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(tentacle.hasPendingLaserHit(state)).toBe(false);
    expect(tentacle.attackPhase).toBe('idle');
    tentacle.refresh(state);
    tick(5000);
    expect(hit).toHaveBeenCalledTimes(1);
    // 蓄力/扫射/端点爆炸各只播一次；结束后的 refresh 不再触发音效。
    expect(scene.sound.play.mock.calls.map((call) => call[0]))
      .toEqual([SFX.laserCharge, SFX.laserSweep, SFX.explosion]);
  });

  it.each([[100, 'focusing'], [1000, 'holding'], [1500, 'sweeping']] as const)(
    'snapshot restore after %s ms cancels %s callbacks and permits only a new turn to attack', async (elapsed, phase) => {
    const { scene, tentacle, hit, complete, tick } = fixture();
    const state = activeState();
    state.octopus.lastAttackTurnId = 6;
    state.octopus.lastAttackTarget = 'P2';
    tentacle.refresh(state);
    const oldIdle = tentacle.whenIdle();
    tick(elapsed);
    expect(tentacle.attackPhase).toBe(phase);
    tentacle.restore(structuredClone(state));
    await oldIdle;
    tick(5000);
    expect(hit).not.toHaveBeenCalled();
    expect(scene.sound.play.mock.calls.map((call) => call[0])).not.toContain(SFX.explosion);
    expect(tentacle.isAttacking).toBe(false);
    expect(complete).toHaveBeenCalledTimes(1);
    tentacle.refresh(state);
    expect(tentacle.isAttacking).toBe(false);
    state.turnId = 7;
    state.octopus.lastResolvedTurnId = 7;
    state.octopus.lastAttackTurnId = 7;
    state.octopus.lastAttackTarget = 'P1';
    tentacle.refresh(state);
    tick(450 + 500 + 200 + 800);
    await tentacle.whenIdle();
    expect(hit).toHaveBeenCalledExactlyOnceWith('P1');
    expect(complete).toHaveBeenCalledTimes(2);
    expect(scene.sound.play.mock.calls.filter((call) => call[0] === SFX.explosion)).toHaveLength(1);
  });

  it('renders the final beam for one frame, while recovery can immediately remove that lingering FX', async () => {
    const { tentacle, hit, complete, tick, objects } = fixture();
    const state = activeState();
    state.octopus.lastAttackTurnId = 6;
    state.octopus.lastAttackTarget = 'P2';
    tentacle.refresh(state);
    tick(450 + 500 + 200 + 800);
    await tentacle.whenIdle();
    const fx = objects.find((obj) => obj.name === 'octopus-laser')!;
    expect(tentacle.attackPhase).toBe('idle');
    expect(tentacle.laserVisual.progress).toBe(1);
    expect(tentacle.laserVisual.end?.x).toBeCloseTo(4525, 5);
    expect(tentacle.laserVisual.end?.y).toBe(960);
    expect(fx.destroyed).toBe(false);
    expect(hit).toHaveBeenCalledExactlyOnceWith('P2');
    expect(complete).toHaveBeenCalledTimes(1);
    tick(10);
    expect(fx.destroyed).toBe(false);
    tentacle.restore(structuredClone(state));
    expect(fx.destroyed).toBe(true);
    tick(50);
    expect(fx.destroy).toHaveBeenCalledTimes(1);
    expect(hit).toHaveBeenCalledTimes(1);
  });
});
