import { describe, expect, it } from 'vitest';
import { createInitialGameState } from '../../src/game/state/GameState';
import {
  createMatchSetup,
} from '../../src/game/match/MatchFactory';
import type { MatchSetup } from '../../src/game/match/MatchSetup';

/**
 * Phase 11 验收 1/2/3/4/5：
 * - SP / Local2P MatchSetup 的 InputSource 组合正确
 * - Rematch（同 setup 重启）= 全新 GameState（HP / 回合 / 预算全重置）
 */

describe('MatchFactory（Phase 11）', () => {
  it('Single Player：P1 = human，P2 = ai，难度默认 normal', () => {
    const setup = createMatchSetup('single_player');
    expect(setup.mode).toBe('single_player');
    expect(setup.p1Controller).toBe('human');
    expect(setup.p2Controller).toBe('ai');
    expect(setup.aiDifficulty).toBe('normal');
  });

  it('Single Player：显式难度透传', () => {
    const setup = createMatchSetup('single_player', 'hard');
    expect(setup.aiDifficulty).toBe('hard');
  });

  it('Local 2P：P1 = human，P2 = human，无难度字段', () => {
    const setup = createMatchSetup('local_2p');
    expect(setup.mode).toBe('local_2p');
    expect(setup.p1Controller).toBe('human');
    expect(setup.p2Controller).toBe('human');
    expect(setup.aiDifficulty).toBeUndefined();
  });

  it('Online：契约占位 P2 = network（Phase 12 前不启动 Battle）', () => {
    const setup = createMatchSetup('online');
    expect(setup.mode).toBe('online');
    expect(setup.p1Controller).toBe('human');
    expect(setup.p2Controller).toBe('network');
  });
});

describe('Rematch 语义：同 setup 重建全新 GameState', () => {
  const setup: MatchSetup = createMatchSetup('local_2p');

  it('两次 init 产生互不共享的全新状态（Rematch 防污染）', () => {
    const first = createInitialGameState({ matchId: 'a', seed: 1 });
    const second = createInitialGameState({ matchId: 'a', seed: 1 });

    // 污染旧局：HP / 位置 / 预算 / 回合
    first.players.P1.hp = 3;
    first.players.P1.hasFired = true;
    first.players.P1.x = 850;
    first.players.P2.moveRemaining = 0;
    first.turnId = 9;
    first.currentPlayerId = 'P2';

    // 新局必须完全不受旧局污染影响
    expect(second.players.P1.hp).toBe(10);
    expect(second.players.P1.hasFired).toBe(false);
    expect(second.players.P1.x).toBe(450);
    expect(second.players.P2.moveRemaining).toBe(250);
    expect(second.turnId).toBe(1);
    expect(second.currentPlayerId).toBe('P1');
    expect(second.gameOver).toBe(false);
    expect(second.winnerId).toBeNull();
    expect(setup.p2Controller).toBe('human');
  });

  it('Rematch 血量与回合重置（验收 4/5 的状态层保证）', () => {
    const played = createInitialGameState({ matchId: 'a', seed: 1 });
    played.players.P2.hp = 0;
    played.players.P2.isAlive = false;
    played.gameOver = true;
    played.winnerId = 'P1';

    const rematch = createInitialGameState({ matchId: 'a', seed: 1 });
    expect(rematch.players.P1.hp).toBe(10);
    expect(rematch.players.P2.hp).toBe(10);
    expect(rematch.players.P2.isAlive).toBe(true);
    expect(rematch.gameOver).toBe(false);
  });
});
