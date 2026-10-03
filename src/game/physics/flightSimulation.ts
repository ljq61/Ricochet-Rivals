import { GAME_CONFIG } from '../config/GameConfig';
import type { FireCommand } from '../commands/GameCommand';
import type { GameState } from '../state/GameState';
import type { ShotContext } from '../state/ItemState';
import type { ProjectileState } from '../state/ProjectileState';
import { isOctopusActive } from '../state/OctopusState';
import { along, sweptCircleRectTime, type Point, type Rect } from './itemGeometry';

export interface FlightState extends ProjectileState {
  originX: number;
  originY: number;
  armed: boolean;
}
export interface FlightSegment { from: Point; to: Point }
export interface FlightStep {
  segments: FlightSegment[];
  termination: 'impact' | 'out-of-bounds' | null;
  homingActivated: boolean;
}

export function createFlightState(command: FireCommand, id = 'flight'): FlightState {
  return { id, ownerId: command.playerId, weaponId: command.weaponId,
    x: command.startX, y: command.startY, velocityX: command.velocityX,
    velocityY: command.velocityY, ageMs: 0, status: 'flying',
    originX: command.startX, originY: command.startY, armed: false };
}

export function solidRects(state: GameState): { rect: Rect; requiresArming: boolean }[] {
  const { world, player, octopus } = GAME_CONFIG;
  const rectangles: { rect: Rect; requiresArming: boolean }[] = [player.leftBounds, player.rightBounds].map((bounds) => ({
    rect: { minX: bounds.minX - world.platformOverhang, maxX: bounds.maxX + world.platformOverhang,
      minY: world.groundTopY, maxY: world.height }, requiresArming: false,
  }));
  for (const p of Object.values(state.players)) rectangles.push({
    rect: { minX: p.x - player.collision.width / 2, maxX: p.x + player.collision.width / 2,
      minY: p.y - player.collision.height, maxY: p.y }, requiresArming: true,
  });
  if (isOctopusActive(state.octopus)) rectangles.push({
    rect: { minX: octopus.x - octopus.width * octopus.collisionWidthRatio / 2,
      maxX: octopus.x + octopus.width * octopus.collisionWidthRatio / 2,
      minY: octopus.baseY - octopus.height * octopus.collisionHeightRatio,
      maxY: octopus.baseY }, requiresArming: true,
  });
  return rectangles;
}

/** Portion of this step after the shell first leaves its fuse circle. */
function armedFrom(flight: FlightState, from: Point, to: Point): number | null {
  if (flight.armed) return 0;
  const r = GAME_CONFIG.projectile.playerCollisionArmDistance;
  const fx = from.x - flight.originX;
  const fy = from.y - flight.originY;
  if (Math.hypot(fx, fy) >= r) { flight.armed = true; return 0; }
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const a = dx * dx + dy * dy;
  if (a === 0) return null;
  const b = 2 * (fx * dx + fy * dy);
  const discriminant = b * b - 4 * a * (fx * fx + fy * fy - r * r);
  const t = (-b + Math.sqrt(Math.max(0, discriminant))) / (2 * a);
  if (t <= 1) { flight.armed = true; return Math.max(0, t); }
  return null;
}

/** Fixed 60Hz semi-implicit integrator reproduces Matter's frictionAir=0 free flight.
 * Callers accumulate frame time, so frame size never changes physics or the lock point.
 * This adapter also clips sweeps before solid contact; Matter discrete collision can tunnel.
 */
