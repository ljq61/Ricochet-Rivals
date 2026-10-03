import { afterEach, describe, expect, it } from 'vitest';
import {
  applyAuthoritativeSnapshot,
  applyTurnResult,
  buildSnapshot,
  buildTurnResultPayload,
  computeStateHash,
  stateFromSnapshot,
  STATE_HASH_VERSION,
} from '../../../src/game/network/online/AuthoritativeState';
import {
  isAuthoritativeGameSnapshot,
  isAuthoritativeOctopusSnapshot,
  isTurnResultPayload,
} from '../../../src/game/network/online/OnlinePayloads';
import { validateAuthoritativeSnapshot } from '../../../src/game/network/online/sync/SnapshotValidator';
import { NetworkMessageType } from '../../../src/game/network/NetworkMessageType';
import { createInitialGameState, type GameState } from '../../../src/game/state/GameState';
import type { OctopusState } from '../../../src/game/state/OctopusState';
import { TurnPhase } from '../../../src/game/state/TurnPhase';
import { resolveOctopusTurn } from '../../../src/game/systems/OctopusHazardSystem';
import { createOnlineHarness, type OnlineHarness } from '../onlineHarness';

function agedTentacle(): GameState {
  const state = createInitialGameState({ matchId: 'm', seed: 7 });
  state.turnId = 6;
  state.phase = TurnPhase.PROJECTILE;
  state.players.P1.hp = 4;
  state.players.P1.hasFired = true;
  state.octopus.spawnTurnId = 1;
  state.octopus.lastResolvedTurnId = 5;
  return state;
}

describe('Octopus authoritative state projection', () => {
  it('preserves HP/death/laser history through JSON and makes independent copies', () => {
    const host = agedTentacle();
    host.turnId = 8;
    host.octopus = { hp: 0, spawnTurnId: 1, lastResolvedTurnId: 8, lastAttackTurnId: 7, lastAttackTarget: 'P2' };
    const snapshot = buildSnapshot(host);
    expect(snapshot.octopus).not.toBe(host.octopus);
    const wire: unknown = JSON.parse(JSON.stringify(snapshot));
    expect(isAuthoritativeGameSnapshot(wire)).toBe(true);
    if (!isAuthoritativeGameSnapshot(wire)) throw new Error('invalid snapshot');
    const guest = stateFromSnapshot(wire);
    expect(guest).toEqual(host);
    expect(guest.octopus).not.toBe(wire.octopus);
    expect(computeStateHash(guest)).toBe(computeStateHash(host));
    guest.octopus.hp = 9;
    expect(host.octopus.hp).toBe(0);
    expect(wire.octopus.hp).toBe(0);
  });

  it('reconciles a laser on an out-of-bounds shot, including HP/damage and final hash', () => {
    const host = agedTentacle();
    const guest = stateFromSnapshot(buildSnapshot(host));
    const result = resolveOctopusTurn(host, null, null);
    host.phase = guest.phase = TurnPhase.RESOLVE;
    const payload = buildTurnResultPayload(host, null, result);
    expect(isTurnResultPayload(payload)).toBe(true);
    expect(payload.impact).toBeNull();
    expect(payload.damages.P1 + payload.damages.P2).toBe(1);
    const hazardRef = guest.octopus;
    guest.octopus.hp = 1;
    guest.octopus.lastAttackTarget = 'P1';
    expect(applyTurnResult(guest, payload).hashMatch).toBe(true);
    expect(guest.octopus).toBe(hazardRef);
    expect(guest.octopus).toEqual(host.octopus);
    expect(guest.octopus).not.toBe(payload.octopus);
    expect(guest.players).toEqual(host.players);
  });

  it('snapshot recovery restores a dead tentacle without reviving it or losing deduplication history', () => {
    const host = agedTentacle();
    host.turnId = 8;
    host.octopus = { hp: 0, spawnTurnId: 1, lastResolvedTurnId: 8, lastAttackTurnId: 7, lastAttackTarget: 'P2' };
    const snapshot = buildSnapshot(host);
    const stateHash = computeStateHash(host);
    expect(validateAuthoritativeSnapshot({ snapshot, stateHash, generatedAtTurnId: 8 }, { expectedMatchId: 'm' }).ok).toBe(true);
    const guest = agedTentacle();
    const hazardRef = guest.octopus;
    expect(applyAuthoritativeSnapshot(guest, snapshot).stateHash).toBe(stateHash);
    expect(guest.octopus).toBe(hazardRef);
    expect(guest.octopus).toEqual(host.octopus);
  });

  it.each([
    ['hp', 9], ['spawnTurnId', 2], ['lastResolvedTurnId', 4],
    ['lastAttackTurnId', 6], ['lastAttackTarget', 'P2'],
  ] as const)('hash v5 includes %s', (key, value) => {
    const original = agedTentacle();
    const changed = structuredClone(original);
    (changed.octopus as Record<keyof OctopusState, number | string | null>)[key] = value;
    expect(STATE_HASH_VERSION).toBe('v5');
    expect(computeStateHash(changed)).not.toBe(computeStateHash(original));
  });
});

