import { GAME_CONFIG, type AIDifficulty } from '../config/GameConfig';
import { getLaunchOrigin } from '../physics/aimMath';
import { createFlightState, stepFlight } from '../physics/flightSimulation';
import { pointRectDistance, sweptCircleRectTime } from '../physics/itemGeometry';
import type { GameState } from '../state/GameState';
import type { ShotContext } from '../state/ItemState';
import { crateRect, findCrateShot } from '../systems/ItemSystem';
import { damageAtDistance } from '../systems/DamageSystem';
import type { AIDecision, AIFirePlan } from './AIController';
import { velocityFromAngleSpeed } from './TrajectorySolver';

/** Uses the production collision/lock rules, including obstacles before and after .8s. */
export function evaluateAIShot(state: GameState, plan: AIFirePlan, itemType?: ShotContext['itemType']): {
  damage: number; selfDamage: number; pickups: number;
} {
  const me = state.players[state.currentPlayerId];
  const enemy = state.players[me.id === 'P1' ? 'P2' : 'P1'];
  const origin = getLaunchOrigin(me);
  const flight = createFlightState({ type: 'FIRE', playerId: me.id, turnId: state.turnId,
    weaponId: 'normal', startX: origin.x, startY: origin.y,
    ...velocityFromAngleSpeed(plan.angleDeg, plan.speed), seed: state.seed });
  const shot: ShotContext = { ownerId: me.id, turnId: state.turnId, itemType, homingActivated: false };
  const collected = new Set<string>();
  const result = { damage: 0, selfDamage: 0, pickups: 0 };
  for (let frame = 0; frame < GAME_CONFIG.physics.projectileLifetimeMs / GAME_CONFIG.items.simulationStepMs; frame++) {
    const update = stepFlight(flight, state, GAME_CONFIG.items.simulationStepMs, shot);
    for (const segment of update.segments) for (const item of state.items) {
      if (item.active && sweptCircleRectTime(segment.from, segment.to, crateRect(item),
          GAME_CONFIG.projectile.radius) !== null) collected.add(item.id);
    }
    if (update.termination === 'impact') {
      const bounds = (p: typeof me) => ({ minX: p.x - GAME_CONFIG.player.collision.width / 2,
        maxX: p.x + GAME_CONFIG.player.collision.width / 2,
        minY: p.y - GAME_CONFIG.player.collision.height, maxY: p.y });
      result.damage = damageAtDistance(pointRectDistance(flight, bounds(enemy)), itemType);
      result.selfDamage = damageAtDistance(pointRectDistance(flight, bounds(me)), itemType);
    }
    if (update.termination !== null) break;
  }
  result.pickups = Math.min(collected.size, me.inventory.filter((item) => item === null).length);
  return result;
}

export function withAIItems(state: GameState, decision: AIDecision, difficulty: AIDifficulty, perturbCrate?: (plan: AIFirePlan) => AIFirePlan): AIDecision {
  if (!decision.fire) return decision;
  const me = state.players[state.currentPlayerId];
  if (me.itemUsedThisTurn) return decision;
  const items = me.inventory.filter((item) => item !== null);
  if (items.length === 0 && (difficulty === 'easy' || state.items.length === 0)) return decision;
  const enemy = state.players[me.id === 'P1' ? 'P2' : 'P1'];
  // A bounded public-state heuristic. No reading future RNG or modifying inventory.
  // ponytail: ranking is a one-shot utility, not an adversarial lookahead tree.
  const baseline = evaluateAIShot(state, decision.fire);
  let best = decision.fire;
  let bestEvaluation = baseline;
  let collecting = false;
  const score = (evaluation: typeof baseline) => evaluation.damage * 4 - evaluation.selfDamage * 5 + evaluation.pickups;
  for (const item of items) {
    if (item.type === 'heal' || item.type === 'airstrike') continue;
    const candidate = { ...decision.fire, itemId: item.id };
    const evaluation = evaluateAIShot(state, candidate, item.type);
    if (difficulty === 'easy' || score(evaluation) > score(bestEvaluation)) {
      best = candidate;
      bestEvaluation = evaluation;
      if (difficulty === 'easy') break;
    }
  }
  const heal = items.find((item) => item.type === 'heal');
  const lethal = difficulty !== 'easy' && bestEvaluation.damage >= enemy.hp && bestEvaluation.selfDamage < me.hp;
  if (heal && me.hp <= (difficulty === 'easy' ? 4 : 6) && !lethal) {
    return { ...decision, fire: decision.fire, healItemId: heal.id };
  }
  const airstrike = items.find(item => item.type === 'airstrike');
  if (airstrike && (!lethal || enemy.hp <= GAME_CONFIG.explosion.directDamage)) {
    return { ...decision, fire: decision.fire, airstrikeItemId: airstrike.id };
  }
  if (difficulty !== 'easy' && !lethal && me.inventory.filter((item) => item !== null).length < 2 &&
      (difficulty === 'hard' || baseline.damage === 0)) {
    for (const crate of state.items) {
      const velocity = findCrateShot(state, me.id, crate);
      if (!velocity) continue;
      const candidate: AIFirePlan = { angleDeg: Math.atan2(-velocity.velocityY, velocity.velocityX) * 180 / Math.PI,
        speed: Math.hypot(velocity.velocityX, velocity.velocityY) };
      const evaluation = evaluateAIShot(state, candidate);
      // Hard may invest in visible supply at the cost of a weak attack, but never
      // gives up a lethal attack. Normal collects only when its attack cannot hit.
      const utility = evaluation.damage * 4 - evaluation.selfDamage * 5 + evaluation.pickups * (difficulty === 'hard' ? 5 : 3);
      if (utility > score(bestEvaluation)) { best = candidate; bestEvaluation = evaluation; collecting = true; }
    }
  }
  return { ...decision, fire: collecting && perturbCrate ? perturbCrate(best) : best };
}