export function stepFlight(flight: FlightState, state: GameState, deltaMs: number,
  shot: ShotContext | null = null): FlightStep {
  const result: FlightStep = { segments: [], termination: null, homingActivated: false };
  if (flight.status !== 'flying' || !Number.isFinite(deltaMs) || deltaMs <= 0) return result;
  let remaining = Math.min(deltaMs, GAME_CONFIG.physics.projectileLifetimeMs - flight.ageMs);
  while (remaining > 1e-8) {
    const isHoming = shot?.itemType === 'homing';
    const untilLock = GAME_CONFIG.items.homingDelayMs - flight.ageMs;
    if (isHoming && !shot.homingActivated && untilLock <= 1e-7) {
      activateHoming(flight, state, shot);
      result.homingActivated = true;
    }
    const ms = isHoming && !shot.homingActivated ? Math.min(remaining, untilLock) : remaining;
    const dt = ms / 1000;
    const gravity = shot?.homingActivated ? 0 : GAME_CONFIG.physics.gravityY;
    const from = { x: flight.x, y: flight.y };
    flight.velocityX += (shot?.homingActivated ? 0 : GAME_CONFIG.physics.gravityX) * dt;
    flight.velocityY += gravity * dt;
    const to = { x: from.x + flight.velocityX * dt, y: from.y + flight.velocityY * dt };
    const fuse = armedFrom(flight, from, to);
    let end = 1;
    let termination: FlightStep['termination'] = null;
    for (const { rect, requiresArming } of solidRects(state)) {
      if (requiresArming && fuse === null) continue;
      const startT = requiresArming ? fuse ?? 0 : 0;
      const t = sweptCircleRectTime(along(from, to, startT), to, rect, GAME_CONFIG.projectile.radius);
      const contact = t === null ? null : startT + (1 - startT) * t;
      if (contact !== null && contact <= end) { end = contact; termination = 'impact'; }
    }
    for (const [start, finish, boundary, below] of [
      [from.x, to.x, -60, true], [from.x, to.x, GAME_CONFIG.world.width + 60, false],
      [from.y, to.y, GAME_CONFIG.world.height + 60, false],
    ] as const) {
      if (below ? finish < boundary : finish > boundary) {
        const t = Math.max(0, Math.min(1, (boundary - start) / (finish - start)));
        if (t < end) { end = t; termination = 'out-of-bounds'; }
      }
    }
    const position = along(from, to, end);
    flight.x = position.x;
    flight.y = position.y;
    flight.ageMs += ms * end;
    result.segments.push({ from, to: position });
    if (termination) { result.termination = termination; return result; }
    remaining -= ms;
  }
  if (flight.ageMs >= GAME_CONFIG.physics.projectileLifetimeMs - 1e-7) result.termination = 'impact';
  // At an exact lock boundary the preceding collision wins before this activation.
  if (shot?.itemType === 'homing' && !shot.homingActivated && result.termination === null &&
      flight.ageMs >= GAME_CONFIG.items.homingDelayMs - 1e-7) {
    activateHoming(flight, state, shot);
    result.homingActivated = true;
  }
  return result;
}

function activateHoming(flight: FlightState, state: GameState, shot: ShotContext): void {
  const enemy = state.players[flight.ownerId === 'P1' ? 'P2' : 'P1'];
  const target = { x: enemy.x, y: enemy.y - GAME_CONFIG.player.collision.height / 2 };
  shot.homingTarget = target;
  const dx = target.x - flight.x;
  const dy = target.y - flight.y;
  const length = Math.hypot(dx, dy);
  const currentSpeed = Math.hypot(flight.velocityX, flight.velocityY);
  if (length > 1e-8) {
    flight.velocityX = dx / length * GAME_CONFIG.items.homingSpeed;
    flight.velocityY = dy / length * GAME_CONFIG.items.homingSpeed;
  } else if (currentSpeed > 0) {
    flight.velocityX *= GAME_CONFIG.items.homingSpeed / currentSpeed;
    flight.velocityY *= GAME_CONFIG.items.homingSpeed / currentSpeed;
  }
  shot.homingActivated = true;
}

/** Pause policy belongs to simulation time, not projectile lifetime wall clock. */
export function simulationFrameBudget(accumulatorMs: number, deltaMs: number): { steps: number; remainingMs: number } {
  if (!Number.isFinite(deltaMs) || deltaMs <= 0) return { steps: 0, remainingMs: accumulatorMs };
  const dt = deltaMs > GAME_CONFIG.items.maxFrameDeltaMs ? GAME_CONFIG.items.simulationStepMs : deltaMs;
  const available = accumulatorMs + dt;
  const steps = Math.floor((available + 1e-8) / GAME_CONFIG.items.simulationStepMs);
  return { steps, remainingMs: Math.max(0, available - steps * GAME_CONFIG.items.simulationStepMs) };
}
