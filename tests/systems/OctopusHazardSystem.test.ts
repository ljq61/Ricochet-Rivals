import { describe, expect, it } from 'vitest';
import { GAME_CONFIG } from '../../src/game/config/GameConfig';
import { createInitialGameState } from '../../src/game/state/GameState';
import { createOctopusState, isOctopusActive } from '../../src/game/state/OctopusState';
import type { ProjectileImpact } from '../../src/game/state/ExplosionEvent';
import { ConcreteDamageSystem } from '../../src/game/systems/DamageSystem';
import { ExplosionSystem } from '../../src/game/systems/ExplosionSystem';
import { resolveOctopusTurn } from '../../src/game/systems/OctopusHazardSystem';

const cfg = GAME_CONFIG.octopus;

function makeState() {
  return createInitialGameState({ matchId: 'octopus-test', seed: 125 });
}

function activeState(turnId = 2) {
  const state = makeState();
  state.players.P1.hp = 4;
  resolveOctopusTurn(state, null, null);
  state.turnId = turnId;
  return state;
}

function tentacleImpact(turnId: number, distance = 0): ProjectileImpact {
  return {
    ownerId: 'P1', weaponId: 'normal', turnId,
    x: cfg.x + cfg.width * cfg.collisionWidthRatio / 2 + distance,
    y: cfg.baseY - 100,
  };
}

