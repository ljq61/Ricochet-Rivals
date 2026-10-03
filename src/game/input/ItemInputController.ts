import type { CommandBus } from '../commands/CommandBus';
import type { GameCommand } from '../commands/GameCommand';
import type { GameState } from '../state/GameState';
import { TurnPhase } from '../state/TurnPhase';

interface ItemInputDeps {
  bus: CommandBus;
  getState: () => GameState;
  canUse: () => boolean;
  canControl: () => boolean;
}

/** Local reservation is presentation only; accepted commands own consumption. */
export class ItemInputController implements CommandBus {
  private selected: string | null = null;
  private turnKey = '';
  private operationSequence = 0;

  constructor(private readonly deps: ItemInputDeps) {}

  get selectedItemId(): string | null {
    this.refresh();
    return this.selected;
  }

  clear(): void { this.selected = null; }

  refresh(): void {
    const state = this.deps.getState();
    const key = `${state.matchId}:${state.turnId}:${state.currentPlayerId}`;
    const player = state.players[state.currentPlayerId];
    if (key !== this.turnKey || state.gameOver || player.hasFired ||
        player.itemUsedThisTurn || !player.inventory.some(item => item?.id === this.selected)) {
      this.clear();
    }
    this.turnKey = key;
  }

  select(itemId: string): void {
    this.refresh();
    if (!this.deps.canUse()) return;
    const state = this.deps.getState();
    const player = state.players[state.currentPlayerId];
    const item = player.inventory.find(entry => entry?.id === itemId);
    if (!item || player.hasFired || player.itemUsedThisTurn || !player.isAlive ||
        state.gameOver || (state.phase !== TurnPhase.ACTION && state.phase !== TurnPhase.AIM)) return;
    if (item.type === 'heal' || item.type === 'airstrike') {
      if (item.type === 'heal' && player.hp >= player.maxHp) return;
      this.clear();
      this.deps.bus.dispatch({ type: 'USE_ITEM', playerId: player.id,
        turnId: state.turnId, itemId,
        operationId: `${state.matchId}:${state.turnId}:${item.type}:${++this.operationSequence}` });
      this.refresh();
    } else {
      this.selected = this.selected === item.id ? null : item.id;
    }
  }

  dispatch(command: GameCommand): void {
    if (!this.deps.canControl()) return;
    this.refresh();
    const state = this.deps.getState();
    if (state.phase === TurnPhase.AIRSTRIKE) return;
    if (command.type === 'FIRE' && command.playerId === state.currentPlayerId) {
      this.deps.bus.dispatch({ ...command, ...(this.selected ? { itemId: this.selected } : {}) });
      this.refresh();
    } else {
      this.deps.bus.dispatch(command);
    }
  }

  subscribe(handler: (command: GameCommand) => void): () => void {
    return this.deps.bus.subscribe(handler);
  }
}
