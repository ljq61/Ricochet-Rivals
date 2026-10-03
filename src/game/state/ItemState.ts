import type { PlayerId, TurnId, WorldItemType } from './ids';

export interface InventoryItem {
  id: string;
  type: WorldItemType;
}

export interface ItemGenerationState {
  /** One eligible window in each complete round; the first window is seeded. */
  firstWindowParity: 0 | 1;
  lastWindowTurnId: number;
  misses: number;
  nextId: number;
}

/** Only an accepted projectile owns a modifier. Pending HUD choices are local. */
export interface ShotContext {
  ownerId: PlayerId;
  turnId: TurnId;
  itemId?: string;
  itemType?: Exclude<WorldItemType, 'heal' | 'airstrike'>;
  homingActivated: boolean;
  homingTarget?: { x: number; y: number };
}

export type ItemChangeKind = 'spawn' | 'expire' | 'pickup' | 'homing' | 'airstrike_start' | 'airstrike_end';
export interface ItemPickup {
  itemId: string;
  playerId: PlayerId;
  slot: number;
  type: WorldItemType;
}
