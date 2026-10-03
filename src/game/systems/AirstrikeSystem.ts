import { GAME_CONFIG } from '../config/GameConfig';
import type { AirstrikeResult } from '../state/AirstrikeState';
import type { GameState } from '../state/GameState';
import { TurnPhase } from '../state/TurnPhase';
import { checkOctopusEmergence } from './OctopusHazardSystem';
import { ConcreteDamageSystem, type DamageSystem } from './DamageSystem';

/** Authority only. Presentation completion never consumes a normal shot or a turn. */
export class AirstrikeSystem {
  constructor(private readonly damage: DamageSystem = new ConcreteDamageSystem()) {}

  resolve(state: GameState, expected?: { itemId: string; turnId: number }): AirstrikeResult | null {
    const context = state.pendingAirstrike;
    if (!context || state.gameOver || state.phase !== TurnPhase.AIRSTRIKE ||
        context.turnId !== state.turnId || context.ownerId !== state.currentPlayerId ||
        (expected && (expected.itemId !== context.itemId || expected.turnId !== context.turnId))) return null;
    const damage = this.damage.calculate(state, { sourcePlayerId: context.ownerId, weaponId: 'normal',
      turnId: context.turnId, ...context.target, radius: GAME_CONFIG.explosion.radius });
    this.damage.apply(state, damage);
    checkOctopusEmergence(state);
    state.pendingAirstrike = null;
    state.phase = state.gameOver ? TurnPhase.GAME_OVER : context.resumePhase;
    return { context, damage };
  }
}
