import type { DamageResult } from './DamageResult';
import type { PlayerId, TurnId } from './ids';
import { TurnPhase } from './TurnPhase';

/** Accepted, public attack context. The target is frozen before the camera flight. */
export interface AirstrikeContext {
  itemId: string;
  ownerId: PlayerId;
  turnId: TurnId;
  target: { x: number; y: number };
  resumePhase: TurnPhase.ACTION | TurnPhase.AIM;
}

export interface AirstrikeResult {
  context: AirstrikeContext;
  damage: DamageResult;
}
