import { describe, expect, it } from 'vitest';
import { ExplosionSystem } from '../../src/game/systems/ExplosionSystem';
import { ConcreteDamageSystem } from '../../src/game/systems/DamageSystem';
import { GAME_CONFIG } from '../../src/game/config/GameConfig';
import { createInitialGameState, type GameState } from '../../src/game/state/GameState';
import type { ProjectileImpact } from '../../src/game/state/ExplosionEvent';
import type { PlayerId } from '../../src/game/state/ids';

/**
 * ExplosionSystem（Phase 7）：
 * ProjectileImpact → ExplosionEvent（参数来自 GameConfig）→
 * DamageSystem calculate + apply → 返回 DamageResult，GameState 已更新。
 */

const BODY_CENTER_OFFSET = GAME_CONFIG.player.collision.height / 2;

function makeSystem(): ExplosionSystem {
  return new ExplosionSystem({ damage: new ConcreteDamageSystem() });
}

function impactNear(playerId: PlayerId, state: GameState): ProjectileImpact {
  const player = state.players[playerId];
  return {
    x: player.x + 30,
    y: player.y - BODY_CENTER_OFFSET,
    ownerId: playerId === 'P1' ? 'P2' : 'P1',
    weaponId: 'normal',
    turnId: 3,
  };
}

describe('ExplosionSystem.explode', () => {
  it('构建的 ExplosionEvent 携带 GameConfig 半径与完整爆炸上下文', () => {
    const system = makeSystem();
    const state = createInitialGameState({ matchId: 't', seed: 1 });
    const impact = impactNear('P2', state);

    const result = system.explode(state, impact);

    expect(result.explosion).toEqual({
      sourcePlayerId: 'P1',
      weaponId: 'normal',
      x: impact.x,
      y: impact.y,
      radius: GAME_CONFIG.explosion.radius,
      turnId: 3,
    });
  });

  it('结算链完整：命中 P2 → GameState hp 下降且结果与状态一致', () => {
    const system = makeSystem();
    const state = createInitialGameState({ matchId: 't', seed: 1 });
    const impact = impactNear('P2', state);

    const result = system.explode(state, impact);

    const p2 = result.players.find((p) => p.playerId === 'P2')!;
    expect(p2.damage).toBe(GAME_CONFIG.explosion.directDamage);
    expect(state.players.P2.hp).toBe(p2.hpAfter);
    expect(state.players.P2.hp).toBe(GAME_CONFIG.player.maxHp - 2);
    expect(state.players.P2.isAlive).toBe(true);
    expect(state.gameOver).toBe(false);
  });

  it('击杀结算：低血量命中 → gameOver + 幸存者获胜', () => {
    const system = makeSystem();
    const state = createInitialGameState({ matchId: 't', seed: 1 });
    state.players.P2.hp = 2;
    const impact = impactNear('P2', state);

    system.explode(state, impact);

    expect(state.players.P2.hp).toBe(0);
    expect(state.players.P2.isAlive).toBe(false);
    expect(state.gameOver).toBe(true);
    expect(state.winnerId).toBe('P1');
  });

  it('远距离落点：双方 0 伤害，状态不变', () => {
    const system = makeSystem();
    const state = createInitialGameState({ matchId: 't', seed: 1 });
    const impact: ProjectileImpact = {
      x: GAME_CONFIG.world.width / 2, // 中场：离双方阵地都很远
      y: GAME_CONFIG.world.groundTopY,
      ownerId: 'P1',
      weaponId: 'normal',
      turnId: 1,
    };

    const result = system.explode(state, impact);

    for (const entry of result.players) {
      expect(entry.damage).toBe(0);
      expect(entry.hpAfter).toBe(entry.hpBefore);
    }
    expect(state.gameOver).toBe(false);
  });
});
