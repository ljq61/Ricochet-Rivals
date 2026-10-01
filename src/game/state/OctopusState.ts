import { GAME_CONFIG } from '../config/GameConfig';
import type { PlayerId, TurnId } from './ids';

/** Authoritative hazard state, including its one-time spawn and turn history. */
export interface OctopusState {
  hp: number;
  spawnTurnId: TurnId | null;
  lastResolvedTurnId: TurnId;
  lastAttackTurnId: TurnId | null;
  lastAttackTarget: PlayerId | null;
}

export function createOctopusState(): OctopusState {
  return {
    hp: GAME_CONFIG.octopus.maxHp,
    spawnTurnId: null,
    lastResolvedTurnId: 0,
    lastAttackTurnId: null,
    lastAttackTarget: null,
  };
}

export function isOctopusActive(octopus: OctopusState): boolean {
  return octopus.spawnTurnId !== null && octopus.hp > 0;
}
