import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GAME_CONFIG } from '../../src/game/config/GameConfig';
import { createInitialGameState } from '../../src/game/state/GameState';
import { createFlightState, simulationFrameBudget, stepFlight, type FlightState } from '../../src/game/physics/flightSimulation';
import { sweptCircleRectTime } from '../../src/game/physics/itemGeometry';
import type { FireCommand } from '../../src/game/commands/GameCommand';
import type { ShotContext } from '../../src/game/state/ItemState';

const dt = GAME_CONFIG.items.simulationStepMs;
const initial = () => createInitialGameState({ matchId: 'flight', seed: 1 });
const command = (overrides: Partial<FireCommand> = {}): FireCommand => ({ type: 'FIRE', playerId: 'P1',
  turnId: 1, weaponId: 'normal', startX: 450, startY: 896, velocityX: 1400, velocityY: -1400,
  seed: 1, ...overrides });
const homing = (): ShotContext => ({ ownerId: 'P1', turnId: 1, itemType: 'homing', homingActivated: false });

const require = createRequire(import.meta.url);
const root = join(dirname(require.resolve('phaser/package.json')), 'src/physics/matter-js/lib');
const Engine = require(join(root, 'core/Engine.js')) as typeof MatterJS.Engine;
const Bodies = require(join(root, 'factory/Bodies.js')) as typeof MatterJS.Bodies;
const Body = require(join(root, 'body/Body.js')) as typeof MatterJS.Body;
const Composite = require(join(root, 'body/Composite.js')) as typeof MatterJS.Composite;

