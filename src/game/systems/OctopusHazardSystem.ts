import { GAME_CONFIG } from '../config/GameConfig';
import { SeededRandom } from '../random/SeededRandom';
import type { DamageResult } from '../state/DamageResult';
import type { ProjectileImpact } from '../state/ExplosionEvent';
import type { GameState } from '../state/GameState';
import { isOctopusActive } from '../state/OctopusState';
import { PLAYER_IDS, type PlayerId } from '../state/ids';
import { applyGameOverIfDead, damageAtDistance } from './DamageSystem';
import { shouldOctopusEmerge } from './octopusTrigger';

/** Explosions use the same AABB as the rendered tentacle's Matter obstacle. */
function distanceToOctopus(impact: ProjectileImpact): number {
  const cfg = GAME_CONFIG.octopus;
  const halfWidth = cfg.width * cfg.collisionWidthRatio / 2;
  const top = cfg.baseY - cfg.height * cfg.collisionHeightRatio;
  const dx = Math.max(0, Math.abs(impact.x - cfg.x) - halfWidth);
  const dy = Math.max(0, top - impact.y, impact.y - cfg.baseY);
  return Math.hypot(dx, dy);
}

/** A separate per-turn stream leaves AI randomness and restored matches unchanged. */
function laserTarget(state: GameState): PlayerId {
  const seed = state.seed ^ Math.imul(state.turnId, 0x9e3779b1);
  return new SeededRandom(seed).integer(0, 1) === 0 ? 'P1' : 'P2';
}

/** Birth may follow any damage source without advancing the laser action clock. */
export function checkOctopusEmergence(state: GameState): void {
  if (!state.gameOver && state.octopus.spawnTurnId === null &&
      shouldOctopusEmerge(state.players.P1.hp, state.players.P2.hp)) {
    state.octopus.spawnTurnId = state.turnId;
  }
}

/**
 * Resolve once after the player's explosion damage has already been applied.
 * Out-of-bounds shots still advance the hazard. Animation consumes attack history;
 * it never delays or modifies this deterministic authoritative result.
 */
export function resolveOctopusTurn(
  state: GameState,
  impact: ProjectileImpact | null,
  result: DamageResult | null
): DamageResult | null {
  const octopus = state.octopus;
  if (state.turnId <= octopus.lastResolvedTurnId ||
      (impact !== null && impact.turnId !== state.turnId)) {
    return result;
  }
  octopus.lastResolvedTurnId = state.turnId;
  if (state.gameOver) {
    return result;
  }

  // Only a tentacle already present before this shot can take its explosion damage.
  if (isOctopusActive(octopus) && impact !== null) {
    octopus.hp = Math.max(0, octopus.hp - damageAtDistance(distanceToOctopus(impact), impact.itemType));
  }
  checkOctopusEmergence(state);
  if (!isOctopusActive(octopus) || octopus.spawnTurnId === null ||
      state.turnId - octopus.spawnTurnId < GAME_CONFIG.octopus.attackAfterTurns ||
      (octopus.lastAttackTurnId !== null &&
        state.turnId - octopus.lastAttackTurnId < GAME_CONFIG.octopus.attackIntervalTurns)) {
    return result;
  }

  const target = laserTarget(state);
  const player = state.players[target];
  const hpBefore = player.hp;
  player.hp = Math.max(0, hpBefore - GAME_CONFIG.octopus.laserDamage);
  player.isAlive = player.hp > 0;
  octopus.lastAttackTurnId = state.turnId;
  octopus.lastAttackTarget = target;
  applyGameOverIfDead(state);

  // Synthetic event is a numeric feedback carrier for a shot that never exploded.
  const merged: DamageResult = result === null ? {
    explosion: {
      sourcePlayerId: state.currentPlayerId,
      weaponId: 'normal',
      x: GAME_CONFIG.octopus.x,
      y: GAME_CONFIG.octopus.baseY - GAME_CONFIG.octopus.height,
      radius: 0,
      turnId: state.turnId,
    },
    players: PLAYER_IDS.map((playerId) => ({
      playerId,
      distance: GAME_CONFIG.world.width,
      damage: 0,
      hpBefore: playerId === target ? hpBefore : state.players[playerId].hp,
      hpAfter: playerId === target ? hpBefore : state.players[playerId].hp,
    })),
  } : { explosion: result.explosion, players: result.players.map((entry) => ({ ...entry })) };
  const entry = merged.players.find((entry) => entry.playerId === target);
  if (entry !== undefined) {
    entry.damage += hpBefore - player.hp;
    entry.hpAfter = player.hp;
  }
  return merged;
}
