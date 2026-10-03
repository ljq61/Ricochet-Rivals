import type { WorldItemType } from './ids';

/** Fixed world anchor. Parachute motion is presentation only. */
export interface WorldItemState {
  id: string;
  type: WorldItemType;
  x: number;
  y: number;
  active: boolean;
  spawnTurnId: number;
  expiresAtTurnId: number;
}