describe('OctopusHazardSystem', () => {
  it('initial states have independent twenty-HP tentacles, not yet spawned', () => {
    const a = createOctopusState();
    const b = createOctopusState();
    expect(a).toEqual({ hp: 20, spawnTurnId: null, lastResolvedTurnId: 0,
      lastAttackTurnId: null, lastAttackTarget: null });
    expect(isOctopusActive(a)).toBe(false);
    a.hp = 1;
    expect(b.hp).toBe(20);
  });

  it('only spawns once a player reaches the threshold', () => {
    const state = makeState();
    expect(resolveOctopusTurn(state, null, null)).toBeNull();
    expect(state.octopus.spawnTurnId).toBeNull();
    expect(state.octopus.lastResolvedTurnId).toBe(1);
    state.turnId = 2;
    state.players.P2.hp = cfg.hpThreshold;
    resolveOctopusTurn(state, null, null);
    expect(state.octopus.spawnTurnId).toBe(2);
    expect(isOctopusActive(state.octopus)).toBe(true);
  });

  it('the spawning shot cannot damage the newly born tentacle', () => {
    const state = makeState();
    state.players.P1.hp = 4;
    resolveOctopusTurn(state, tentacleImpact(1), null);
    expect(state.octopus.hp).toBe(20);
    expect(state.octopus.lastAttackTurnId).toBeNull();
  });

  it.each([[0, 2], [60, 2], [60.01, 1], [140, 1], [140.01, 0]])(
    'tentacle AABB explosion distance %s deals %s HP', (distance, damage) => {
      const state = activeState();
      resolveOctopusTurn(state, tentacleImpact(2, distance), null);
      expect(state.octopus.hp).toBe(20 - damage);
    }
  );

  it('uses the real top edge instead of treating the tentacle as a point', () => {
    const state = activeState();
    const impact = tentacleImpact(2);
    impact.x = cfg.x;
    impact.y = cfg.baseY - cfg.height * cfg.collisionHeightRatio - 60;
    resolveOctopusTurn(state, impact, null);
    expect(state.octopus.hp).toBe(18);
  });

  it('turns before age five do not attack; the fifth and each later turn attack once', () => {
    const state = activeState();
    for (let turn = 2; turn <= 5; turn++) {
      state.turnId = turn;
      resolveOctopusTurn(state, null, null);
      expect(state.octopus.lastAttackTurnId).toBeNull();
    }
    for (let turn = 6; turn <= 8; turn++) {
      state.turnId = turn;
      const before = state.players.P1.hp + state.players.P2.hp;
      const result = resolveOctopusTurn(state, null, null)!;
      expect(state.players.P1.hp + state.players.P2.hp).toBe(before - 1);
      expect(state.octopus.lastAttackTurnId).toBe(turn);
      expect(result.players.reduce((sum, entry) => sum + entry.damage, 0)).toBe(1);
      expect(Number.isFinite(result.explosion.x)).toBe(true);
    }
  });

  it('repeated resolution and stale projectile callbacks cannot repeat damage', () => {
    const state = activeState(6);
    resolveOctopusTurn(state, tentacleImpact(6), null);
    const after = structuredClone(state);
    resolveOctopusTurn(state, tentacleImpact(6), null);
    expect(state).toEqual(after);
    state.turnId = 7;
    const pending = structuredClone(state);
    resolveOctopusTurn(state, tentacleImpact(6), null);
    expect(state).toEqual(pending);
    resolveOctopusTurn(state, null, null);
    expect(state.octopus.lastAttackTurnId).toBe(7);
  });

  it('ten direct hits defeat twenty HP, the killing hit suppresses its laser and it never respawns', () => {
    const state = activeState();
    state.players.P1.hp = 10;
    state.players.P2.hp = 10;
    for (let turn = 2; turn <= 10; turn++) {
      state.turnId = turn;
      resolveOctopusTurn(state, tentacleImpact(turn), null);
    }
    expect(state.octopus.hp).toBe(2);
    const hp = state.players.P1.hp + state.players.P2.hp;
    state.turnId = 11;
    resolveOctopusTurn(state, tentacleImpact(11), null);
    expect(state.octopus.hp).toBe(0);
    expect(isOctopusActive(state.octopus)).toBe(false);
    expect(state.octopus.lastAttackTurnId).toBe(10);
    expect(state.players.P1.hp + state.players.P2.hp).toBe(hp);
    state.turnId = 12;
    resolveOctopusTurn(state, null, null);
    expect(state.octopus.spawnTurnId).toBe(1);
    expect(state.octopus.hp).toBe(0);
    expect(state.players.P1.hp + state.players.P2.hp).toBe(hp);
  });

  it('deterministic targets survive state cloning and vary across seeds', () => {
    const original = activeState(6);
    const restored = structuredClone(original);
    expect(resolveOctopusTurn(original, null, null)).toEqual(resolveOctopusTurn(restored, null, null));
    expect(original).toEqual(restored);
    const targets = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) {
      const state = activeState(6);
      state.seed = seed;
      resolveOctopusTurn(state, null, null);
      targets.add(state.octopus.lastAttackTarget!);
    }
    expect([...targets].sort()).toEqual(['P1', 'P2']);
  });

  it('combines shot and laser damage without mutating the original damage feedback', () => {
    const state = activeState(6);
    const probe = structuredClone(state);
    resolveOctopusTurn(probe, null, null);
    const target = probe.octopus.lastAttackTarget!;
    const player = state.players[target];
    const impact = { ...tentacleImpact(6), x: player.x, y: player.y - 90 };
    const shot = new ExplosionSystem({ damage: new ConcreteDamageSystem() }).explode(state, impact);
    const saved = structuredClone(shot);
    const combined = resolveOctopusTurn(state, impact, shot)!;
    const entry = combined.players.find((entry) => entry.playerId === target)!;
    expect(entry.damage).toBe(3);
    expect(entry.hpAfter).toBe(entry.hpBefore - 3);
    expect(state.players[target].hp).toBe(entry.hpAfter);
    expect(shot).toEqual(saved);
  });

  it('a lethal laser ends the game and selects the other player as winner', () => {
    const state = activeState(6);
    const probe = structuredClone(state);
    resolveOctopusTurn(probe, null, null);
    const target = probe.octopus.lastAttackTarget!;
    state.players[target].hp = 1;
    const result = resolveOctopusTurn(state, null, null)!;
    expect(state.players[target].hp).toBe(0);
    expect(state.players[target].isAlive).toBe(false);
    expect(state.gameOver).toBe(true);
    expect(state.winnerId).toBe(target === 'P1' ? 'P2' : 'P1');
    expect(result.players.find((entry) => entry.playerId === target)?.damage).toBe(1);
  });

  it('player explosion wins first and suppresses a hazard laser on that turn', () => {
    const state = activeState(6);
    state.players.P2.hp = 1;
    const impact = { ...tentacleImpact(6), x: state.players.P2.x, y: state.players.P2.y - 90 };
    const shot = new ExplosionSystem({ damage: new ConcreteDamageSystem() }).explode(state, impact);
    expect(state.gameOver).toBe(true);
    expect(resolveOctopusTurn(state, impact, shot)).toBe(shot);
    expect(state.players.P1.hp).toBe(4);
    expect(state.octopus.lastAttackTurnId).toBeNull();
  });

  it('destroyed tentacles retain the last laser history for snapshots', () => {
    const state = activeState(6);
    resolveOctopusTurn(state, null, null);
    const target = state.octopus.lastAttackTarget;
    state.octopus.hp = 1;
    state.turnId = 7;
    resolveOctopusTurn(state, tentacleImpact(7), null);
    expect(state.octopus.hp).toBe(0);
    expect(state.octopus.lastAttackTarget).toBe(target);
    expect(state.octopus.lastAttackTurnId).toBe(6);
  });

  it('continued lasers always finish an otherwise stalled match', () => {
    const state = activeState(6);
    const totalHp = state.players.P1.hp + state.players.P2.hp;
    for (let turn = 6; turn < 6 + totalHp; turn++) {
      state.turnId = turn;
      resolveOctopusTurn(state, null, null);
      if (state.gameOver) break;
    }
    expect(state.gameOver).toBe(true);
    expect(state.winnerId).not.toBeNull();
  });
});