describe('production fixed-step flight', () => {
  it('matches actual bundled Matter free flight position and velocity to 1e-7', () => {
    for (const [vx, vy] of [[1400, -1400], [-1500, -900], [0, -2000]]) {
      const engine = Engine.create();
      (engine as MatterJS.Engine & { gravity: { x: number; y: number } }).gravity.y = 1;
      const body = Bodies.circle(2500, -3000, 16, { frictionAir: 0 });
      Body.setVelocity(body, { x: vx! / 60, y: vy! / 60 });
      Composite.add(engine.world as unknown as MatterJS.CompositeType, body);
      const flight = createFlightState(command({ startX: 2500, startY: -3000, velocityX: vx!, velocityY: vy! }));
      for (let frame = 0; frame < 60; frame++) {
        Engine.update(engine, dt);
        expect(stepFlight(flight, initial(), dt).termination).toBeNull();
        expect(flight.x).toBeCloseTo(body.position.x, 7);
        expect(flight.y).toBeCloseTo(body.position.y, 7);
        expect(flight.velocityX).toBeCloseTo(body.velocity.x * 60, 7);
        expect(flight.velocityY).toBeCloseTo(body.velocity.y * 60, 7);
      }
    }
  });

  it('30/60/10/5 FPS produce the same lock point, trajectory, terminal collision and age', () => {
    const run = (frameMs: number) => {
      const state = initial();
      const flight = createFlightState(command());
      const shot = homing();
      let accumulator = 0;
      let lock: { x: number; y: number } | null = null;
      for (let frame = 0; frame < 500; frame++) {
        const budget = simulationFrameBudget(accumulator, frameMs);
        accumulator = budget.remainingMs;
        for (let step = 0; step < budget.steps; step++) {
          const update = stepFlight(flight, state, dt, shot);
          if (update.homingActivated) lock = { x: flight.x, y: flight.y };
          if (update.termination) return { flight, shot, lock, termination: update.termination };
        }
      }
      throw new Error('did not terminate');
    };
    const expected = run(dt);
    expect(expected.lock).not.toBeNull();
    for (const frameMs of [1000 / 30, 100, 200]) expect(run(frameMs)).toEqual(expected);
    expect(expected.shot.homingTarget).toEqual({ x: 4550, y: 870 });
    expect(Math.hypot(expected.flight.velocityX, expected.flight.velocityY)).toBeCloseTo(4200, 8);
  });

  it('background gaps do not become age/lifetime fast-forward', () => {
    expect(simulationFrameBudget(0, 60_000).steps).toBe(1);
    expect(simulationFrameBudget(0, 200).steps).toBe(12);
    expect(simulationFrameBudget(0, Number.NaN).steps).toBe(0);
  });

  it('crossing .8 splits the step exactly and disables gravity afterwards', () => {
    const flight = createFlightState(command({ startX: 1000, startY: 100, velocityY: 0 }));
    flight.ageMs = 790;
    const shot = homing();
    const update = stepFlight(flight, initial(), 20, shot);
    expect(update.segments).toHaveLength(2);
    expect(update.segments[0]!.to).toEqual({ x: 1014, y: 100.1 });
    expect(shot.homingActivated).toBe(true);
    const velocity = [flight.velocityX, flight.velocityY];
    stepFlight(flight, initial(), dt, shot);
    expect([flight.velocityX, flight.velocityY]).toEqual(velocity);
    expect(flight.ageMs).toBeCloseTo(810 + dt);
  });

  it('a collision at the lock time wins, and an earlier collision never activates', () => {
    const state = initial();
    for (const age of [790, 780]) {
      const flight = createFlightState(command({ startX: 450, startY: 943.9, velocityX: 0, velocityY: 0 }));
      flight.ageMs = age;
      const shot = homing();
      expect(stepFlight(flight, state, 10, shot).termination).toBe('impact');
      expect(shot.homingActivated).toBe(false);
    }
  });

  it('sweeps stop at the octopus before any segment behind it can collect', () => {
    const state = initial();
    state.octopus.spawnTurnId = 1;
    const flight = createFlightState(command({ startX: 2100, startY: 500, velocityX: 2000, velocityY: 0 }));
    flight.armed = true;
    const update = stepFlight(flight, state, 250);
    expect(update.termination).toBe('impact');
    expect(flight.x).toBeCloseTo(2500 - 225 / 2 - 16);
    expect(update.segments[0]!.to.x).toBeLessThan(2400);
  });

  it('the fuse arms within a segment and stays armed on returning self-hit', () => {
    const state = initial();
    const flight = createFlightState(command({ velocityX: 1200, velocityY: -1000 }));
    stepFlight(flight, state, 200);
    expect(flight.armed).toBe(true);
    flight.x = 650; flight.y = 850; flight.velocityX = -1200; flight.velocityY = 0;
    expect(stepFlight(flight, state, 200).termination).toBe('impact');
  });

  it('8s lifetime remains unchanged by the lock, and out-of-bounds remains terminal', () => {
    const flight: FlightState = createFlightState(command({ startX: 2500, startY: -3000, velocityX: 0, velocityY: 0 }));
    flight.ageMs = 7995;
    const shot = homing();
    shot.homingActivated = true;
    expect(stepFlight(flight, initial(), dt, shot).termination).toBe('impact');
    expect(flight.ageMs).toBe(8000);
    const out = createFlightState(command({ startX: 5000, startY: 0, velocityX: 1800, velocityY: 0 }));
    expect(stepFlight(out, initial(), 100).termination).toBe('out-of-bounds');
    expect(out.x).toBe(5060);
  });
});

describe('swept circle contact', () => {
  const rect = { minX: 100, maxX: 180, minY: 100, maxY: 164 };
  it('counts the shell radius, uses the wooden body and rejects oversized corner square', () => {
    expect(sweptCircleRectTime({ x: 0, y: 84 }, { x: 200, y: 84 }, rect, 16)).toBeCloseTo(0.5);
    expect(sweptCircleRectTime({ x: 0, y: 50 }, { x: 200, y: 50 }, rect, 16)).toBeNull();
    expect(sweptCircleRectTime({ x: 84, y: 84 }, { x: 85, y: 85 }, rect, 16)).toBeNull();
  });
});
