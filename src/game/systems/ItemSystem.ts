import { GAME_CONFIG } from '../config/GameConfig';
import type { UseItemCommand } from '../commands/GameCommand';
import { getLaunchOrigin } from '../physics/aimMath';
import { createFlightState, solidRects, stepFlight } from '../physics/flightSimulation';
import { pointRectDistance, pointSegmentDistance, sweptCircleRectTime, type Point, type Rect } from '../physics/itemGeometry';
import { SeededRandom, type RandomSource } from '../random/SeededRandom';
import type { GameState } from '../state/GameState';
import type { ItemPickup } from '../state/ItemState';
import type { AirstrikeContext } from '../state/AirstrikeState';
import type { WorldItemState } from '../state/WorldItemState';
import { PLAYER_IDS, type PlayerId, type WorldItemType } from '../state/ids';
import { TurnPhase } from '../state/TurnPhase';
import { solveTrajectory } from '../ai/TrajectorySolver';

export type ItemRejectReason = 'GAME_OVER' | 'WRONG_PHASE' | 'TURN_MISMATCH' |
  'NOT_CURRENT_PLAYER' | 'PLAYER_DEAD' | 'ALREADY_FIRED' | 'ITEM_ALREADY_USED' |
  'ITEM_NOT_OWNED' | 'NOT_HEAL_ITEM' | 'FULL_HP';
export interface UseItemResult {
  accepted: boolean;
  reason?: ItemRejectReason;
  itemId?: string;
  hpBefore?: number;
  hpAfter?: number;
  airstrike?: AirstrikeContext;
}
export interface ItemTurnResult {
  spawned: WorldItemState | null;
  expiredIds: string[];
  skipped?: 'not-window' | 'full' | 'no-candidates' | 'probability';
}

export function crateRect(item: Point): Rect {
  return { minX: item.x - GAME_CONFIG.items.crateWidth / 2,
    maxX: item.x + GAME_CONFIG.items.crateWidth / 2,
    minY: item.y - GAME_CONFIG.items.crateHeight / 2,
    maxY: item.y + GAME_CONFIG.items.crateHeight / 2 };
}

export function itemCommandReject(state: GameState, playerId: PlayerId, turnId: number): ItemRejectReason | null {
  if (state.gameOver) return 'GAME_OVER';
  if (state.phase !== TurnPhase.ACTION && state.phase !== TurnPhase.AIM) return 'WRONG_PHASE';
  if (turnId !== state.turnId) return 'TURN_MISMATCH';
  if (playerId !== state.currentPlayerId) return 'NOT_CURRENT_PLAYER';
  const player = state.players[playerId];
  if (!player.isAlive || player.hp <= 0) return 'PLAYER_DEAD';
  if (player.hasFired) return 'ALREADY_FIRED';
  if (player.itemUsedThisTurn) return 'ITEM_ALREADY_USED';
  return null;
}

/** Deterministic, pure-state item rules. Network and presentation consume its results. */
export class ItemSystem {
  execute(state: GameState, command: UseItemCommand): UseItemResult {
    const reason = itemCommandReject(state, command.playerId, command.turnId);
    if (reason) return { accepted: false, reason };
    const player = state.players[command.playerId];
    const slot = player.inventory.findIndex((entry) => entry?.id === command.itemId);
    const item = player.inventory[slot];
    if (!item) return { accepted: false, reason: 'ITEM_NOT_OWNED' };
    if (item.type === 'airstrike') {
      const enemy = state.players[command.playerId === 'P1' ? 'P2' : 'P1'];
      const context: AirstrikeContext = { itemId: item.id, ownerId: command.playerId,
        turnId: state.turnId,
        target: { x: enemy.x, y: enemy.y - GAME_CONFIG.player.collision.height / 2 },
        resumePhase: command.resumePhase ?? state.phase as TurnPhase.ACTION | TurnPhase.AIM };
      player.inventory[slot] = null;
      player.itemUsedThisTurn = true;
      state.pendingAirstrike = context;
      state.phase = TurnPhase.AIRSTRIKE;
      return { accepted: true, itemId: item.id, airstrike: context };
    }
    if (item.type !== 'heal') return { accepted: false, reason: 'NOT_HEAL_ITEM' };
    if (player.hp >= player.maxHp) return { accepted: false, reason: 'FULL_HP' };
    const hpBefore = player.hp;
    player.hp = Math.min(player.maxHp, player.hp + GAME_CONFIG.items.healHp);
    player.inventory[slot] = null;
    player.itemUsedThisTurn = true;
    return { accepted: true, itemId: item.id, hpBefore, hpAfter: player.hp };
  }