describe('Octopus untrusted wire validation', () => {
  const sample: OctopusState = { hp: 8, spawnTurnId: 1, lastResolvedTurnId: 8, lastAttackTurnId: 7, lastAttackTarget: 'P1' };

  it.each(['hp', 'spawnTurnId', 'lastResolvedTurnId', 'lastAttackTurnId', 'lastAttackTarget'] as const)('requires %s in both snapshot and turn result', (field) => {
    const host = agedTentacle();
    const snapshot = buildSnapshot(host);
    const result = buildTurnResultPayload(host, null, null);
    delete (snapshot.octopus as Partial<OctopusState>)[field];
    delete (result.octopus as Partial<OctopusState>)[field];
    expect(isAuthoritativeGameSnapshot(snapshot)).toBe(false);
    expect(isTurnResultPayload(result)).toBe(false);
  });

  it.each([
    { hp: -1 }, { hp: 16 }, { hp: 1.5 }, { hp: Number.NaN },
    { spawnTurnId: 0 }, { spawnTurnId: 9 }, { spawnTurnId: null },
    { lastResolvedTurnId: -1 }, { lastResolvedTurnId: 9 }, { lastResolvedTurnId: 1.5 },
    { lastAttackTurnId: 5 }, { lastAttackTurnId: 9 }, { lastAttackTurnId: null },
    { lastAttackTarget: null }, { lastAttackTarget: 'P3' },
  ])('rejects contradictory/out-of-range history %j', (change) => {
    expect(isAuthoritativeOctopusSnapshot({ ...sample, ...change }, 8)).toBe(false);
  });

  it('accepts an unspawned hazard and historical attacks after death; rejects partial attack pairs', () => {
    expect(isAuthoritativeOctopusSnapshot({ hp: 15, spawnTurnId: null, lastResolvedTurnId: 2, lastAttackTurnId: null, lastAttackTarget: null }, 2)).toBe(true);
    expect(isAuthoritativeOctopusSnapshot({ ...sample, hp: 0 }, 8)).toBe(true);
    expect(isAuthoritativeOctopusSnapshot({ ...sample, hp: 0, lastAttackTurnId: 8 }, 8)).toBe(false);
    expect(isAuthoritativeOctopusSnapshot({ ...sample, lastAttackTurnId: null, lastAttackTarget: null }, 8)).toBe(true);
    expect(isAuthoritativeOctopusSnapshot({ hp: 9, spawnTurnId: null, lastResolvedTurnId: 2, lastAttackTurnId: null, lastAttackTarget: null }, 2)).toBe(false);
  });

  it('accepts a spawned tentacle up to 15 HP and rejects 16 HP at both wire entry points', () => {
    const host = agedTentacle();
    host.octopus.hp = 15;
    const snapshot = buildSnapshot(host);
    const result = buildTurnResultPayload(host, null, null);
    expect(isAuthoritativeGameSnapshot(snapshot)).toBe(true);
    expect(isTurnResultPayload(result)).toBe(true);
    expect(isAuthoritativeGameSnapshot({ ...snapshot, octopus: { ...snapshot.octopus, hp: 16 } })).toBe(false);
    expect(isTurnResultPayload({ ...result, octopus: { ...result.octopus, hp: 16 } })).toBe(false);
  });
});

