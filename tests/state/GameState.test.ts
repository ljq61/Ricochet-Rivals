import { describe, expect, it } from 'vitest';
import {
  createInitialGameState,
  createPlayerState,
  TurnPhase,
} from '../../src/game/state/GameState';
import { GAME_CONFIG } from '../../src/game/config/GameConfig';

describe('createInitialGameState', () => {
  it('创建双方玩家，位置为出生点，满血且存活', () => {
    const state = createInitialGameState({ matchId: 'm-1', seed: 42 });

    const p1 = state.players.P1;
    const p2 = state.players.P2;

    expect(p1.id).toBe('P1');
    expect(p1.side).toBe('left');
    expect(p1.x).toBe(GAME_CONFIG.player.spawn.P1);
    expect(p2.id).toBe('P2');
    expect(p2.side).toBe('right');
    expect(p2.x).toBe(GAME_CONFIG.player.spawn.P2);

    for (const player of [p1, p2]) {
      expect(player.hp).toBe(GAME_CONFIG.player.maxHp);
      expect(player.maxHp).toBe(GAME_CONFIG.player.maxHp);
      expect(player.isAlive).toBe(true);
      expect(player.hasFired).toBe(false);
      expect(player.moveRemaining).toBe(GAME_CONFIG.player.maxMovePerTurn);
      expect(player.weaponId).toBe('normal');
      expect(player.y).toBe(GAME_CONFIG.world.groundTopY);
    }
  });

  it('初始回合为 1，当前玩家默认 P1，处于 START 阶段', () => {
    const state = createInitialGameState({ matchId: 'm-1', seed: 42 });

    expect(state.turnId).toBe(1);
    expect(state.currentPlayerId).toBe('P1');
    expect(state.phase).toBe(TurnPhase.START);
  });

  it('保存 matchId 与 seed，无胜者且未结束', () => {
    const state = createInitialGameState({ matchId: 'm-abc', seed: 987654 });

    expect(state.matchId).toBe('m-abc');
    expect(state.seed).toBe(987654);
    expect(state.gameOver).toBe(false);
    expect(state.winnerId).toBeNull();
    expect(state.items).toEqual([]);
  });

  it('可指定先手玩家', () => {
    const state = createInitialGameState({
      matchId: 'm-1',
      seed: 1,
      firstPlayer: 'P2',
    });

    expect(state.currentPlayerId).toBe('P2');
  });
});

describe('createPlayerState', () => {
  it('返回独立的 PlayerState 实例（不被共享引用污染）', () => {
    const a = createPlayerState('P1');
    const b = createPlayerState('P1');

    a.x = 123;
    expect(b.x).toBe(GAME_CONFIG.player.spawn.P1);
    expect(a).not.toBe(b);
  });
});
