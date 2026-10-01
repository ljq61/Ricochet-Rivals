import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AIController, type AIFirePlan } from '../../src/game/ai/AIController';
import { velocityFromAngleSpeed } from '../../src/game/ai/TrajectorySolver';
import { GAME_CONFIG, type AIDifficulty } from '../../src/game/config/GameConfig';
import { COLLISION_CATEGORY as CATEGORY } from '../../src/game/physics/collisionCategories';
import { getLaunchOrigin } from '../../src/game/physics/aimMath';
import { isProjectileArmed, isProjectileOutOfBounds } from '../../src/game/physics/projectileRules';
import { SeededRandom } from '../../src/game/random/SeededRandom';
import { createInitialGameState, TurnPhase, type GameState } from '../../src/game/state/GameState';
import { isOctopusActive } from '../../src/game/state/OctopusState';
import { ConcreteDamageSystem } from '../../src/game/systems/DamageSystem';

// Load the exact Matter implementation bundled with Phaser, without loading its DOM renderer.
const require = createRequire(import.meta.url);
const matterRoot = join(dirname(require.resolve('phaser/package.json')), 'src/physics/matter-js/lib');
const Engine = require(join(matterRoot, 'core/Engine.js')) as typeof MatterJS.Engine;
const Bodies = require(join(matterRoot, 'factory/Bodies.js')) as typeof MatterJS.Bodies;
const Body = require(join(matterRoot, 'body/Body.js')) as typeof MatterJS.Body;
const Composite = require(join(matterRoot, 'body/Composite.js')) as typeof MatterJS.Composite;
const Events = require(join(matterRoot, 'core/Events.js')) as typeof MatterJS.Events;

/** Reproduce runtime bodies, 60Hz integration, fuse, collision event and damage calculation. */
function simulateDamage(state: GameState, plan: AIFirePlan): number {
  const { world, player, projectile, physics, octopus } = GAME_CONFIG;
  const me = state.players[state.currentPlayerId];
  const enemyId = me.id === 'P1' ? 'P2' : 'P1';
  const origin = getLaunchOrigin(me);
  const engine = Engine.create() as MatterJS.Engine & {
    gravity: { x: number; y: number }; world: MatterJS.CompositeType;
  };
  engine.gravity.x = physics.gravityX / 1000;
  engine.gravity.y = physics.gravityY / 1000;
  const staticBody = (x: number, y: number, w: number, h: number, category: number) =>
    Bodies.rectangle(x, y, w, h, {
      isStatic: true, collisionFilter: { category, mask: CATEGORY.PROJECTILE, group: 0 },
    });
  const groundHeight = world.height - world.groundTopY;
  const targets = [player.leftBounds, player.rightBounds].map((bounds) =>
    staticBody((bounds.minX + bounds.maxX) / 2, world.groundTopY + groundHeight / 2,
      bounds.maxX - bounds.minX + 2 * world.platformOverhang, groundHeight, CATEGORY.GROUND));
  for (const p of Object.values(state.players)) {
    targets.push(staticBody(p.x, p.y - player.collision.height / 2,
      player.collision.width, player.collision.height, CATEGORY.PLAYER));
  }
  if (isOctopusActive(state.octopus)) {
    const height = octopus.height * octopus.collisionHeightRatio;
    targets.push(staticBody(octopus.x, octopus.baseY - height / 2,
      octopus.width * octopus.collisionWidthRatio, height, CATEGORY.OBSTACLE));
  }
  const shell = Bodies.circle(origin.x, origin.y, projectile.radius, {
    frictionAir: 0, friction: 0, restitution: 0,
    collisionFilter: { category: CATEGORY.PROJECTILE, mask: CATEGORY.GROUND, group: 0 },
  });
  const velocity = velocityFromAngleSpeed(plan.angleDeg, plan.speed);
  Body.setVelocity(shell, { x: velocity.velocityX / 60, y: velocity.velocityY / 60 });
  for (const body of [...targets, shell]) Composite.add(engine.world, body);
  let impact: { x: number; y: number } | null = null;
  Events.on(engine, 'collisionStart', (event) => {
    if (event.pairs.some((pair) => pair.bodyA === shell || pair.bodyB === shell)) {
      impact = { ...shell.position };
    }
  });
  for (let frame = 0; frame < physics.projectileLifetimeMs * 60 / 1000; frame++) {
    Engine.update(engine, 1000 / 60);
    if (impact || isProjectileOutOfBounds(shell.position, world.width, world.height)) break;
    if (isProjectileArmed(shell.position, origin.x, origin.y, projectile.playerCollisionArmDistance)) {
      shell.collisionFilter.mask = CATEGORY.GROUND | CATEGORY.PLAYER | CATEGORY.OBSTACLE;
    }
  }
  Engine.clear(engine);
  Composite.clear(engine.world, false);
  const collisionPoint = impact as { x: number; y: number } | null;
  if (!collisionPoint) return 0;
  const result = new ConcreteDamageSystem().calculate(state, {
    sourcePlayerId: me.id, weaponId: me.weaponId, turnId: state.turnId,
    ...collisionPoint, radius: GAME_CONFIG.explosion.radius,
  });
  return result.players.find((p) => p.playerId === enemyId)!.damage;
}

