import type { AirstrikeContext } from '../../state/AirstrikeState';
import type { GameState } from '../../state/GameState';
import type { InventoryItem, ItemGenerationState, ShotContext } from '../../state/ItemState';
import type { WorldItemState } from '../../state/WorldItemState';
import { PLAYER_IDS } from '../../state/ids';
import type { ItemEventDetails, ItemStateChangeKind, ItemStatePayload } from './OnlineTypes';

export function copyInventory(items: readonly (InventoryItem | null)[]): (InventoryItem | null)[] {
  return items.map((item) => item === null ? null : { id: item.id, type: item.type });
}

export function copyWorldItems(items: readonly WorldItemState[]): WorldItemState[] {
  return items.map((item) => ({
    id: item.id, type: item.type, x: item.x, y: item.y, active: item.active,
    spawnTurnId: item.spawnTurnId, expiresAtTurnId: item.expiresAtTurnId,
  }));
}

export function copyGeneration(generation: ItemGenerationState): ItemGenerationState {
  return { firstWindowParity: generation.firstWindowParity, lastWindowTurnId: generation.lastWindowTurnId,
    misses: generation.misses, nextId: generation.nextId };
}

export function copyShot(shot: ShotContext | null): ShotContext | null {
  if (shot === null) return null;
  return {
    ownerId: shot.ownerId, turnId: shot.turnId, homingActivated: shot.homingActivated,
    ...(shot.itemId === undefined ? {} : { itemId: shot.itemId }),
    ...(shot.itemType === undefined ? {} : { itemType: shot.itemType }),
    ...(shot.homingTarget === undefined ? {} : { homingTarget: { x: shot.homingTarget.x, y: shot.homingTarget.y } }),
  };
}

export function copyAirstrike(context: AirstrikeContext | null): AirstrikeContext | null {
  return context === null ? null : { itemId: context.itemId, ownerId: context.ownerId,
    turnId: context.turnId, target: { x: context.target.x, y: context.target.y }, resumePhase: context.resumePhase };
}

export function buildItemStatePayload(
  state: GameState,
  kind: ItemStateChangeKind,
  details: ItemEventDetails = {},
  operationId?: string,
): ItemStatePayload {
  return {
    kind, turnId: state.turnId, octopus: { ...state.octopus }, ...details,
    ...(details.airstrike === undefined ? {} : { airstrike: copyAirstrike(details.airstrike)! }),
    phase: state.phase, currentPlayerId: state.currentPlayerId, gameOver: state.gameOver, winnerId: state.winnerId,
    ...(operationId === undefined ? {} : { operationId }),
    players: {
      P1: { x: state.players.P1.x, y: state.players.P1.y, hasFired: state.players.P1.hasFired, moveRemaining: state.players.P1.moveRemaining, hp: state.players.P1.hp, isAlive: state.players.P1.isAlive, inventory: copyInventory(state.players.P1.inventory), itemUsedThisTurn: state.players.P1.itemUsedThisTurn },
      P2: { x: state.players.P2.x, y: state.players.P2.y, hasFired: state.players.P2.hasFired, moveRemaining: state.players.P2.moveRemaining, hp: state.players.P2.hp, isAlive: state.players.P2.isAlive, inventory: copyInventory(state.players.P2.inventory), itemUsedThisTurn: state.players.P2.itemUsedThisTurn },
    },
    items: copyWorldItems(state.items),
    itemGeneration: copyGeneration(state.itemGeneration),
    acceptedShot: copyShot(state.acceptedShot),
    pendingAirstrike: copyAirstrike(state.pendingAirstrike),
  };
}

/** Only call after the payload guard and match/turn ownership checks. */
export function applyItemState(state: GameState, payload: ItemStatePayload): void {
  for (const id of PLAYER_IDS) {
    state.players[id].hp = payload.players[id].hp;
    state.players[id].isAlive = payload.players[id].isAlive;
    state.players[id].inventory = copyInventory(payload.players[id].inventory);
    state.players[id].itemUsedThisTurn = payload.players[id].itemUsedThisTurn;
  }
  state.pendingAirstrike = copyAirstrike(payload.pendingAirstrike);
  if (payload.kind === 'airstrike_start' || payload.kind === 'airstrike_end') {
    Object.assign(state.octopus, payload.octopus);
    for (const id of PLAYER_IDS) {
      state.players[id].x = payload.players[id].x;
      state.players[id].y = payload.players[id].y;
      state.players[id].hasFired = payload.players[id].hasFired;
      state.players[id].moveRemaining = payload.players[id].moveRemaining;
    }
    state.phase = payload.phase;
    state.gameOver = payload.gameOver;
    state.winnerId = payload.winnerId;
  }
  state.items.splice(0, state.items.length, ...copyWorldItems(payload.items));
  Object.assign(state.itemGeneration, copyGeneration(payload.itemGeneration));
  // Keep an already-launched Guest projectile's shot reference alive.
  const incoming = copyShot(payload.acceptedShot);
  if (incoming !== null && state.acceptedShot?.ownerId === incoming.ownerId && state.acceptedShot.turnId === incoming.turnId) {
    Object.assign(state.acceptedShot, incoming);
  } else {
    state.acceptedShot = incoming;
  }
}