  collectAlongSegment(state: GameState, ownerId: PlayerId, from: Point, to: Point): ItemPickup[] {
    const contacts = state.items.filter((item) => item.active).map((item) => ({
      item, t: sweptCircleRectTime(from, to, crateRect(item), GAME_CONFIG.projectile.radius),
    })).filter((entry): entry is { item: WorldItemState; t: number } => entry.t !== null)
      .sort((a, b) => a.t - b.t || a.item.id.localeCompare(b.item.id));
    const pickups: ItemPickup[] = [];
    const inventory = state.players[ownerId].inventory;
    for (const { item } of contacts) {
      const slot = inventory.findIndex((entry) => entry === null);
      if (slot < 0) break;
      inventory[slot] = { id: item.id, type: item.type };
      item.active = false;
      pickups.push({ itemId: item.id, type: item.type, playerId: ownerId, slot });
    }
    state.items = state.items.filter((item) => item.active);
    return pickups;
  }

  /** Called before every new action. Expiry also runs outside generation windows. */
  processTurnStart(state: GameState, rng?: RandomSource): ItemTurnResult {
    const expiredIds = state.items.filter((item) => !item.active || item.expiresAtTurnId <= state.turnId)
      .map((item) => item.id);
    state.items = state.items.filter((item) => item.active && item.expiresAtTurnId > state.turnId);
    const result: ItemTurnResult = { spawned: null, expiredIds };
    const round = Math.floor((state.turnId - 1) / 2) + 1;
    const gen = state.itemGeneration;
    const parity = (gen.firstWindowParity + round - GAME_CONFIG.items.firstRound) % 2;
    if (state.gameOver || round < GAME_CONFIG.items.firstRound ||
        (state.turnId - 1) % 2 !== parity || gen.lastWindowTurnId >= state.turnId) {
      return { ...result, skipped: 'not-window' };
    }
    gen.lastWindowTurnId = state.turnId;
    if (state.items.length >= GAME_CONFIG.items.maxWorldItems) return { ...result, skipped: 'full' };
    const regions = legalCrateCandidates(state);
    const available = regions.filter((region) => region.length > 0);
    if (available.length === 0) return { ...result, skipped: 'no-candidates' };
    // Separate seed stream per window; AI calls and skipped windows do not consume it.
    const random = rng ?? new SeededRandom(state.seed ^ 0x17e6a9 ^ Math.imul(state.turnId, 0x9e3779b1));
    const guaranteed = round === GAME_CONFIG.items.firstRound || gen.misses >= GAME_CONFIG.items.pityMisses;
    if (!guaranteed && random.next() >= GAME_CONFIG.items.spawnChance) {
      gen.misses += 1;
      return { ...result, skipped: 'probability' };
    }
    const region = available[random.integer(0, available.length - 1)]!;
    const point = region[random.integer(0, region.length - 1)]!;
    let weight = random.next() * 100;
    let type: WorldItemType = 'homing';
    for (const [candidate, count] of Object.entries(GAME_CONFIG.items.weights)) {
      if (weight < count) { type = candidate as WorldItemType; break; }
      weight -= count;
    }
    const spawned: WorldItemState = { id: `item-${gen.nextId}`, type, ...point, active: true,
      spawnTurnId: state.turnId, expiresAtTurnId: state.turnId + GAME_CONFIG.items.lifetimeTurns };
    gen.nextId += 1;
    gen.misses = 0;
    state.items.push(spawned);
    return { spawned, expiredIds };
  }
}

/** A human-legal shot to a crate, verified by the production flight and solid sweeps.
 * Finite 25 time samples; no RNG and no assumption that the octopus can be traversed.
 */
