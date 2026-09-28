import { describe, expect, it } from 'vitest';
import {
  ConcreteDamageSystem,
  damageAtDistance,
} from '../../src/game/systems/DamageSystem';
import { GAME_CONFIG } from '../../src/game/config/GameConfig';
import { createInitialGameState, type GameState } from '../../src/game/state/GameState';
import type { ExplosionEvent } from '../../src/game/state/ExplosionEvent';
import { PLAYER_IDS, type PlayerId } from '../../src/game/state/ids';

/**
 * DamageSystem（Phase 7，CODELY.md §15）：
 * 分层伤害 ≤60 → 2 / ≤140 → 1 / >140 → 0；
 * 距离 = 爆炸中心到玩家身体中心；
 * apply 更新 GameState（hp / isAlive / gameOver / winner）。
 */

const { directDamage, splashDamage } = GAME_CONFIG.explosion;
const BODY_CENTER_OFFSET = GAME_CONFIG.player.collision.height / 2;

function setupState(): GameState {
  return createInitialGameState({ matchId: 'test', seed: 1 });
}

/** 以玩家身体中心为原点的爆炸事件 */
function explosionAt(
  playerId: PlayerId,
  dx: number,
  dy = 0,
  turnId = 1
): ExplosionEvent {
  const state = setupState();
  const player = state.players[playerId];
  return {
    sourcePlayerId: playerId,
    weaponId: 'normal',
    x: player.x + dx,
    y: player.y - BODY_CENTER_OFFSET + dy,
    radius: GAME_CONFIG.explosion.radius,
    turnId,
  };
}

describe('damageAtDistance 分层边界', () => {
  it('≤ 60：directDamage（2）', () => {
    expect(damageAtDistance(0)).toBe(directDamage);
    expect(damageAtDistance(60)).toBe(directDamage);
  });

  it('60 < d ≤ 140：splashDamage（1）', () => {
    expect(damageAtDistance(60.0001)).toBe(splashDamage);
    expect(damageAtDistance(100)).toBe(splashDamage);
    expect(damageAtDistance(140)).toBe(splashDamage);
  });

  it('> 140：0', () => {
    expect(damageAtDistance(140.0001)).toBe(0);
    expect(damageAtDistance(9999)).toBe(0);
  });
});

describe('DamageSystem.calculate', () => {
  const system = new ConcreteDamageSystem();

  it('爆炸点在身体中心：距离 0 → 2 伤害', () => {
    const state = setupState();
    const result = system.calculate(state, explosionAt('P2', 0, 0));
    const p2 = result.players.find((p) => p.playerId === 'P2')!;
    expect(p2.distance).toBeCloseTo(0, 6);
    expect(p2.damage).toBe(directDamage);
    expect(p2.hpBefore).toBe(GAME_CONFIG.player.maxHp);
    expect(p2.hpAfter).toBe(GAME_CONFIG.player.maxHp - directDamage);
  });

  it('爆炸点在脚底正下方：距离 = 身高一半（38）→ 仍 2 伤害', () => {
    const state = setupState();
    const explosion = explosionAt('P1', 0, BODY_CENTER_OFFSET); // 脚底
    const result = system.calculate(state, explosion);
    const p1 = result.players.find((p) => p.playerId === 'P1')!;
    expect(p1.distance).toBeCloseTo(BODY_CENTER_OFFSET, 6);
    expect(p1.damage).toBe(directDamage);
  });

  it('水平距离分层：50 → 2；100 → 1；200 → 0', () => {
    const state = setupState();
    for (const [dx, expected] of [
      [50, directDamage],
      [100, splashDamage],
      [200, 0],
    ] as const) {
      const result = system.calculate(state, explosionAt('P1', dx));
      const p1 = result.players.find((p) => p.playerId === 'P1')!;
      expect(p1.damage, `dx=${dx}`).toBe(expected);
    }
  });

  it('两个玩家都在结果中，远端玩家为 0 伤害', () => {
    const state = setupState();
    const result = system.calculate(state, explosionAt('P1', 0));
    expect(result.players).toHaveLength(2);
    const p2 = result.players.find((p) => p.playerId === 'P2')!;
    expect(p2.damage).toBe(0); // P1 阵地爆炸远在 P2 之外
    expect(p2.hpAfter).toBe(p2.hpBefore);
  });

  it('已阵亡玩家不受伤（damage 0，hp 不变）', () => {
    const state = setupState();
    state.players.P1.isAlive = false;
    state.players.P1.hp = 0;
    const result = system.calculate(state, explosionAt('P1', 0));
    const p1 = result.players.find((p) => p.playerId === 'P1')!;
    expect(p1.damage).toBe(0);
    expect(p1.hpAfter).toBe(0);
  });

  it('hpAfter 不会低于 0（低血量 + 2 伤害 → 0）', () => {
    const state = setupState();
    state.players.P2.hp = 1;
    const result = system.calculate(state, explosionAt('P2', 0));
    const p2 = result.players.find((p) => p.playerId === 'P2')!;
    expect(p2.hpAfter).toBe(0);
  });

  it('爆炸事件原样透传到结果', () => {
    const state = setupState();
    const explosion = explosionAt('P2', 10, 0, 7);
    const result = system.calculate(state, explosion);
    expect(result.explosion).toEqual(explosion);
  });
});