function makeState(leftX: number, rightX: number, side: 'P1' | 'P2', hazard: boolean): GameState {
  const state = createInitialGameState({ matchId: 'accuracy', seed: 123, firstPlayer: side });
  state.phase = TurnPhase.ACTION;
  state.players.P1.x = leftX;
  state.players.P2.x = rightX;
  if (hazard) state.octopus.spawnTurnId = 1;
  return state;
}

function measure(state: GameState, difficulty: AIDifficulty) {
  let hits = 0;
  let damage = 0;
  for (let seed = 1; seed <= 120; seed++) {
    const controller = new AIController(difficulty);
    const snapshot = structuredClone(state);
    const decision = controller.decide(state, new SeededRandom(seed * 7919));
    expect(state).toEqual(snapshot);
    expect(decision).toEqual(controller.decide(state, new SeededRandom(seed * 7919)));
    expect(decision.moveTargetX).toBeNull();
    expect(decision.fire).not.toBeNull();
    expect(decision.fire!.speed).toBeGreaterThanOrEqual(GAME_CONFIG.aiming.minLaunchSpeed);
    expect(decision.fire!.speed).toBeLessThanOrEqual(GAME_CONFIG.aiming.maxLaunchSpeed);
    const dealt = simulateDamage(state, decision.fire!);
    hits += Number(dealt > 0);
    damage += dealt;
  }
  return { hitRate: hits / 120, damagePerShot: damage / 120 };
}

describe('AI difficulty with actual Matter collision and damage', () => {
  for (const side of ['P1', 'P2'] as const) {
    for (const [leftX, rightX] of [[450, 4550], [850, 4150], [100, 4900]]) {
      it(`${side}: normal/hard materially outperform easy at ${leftX} → ${rightX}`, () => {
        const state = makeState(leftX!, rightX!, side, false);
        const easy = measure(state, 'easy');
        const normal = measure(state, 'normal');
        const hard = measure(state, 'hard');
        if (process.env.AI_ACCURACY_REPORT) console.log({ side, leftX, rightX, easy, normal, hard });
        expect(normal.hitRate).toBeGreaterThan(0.55);
        expect(normal.hitRate).toBeLessThan(0.95);
        expect(normal.hitRate - easy.hitRate).toBeGreaterThan(0.3);
        expect(hard.hitRate).toBeGreaterThan(0.95);
        expect(hard.damagePerShot - normal.damagePerShot).toBeGreaterThan(0.25);
      });
    }
    it(`${side}: hard remains effective when the central octopus emerges`, () => {
      const result = measure(makeState(850, 4150, side, true), 'hard');
      expect(result.hitRate).toBeGreaterThan(0.95);
    });
  }
});