export function findCrateShot(state: GameState, ownerId: PlayerId, target: Point): { velocityX: number; velocityY: number } | null {
  const origin = getLaunchOrigin(state.players[ownerId]);
  if (![origin.x, origin.y, target.x, target.y].every(Number.isFinite)) return null;
  const minimumSpeed = GAME_CONFIG.aiming.minLaunchSpeed + GAME_CONFIG.aiming.minPower *
    (GAME_CONFIG.aiming.maxLaunchSpeed - GAME_CONFIG.aiming.minLaunchSpeed);
  const stepMs = GAME_CONFIG.items.simulationStepMs;
  for (let ticks = 30; ticks <= 390; ticks += 15) {
    const seconds = ticks / 60;
    const velocityX = (target.x - origin.x) / seconds;
    // Matter's 60Hz semi-implicit fall: g*t*(t + dt)/2.
    const velocityY = (target.y - origin.y - GAME_CONFIG.physics.gravityY * seconds * (seconds + 1 / 60) / 2) / seconds;
    const speed = Math.hypot(velocityX, velocityY);
    if (speed < minimumSpeed || speed > GAME_CONFIG.aiming.maxLaunchSpeed || velocityY >= 0) continue;
    const flight = createFlightState({ type: 'FIRE', playerId: ownerId, turnId: state.turnId,
      weaponId: 'normal', startX: origin.x, startY: origin.y, velocityX, velocityY, seed: state.seed });
    for (let frame = 0; frame < ticks; frame++) {
      const update = stepFlight(flight, state, stepMs);
      for (const segment of update.segments) if (sweptCircleRectTime(segment.from, segment.to,
        crateRect(target), GAME_CONFIG.projectile.radius) !== null) return { velocityX, velocityY };
      if (update.termination !== null) break;
    }
  }
  return null;
}

export function legalCrateCandidates(state: GameState): Point[][] {
  const cfg = GAME_CONFIG.items;
  const referencePaths = PLAYER_IDS.map((ownerId) => {
    const me = state.players[ownerId];
    const enemy = state.players[ownerId === 'P1' ? 'P2' : 'P1'];
    const origin = getLaunchOrigin(me);
    const plan = solveTrajectory({ originX: origin.x, originY: origin.y,
      targetX: enemy.x, targetY: enemy.y - GAME_CONFIG.player.collision.height / 2 });
    if (!plan) return [];
    const points = [origin];
    const flight = createFlightState({ type: 'FIRE', playerId: ownerId, turnId: state.turnId,
      weaponId: 'normal', startX: origin.x, startY: origin.y,
      velocityX: plan.velocityX, velocityY: plan.velocityY, seed: state.seed });
    // Reference body-hit trajectory is independent of obstacle blockage.
    for (let frame = 0; frame < 480; frame++) {
      flight.velocityY += GAME_CONFIG.physics.gravityY / 60;
      flight.x += flight.velocityX / 60;
      flight.y += flight.velocityY / 60;
      points.push({ x: flight.x, y: flight.y });
      if ((enemy.x - flight.x) * Math.sign(plan.velocityX) < 0) break;
    }
    return points;
  });
  return cfg.spawnRegions.map(([minX, maxX]) => {
    const candidates: Point[] = [];
    for (let x = minX; x <= maxX; x += cfg.candidateGridStep) {
      for (let y = cfg.spawnY[0]; y <= cfg.spawnY[1]; y += cfg.candidateGridStep) {
        const point = { x, y };
        if (state.items.some((item) => Math.hypot(x - item.x, y - item.y) < cfg.separation)) continue;
        if (solidRects(state).some(({ rect }) => pointRectDistance(point, rect) <
            cfg.obstacleMargin + Math.hypot(cfg.crateWidth / 2, cfg.crateHeight / 2))) continue;
        if (referencePaths.some((path) => path.some((from, i) => i > 0 &&
          pointSegmentDistance(point, path[i - 1]!, from) < cfg.referenceArcClearance))) continue;
        if (!PLAYER_IDS.some((ownerId) => findCrateShot(state, ownerId, point) !== null)) continue;
        candidates.push(point);
      }
    }
    return candidates;
  });
}