describe('DamageSystem.apply', () => {
  const system = new ConcreteDamageSystem();

  it('结算写入 GameState：hp 下降、isAlive 保持', () => {
    const state = setupState();
    const result = system.calculate(state, explosionAt('P2', 30));
    system.apply(state, result);
    expect(state.players.P2.hp).toBe(GAME_CONFIG.player.maxHp - 2);
    expect(state.players.P2.isAlive).toBe(true);
    expect(state.gameOver).toBe(false);
    expect(state.winnerId).toBeNull();
  });

  it('hp 归零 → isAlive = false → gameOver + 对方获胜', () => {
    const state = setupState();
    state.players.P2.hp = 2;
    const result = system.calculate(state, explosionAt('P2', 0));
    system.apply(state, result);
    expect(state.players.P2.hp).toBe(0);
    expect(state.players.P2.isAlive).toBe(false);
    expect(state.gameOver).toBe(true);
    expect(state.winnerId).toBe('P1');
  });

  it('自爆（爆炸点在自己脚下）同样伤害自己并可触发 gameOver', () => {
    const state = setupState();
    state.players.P1.hp = 2;
    const result = system.calculate(state, explosionAt('P1', 0, 0));
    system.apply(state, result);
    expect(state.players.P1.hp).toBe(0);
    expect(state.players.P1.isAlive).toBe(false);
    expect(state.gameOver).toBe(true);
    expect(state.winnerId).toBe('P2');
  });

  it('同归于尽：winnerId = null', () => {
    const state = setupState();
    // 一次爆炸同时处于双方身体中心 60px 内（双方阵地不可能同时满足，
    // 这里手动构造事件验证规则本身）
    state.players.P1.hp = 1;
    state.players.P2.hp = 1;
    state.players.P2.x = state.players.P1.x + 100; // 拉近双方
    const explosion: ExplosionEvent = {
      sourcePlayerId: 'P1',
      weaponId: 'normal',
      x: (state.players.P1.x + state.players.P2.x) / 2,
      y: state.players.P1.y - BODY_CENTER_OFFSET,
      radius: GAME_CONFIG.explosion.radius,
      turnId: 1,
    };
    const result = system.calculate(state, explosion);
    system.apply(state, result);
    expect(state.players.P1.isAlive).toBe(false);
    expect(state.players.P2.isAlive).toBe(false);
    expect(state.gameOver).toBe(true);
    expect(state.winnerId).toBeNull();
  });

  it('无人受伤时 apply 不改变 gameOver', () => {
    const state = setupState();
    const result = system.calculate(state, explosionAt('P1', 500));
    system.apply(state, result);
    expect(state.gameOver).toBe(false);
    for (const id of PLAYER_IDS) {
      expect(state.players[id].hp).toBe(GAME_CONFIG.player.maxHp);
    }
  });
});