let harness: OnlineHarness | undefined;
afterEach(() => { harness?.dispose(); harness = undefined; });

describe('Octopus two-peer authority and recovery', () => {
  async function ready(): Promise<OnlineHarness> {
    harness = await createOnlineHarness();
    for (const state of [harness.hostState, harness.guestState]) {
      Object.assign(state, agedTentacle());
    }
    return harness;
  }

  it('Guest never applies prediction damage; Host laser result reconciles exactly once', async () => {
    const h = await ready();
    const explosion = { sourcePlayerId: 'P1' as const, weaponId: 'normal' as const, x: h.guestState.players.P2.x, y: h.guestState.players.P2.y, radius: 140, turnId: 6 };
    const prediction = h.guestCoord.damageSystem.calculate(h.guestState, explosion);
    h.guestCoord.damageSystem.apply(h.guestState, prediction);
    expect(h.guestState.players.P2.hp).toBe(10);
    const result = resolveOctopusTurn(h.hostState, null, null);
    h.hostTurn.notifyProjectileResolved(result);
    h.guestTurn.notifyProjectileResolved(prediction);
    h.guestCoord.notifyTurnResolved(null, prediction);
    h.hostCoord.notifyTurnResolved(null, result);
    await h.flush();
    expect(h.guestState).toEqual(h.hostState);
    expect(h.guestShowDamage).toHaveBeenCalledTimes(1);
    expect(h.guestShowDamage.mock.calls[0]![0].players.reduce((sum, p) => sum + p.damage, 0)).toBe(1);
    expect(h.guestCoord.debugInfo().lastHashMatch).toBe(true);
    h.hostNm.send(NetworkMessageType.TURN_RESULT, buildTurnResultPayload(h.hostState, null, result));
    await h.flush();
    expect(h.guestShowDamage).toHaveBeenCalledTimes(1);
    expect(h.guestState.octopus.lastAttackTurnId).toBe(6);
  });

  it('connection recovery replaces guessed hazard HP with Host death and historical laser', async () => {
    const h = await ready();
    h.hostState.turnId = 8;
    h.hostState.phase = TurnPhase.ACTION;
    h.hostState.octopus = { hp: 0, spawnTurnId: 1, lastResolvedTurnId: 7, lastAttackTurnId: 6, lastAttackTarget: 'P2' };
    h.guestState.octopus.hp = 10;
    h.guestCoord.requestPostReconnectSync();
    await h.flush();
    expect(h.guestState.octopus).toEqual(h.hostState.octopus);
    expect(h.guestSnapshotApplied).toHaveBeenCalledTimes(1);
    expect(h.guestCoord.getSyncDiagnostics().recoveryCount).toBe(1);
    expect(computeStateHash(h.guestState)).toBe(computeStateHash(h.hostState));
  });

  it('Host explosion destroys the tentacle before its scheduled laser, and Guest receives the same death', async () => {
    const h = await ready();
    h.hostState.octopus.hp = h.guestState.octopus.hp = 2;
    const impact = { x: 2500, y: 800, ownerId: 'P1' as const, weaponId: 'normal' as const, turnId: 6 };
    const explosion = { sourcePlayerId: 'P1' as const, weaponId: 'normal' as const, x: impact.x, y: impact.y, radius: 140, turnId: 6 };
    const original = h.hostCoord.damageSystem.calculate(h.hostState, explosion);
    h.hostCoord.damageSystem.apply(h.hostState, original);
    const result = resolveOctopusTurn(h.hostState, impact, original);
    h.hostTurn.notifyProjectileResolved(result);
    h.guestTurn.notifyProjectileResolved(original);
    h.guestCoord.notifyTurnResolved(impact, original);
    h.hostCoord.notifyTurnResolved(impact, result);
    await h.flush();
    expect(h.hostState.octopus.hp).toBe(0);
    expect(h.guestState.octopus).toEqual(h.hostState.octopus);
    expect(h.guestState.octopus.lastAttackTurnId).toBeNull();
    expect(h.guestState.players).toEqual(h.hostState.players);
    expect(computeStateHash(h.guestState)).toBe(computeStateHash(h.hostState));
  });

  it('a lethal laser result arriving during Guest flight waits for local resolution and confirms without snapshot recovery', async () => {
    const h = await ready();
    for (const state of [h.hostState, h.guestState]) state.players.P1.hp = state.players.P2.hp = 1;
    const result = resolveOctopusTurn(h.hostState, null, null);
    h.hostTurn.notifyProjectileResolved(result);
    h.hostCoord.notifyTurnResolved(null, result);
    await h.flush();
    expect(h.hostState.phase).toBe(TurnPhase.GAME_OVER);
    expect(h.guestState.gameOver).toBe(true);
    expect(h.guestState.phase).toBe(TurnPhase.PROJECTILE);
    expect(h.guestCoord.isFinalStateConfirmed()).toBe(false);
    expect(h.guestShowDamage).not.toHaveBeenCalled();
    expect(h.guestSnapshotApplied).not.toHaveBeenCalled();
    h.guestTurn.notifyProjectileResolved(null);
    h.guestCoord.notifyTurnResolved(null, null);
    await h.flush();
    expect(h.guestState.phase).toBe(TurnPhase.GAME_OVER);
    expect(h.guestCoord.isFinalStateConfirmed()).toBe(true);
    expect(h.guestCoord.debugInfo().lastHashMatch).toBe(true);
    expect(h.guestShowDamage).toHaveBeenCalledTimes(1);
    expect(h.guestSnapshotApplied).not.toHaveBeenCalled();
    expect(h.guestCoord.getSyncDiagnostics().recoveryCount).toBe(0);
    expect(h.guestState).toEqual(h.hostState);
  });

  it.each([TurnPhase.RESOLVE, TurnPhase.END])('a lethal laser arriving late in %s confirms GAME_OVER without canceling its presentation', async (phase) => {
    const h = await ready();
    for (const state of [h.hostState, h.guestState]) state.players.P1.hp = state.players.P2.hp = 1;
    h.guestTurn.notifyProjectileResolved(null);
    h.guestCoord.notifyTurnResolved(null, null);
    h.guestState.phase = phase;
    const result = resolveOctopusTurn(h.hostState, null, null);
    h.hostTurn.notifyProjectileResolved(result);
    h.hostCoord.notifyTurnResolved(null, result);
    await h.flush();
    expect(h.guestState.phase).toBe(TurnPhase.GAME_OVER);
    expect(h.guestCoord.isFinalStateConfirmed()).toBe(true);
    expect(h.guestCoord.debugInfo().lastHashMatch).toBe(true);
    expect(h.guestShowDamage).toHaveBeenCalledTimes(1);
    expect(h.guestSnapshotApplied).not.toHaveBeenCalled();
    expect(h.guestState).toEqual(h.hostState);
  });

  it('a nonlethal result arriving during Guest flight preserves the projectile and resumes the ordinary ACK barrier afterward', async () => {
    const h = await ready();
    const result = resolveOctopusTurn(h.hostState, null, null);
    h.hostTurn.notifyProjectileResolved(result);
    h.hostCoord.notifyTurnResolved(null, result);
    await h.flush();
    expect(h.guestState.phase).toBe(TurnPhase.PROJECTILE);
    expect(h.guestSnapshotApplied).not.toHaveBeenCalled();
    expect(h.hostCoord.onLocalAttackResolved()).toBe('waiting');
    h.guestTurn.notifyProjectileResolved(null);
    h.guestCoord.notifyTurnResolved(null, null);
    await h.flush();
    expect(h.guestCoord.debugInfo().lastHashMatch).toBe(true);
    expect(h.guestShowDamage).toHaveBeenCalledTimes(1);
    expect(h.guestSnapshotApplied).not.toHaveBeenCalled();
    expect(h.hostResume).toHaveBeenCalledTimes(1);
    expect(h.guestCoord.onLocalAttackResolved()).toBe('proceed');
    expect(h.guestState.turnId).toBe(7);
  });

  it('a snapshot replacing an unfinished local flight clears old damage before the next turn resolves', async () => {
    const h = await ready();
    let result = resolveOctopusTurn(h.hostState, null, null);
    h.hostTurn.notifyProjectileResolved(result);
    h.hostCoord.notifyTurnResolved(null, result);
    await h.flush();
    expect(h.guestState.phase).toBe(TurnPhase.PROJECTILE);
    h.guestCoord.requestPostReconnectSync();
    await h.flush();
    expect(h.guestSnapshotApplied).toHaveBeenCalledTimes(1);
    expect(h.guestState.phase).toBe(TurnPhase.RESOLVE);
    expect(h.guestShowDamage).not.toHaveBeenCalled();
    expect(h.hostCoord.onLocalAttackResolved()).toBe('proceed');
    h.hostTurn.endTurn();
    await h.flush();
    h.hostTurn.notifyTurnTransitionComplete();
    h.guestTurn.notifyTurnTransitionComplete();
    expect(h.guestState.turnId).toBe(7);
    h.hostTurn.notifyProjectileLaunched();
    h.guestTurn.notifyProjectileLaunched();
    h.guestTurn.notifyProjectileResolved(null);
    h.guestCoord.notifyTurnResolved(null, null);
    expect(h.guestShowDamage).not.toHaveBeenCalled();
    result = resolveOctopusTurn(h.hostState, null, null);
    h.hostTurn.notifyProjectileResolved(result);
    h.hostCoord.notifyTurnResolved(null, result);
    await h.flush();
    expect(h.guestShowDamage).toHaveBeenCalledTimes(1);
    expect(h.guestShowDamage.mock.calls[0]![0].explosion.turnId).toBe(7);
    expect(h.guestState.octopus).toEqual(h.hostState.octopus);
    expect(h.guestCoord.debugInfo().lastHashMatch).toBe(true);
  });

  it('a new-sequence duplicate cannot leave old damage pending for the next turn', async () => {
    const h = await ready();
    let result = resolveOctopusTurn(h.hostState, null, null);
    h.hostTurn.notifyProjectileResolved(result);
    h.guestTurn.notifyProjectileResolved(null);
    h.guestCoord.notifyTurnResolved(null, null);
    h.hostCoord.notifyTurnResolved(null, result);
    await h.flush();
    expect(h.guestShowDamage).toHaveBeenCalledTimes(1);
    h.hostNm.send(NetworkMessageType.TURN_RESULT, buildTurnResultPayload(h.hostState, null, result));
    await h.flush();
    expect(h.guestShowDamage).toHaveBeenCalledTimes(1);
    expect(h.guestCoord.onLocalAttackResolved()).toBe('waiting');
    expect(h.hostCoord.onLocalAttackResolved()).toBe('proceed');
    h.hostTurn.endTurn();
    await h.flush();
    h.hostTurn.notifyTurnTransitionComplete();
    h.guestTurn.notifyTurnTransitionComplete();
    h.hostTurn.notifyProjectileLaunched();
    h.guestTurn.notifyProjectileLaunched();
    h.guestTurn.notifyProjectileResolved(null);
    h.guestCoord.notifyTurnResolved(null, null);
    expect(h.guestShowDamage).toHaveBeenCalledTimes(1); // No ghost turn-6 damage.
    result = resolveOctopusTurn(h.hostState, null, null);
    h.hostTurn.notifyProjectileResolved(result);
    h.hostCoord.notifyTurnResolved(null, result);
    await h.flush();
    expect(h.guestShowDamage.mock.calls.map(([entry]) => entry.explosion.turnId)).toEqual([6, 7]);
    expect(h.guestCoord.debugInfo().lastHashMatch).toBe(true);
  });

  it.each([false, true])('a PROJECTILE snapshot without local flight can receive the next authoritative laser result (lethal=%s)', async (lethal) => {
    const h = await ready();
    if (lethal) {
      for (const state of [h.hostState, h.guestState]) state.players.P1.hp = state.players.P2.hp = 1;
    }
    h.guestCoord.requestPostReconnectSync();
    await h.flush();
    expect(h.guestState.phase).toBe(TurnPhase.PROJECTILE);
    expect(h.guestSnapshotApplied).toHaveBeenCalledTimes(1);
    const result = resolveOctopusTurn(h.hostState, null, null);
    h.hostTurn.notifyProjectileResolved(result);
    h.hostCoord.notifyTurnResolved(null, result);
    await h.flush(); // Guest has no local flight/resolve callback after the snapshot.
    expect(h.guestState.phase).toBe(lethal ? TurnPhase.GAME_OVER : TurnPhase.RESOLVE);
    expect(h.guestState).toEqual(h.hostState);
    expect(h.guestCoord.debugInfo().lastHashMatch).toBe(true);
    expect(h.guestCoord.isFinalStateConfirmed()).toBe(lethal);
    expect(h.guestCoord.getSyncDiagnostics().recoveryCount).toBe(1);
    expect(h.guestSnapshotApplied).toHaveBeenCalledTimes(1);
    expect(h.guestShowDamage).toHaveBeenCalledTimes(1);
    if (!lethal) {
      expect(h.hostCoord.onLocalAttackResolved()).toBe('proceed');
      h.hostTurn.endTurn();
      await h.flush();
      expect(h.guestState.turnId).toBe(7);
    }
  });

  it('new-sequence stale TURN_RESULT and STATE_SNAPSHOT cannot revive or replay a tentacle', async () => {
    const h = await ready();
    const oldState = agedTentacle();
    oldState.phase = TurnPhase.RESOLVE;
    const oldResult = buildTurnResultPayload(oldState, null, null);
    const oldSnapshot = buildSnapshot(oldState);
    const oldHash = computeStateHash(oldState);
    h.hostState.turnId = 8;
    h.hostState.phase = TurnPhase.ACTION;
    h.hostState.octopus = { hp: 0, spawnTurnId: 1, lastResolvedTurnId: 7, lastAttackTurnId: 6, lastAttackTarget: 'P2' };
    h.guestCoord.requestPostReconnectSync();
    await h.flush();
    const before = computeStateHash(h.guestState);
    h.hostNm.setTurnId(6);
    h.hostNm.send(NetworkMessageType.TURN_RESULT, oldResult);
    h.hostNm.send(NetworkMessageType.STATE_SNAPSHOT, { snapshot: oldSnapshot, stateHash: oldHash, generatedAtTurnId: 6 });
    await h.flush();
    expect(computeStateHash(h.guestState)).toBe(before);
    expect(h.guestState.octopus.hp).toBe(0);
    expect(h.guestSnapshotApplied).toHaveBeenCalledTimes(1);
    expect(h.guestShowDamage).not.toHaveBeenCalled();
  });
});
