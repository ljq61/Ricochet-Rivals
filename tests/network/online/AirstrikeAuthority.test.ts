import { afterEach, describe, expect, it, vi } from 'vitest';
import { GAME_CONFIG } from '../../../src/game/config/GameConfig';
import { NetworkMessageType } from '../../../src/game/network/NetworkMessageType';
import { applyAuthoritativeSnapshot, buildSnapshot, computeStateHash, stateFromSnapshot } from '../../../src/game/network/online/AuthoritativeState';
import { buildItemStatePayload } from '../../../src/game/network/online/ItemAuthority';
import { isAuthoritativeGameSnapshot, isItemStatePayload } from '../../../src/game/network/online/OnlinePayloads';
import { ONLINE_RULES_VERSION } from '../../../src/game/network/online/OnlineTypes';
import { OnlineSyncState } from '../../../src/game/network/online/sync/OnlineSyncState';
import { createInitialGameState } from '../../../src/game/state/GameState';
import { TurnPhase } from '../../../src/game/state/TurnPhase';
import { ItemSystem } from '../../../src/game/systems/ItemSystem';
import { advanceToP2Turn, createOnlineHarness, type OnlineHarness } from '../onlineHarness';

let harness: OnlineHarness | undefined;
afterEach(() => { harness?.dispose(); harness = undefined; vi.useRealTimers(); vi.restoreAllMocks(); });

async function make(owner: 'P1' | 'P2' = 'P2', phase: TurnPhase.ACTION | TurnPhase.AIM = TurnPhase.ACTION): Promise<OnlineHarness> {
  harness = await createOnlineHarness();
  if (owner === 'P2') advanceToP2Turn(harness);
  for (const state of [harness.hostState, harness.guestState]) {
    state.phase = phase;
    state.players[owner].inventory[0] = { id: 'strike-1', type: 'airstrike' };
  }
  return harness;
}

function use(h: OnlineHarness, owner: 'P1' | 'P2' = 'P2') {
  (owner === 'P2' ? h.guestCoord : h.hostCoord).inputBus.dispatch({ type: 'USE_ITEM', playerId: owner,
    turnId: h.hostState.turnId, itemId: 'strike-1', operationId: 'strike-op' });
}
function fire(h: OnlineHarness) {
  return { type: 'FIRE' as const, playerId: 'P2' as const, turnId: h.guestState.turnId, weaponId: 'normal' as const,
    startX: h.guestState.players.P2.x, startY: h.guestState.players.P2.y - 64,
    velocityX: -1200, velocityY: -800, seed: h.guestState.seed };
}

function sample() {
  const state = createInitialGameState({ matchId: 'm', seed: 4 });
  state.phase = TurnPhase.ACTION;
  state.players.P1.inventory[0] = { id: 'strike-1', type: 'airstrike' };
  new ItemSystem().execute(state, { type: 'USE_ITEM', playerId: 'P1', turnId: 1, itemId: 'strike-1' });
  const context = state.pendingAirstrike!;
  return { state, context, payload: buildItemStatePayload(state, 'airstrike_start',
    { itemId: context.itemId, playerId: context.ownerId, airstrike: context }, 'strike-op') };
}

describe('airstrike authority and retained turn', () => {
  it('airstrike threshold births the same octopus on Guest without advancing either turn', async () => {
    const h = await make('P2');
    for (const state of [h.hostState, h.guestState]) state.players.P1.hp = 6;
    use(h);
    await h.flush();
    h.hostLogic.resolveAirstrike(h.hostState.pendingAirstrike!);
    await h.flush();
    expect(h.hostState.players.P1.hp).toBe(4);
    expect(h.hostState.octopus.spawnTurnId).toBe(h.hostState.turnId);
    expect(h.guestState.octopus).toEqual(h.hostState.octopus);
    expect(h.hostState.octopus.lastAttackTurnId).toBeNull();
    expect(h.hostState.turnId).toBe(h.guestState.turnId);
    expect(computeStateHash(h.hostState)).toBe(computeStateHash(h.guestState));
  });

  it('preserves real Guest AIM while Host remote turn is still ACTION', async () => {
    const h = await make('P2');
    h.guestState.phase = TurnPhase.AIM;
    use(h);
    await h.flush();
    expect(h.hostState.pendingAirstrike?.resumePhase).toBe(TurnPhase.AIM);
    h.hostLogic.resolveAirstrike(h.hostState.pendingAirstrike!);
    await h.flush();
    expect(h.hostState.phase).toBe(TurnPhase.AIM);
    expect(h.guestState.phase).toBe(TurnPhase.AIM);
    expect(computeStateHash(h.hostState)).toBe(computeStateHash(h.guestState));
    h.guestState.phase = TurnPhase.ACTION; // local cancel aim
    const x = h.hostState.players.P2.x;
    h.guestCoord.inputBus.dispatch({ type: 'MOVE', playerId: 'P2', turnId: h.guestState.turnId, targetX: x - 10 });
    await h.flush();
    expect(h.hostState.phase).toBe(TurnPhase.ACTION);
    expect(h.hostState.players.P2.x).toBeLessThan(x);
    h.guestCoord.inputBus.dispatch(fire(h));
    await h.flush();
    expect(h.hostLaunch).toHaveBeenCalledTimes(1);
  });

  it.each([TurnPhase.ACTION, TurnPhase.AIM] as const)('Guest waits for start, blocks input during flight, then resumes %s and can fire normally', async (phase) => {
    const h = await make('P2', phase);
    use(h);
    expect(h.guestCoord.itemUsePending).toBe(true);
    expect(h.guestState.phase).toBe(phase);
    h.guestCoord.inputBus.dispatch(fire(h));
    await h.flush();
    expect(h.guestCoord.itemUsePending).toBe(false);
    expect(h.hostState.phase).toBe(TurnPhase.AIRSTRIKE);
    expect(h.guestState.phase).toBe(TurnPhase.AIRSTRIKE);
    expect(h.guestState.pendingAirstrike).toEqual(h.hostState.pendingAirstrike);
    expect(computeStateHash(h.guestState)).toBe(computeStateHash(h.hostState));
    const before = structuredClone(h.hostState.players.P2);
    const enemyHp = h.hostState.players.P1.hp;
    h.guestCoord.inputBus.dispatch({ type: 'MOVE', playerId: 'P2', turnId: 1, targetX: before.x - 20 });
    h.guestCoord.inputBus.dispatch(fire(h));
    h.guestCoord.inputBus.dispatch({ type: 'USE_ITEM', playerId: 'P2', turnId: 1, itemId: 'another' });
    await h.flush();
    expect(h.hostState.players.P2).toEqual(before);
    expect(h.hostLaunch).not.toHaveBeenCalled();
    expect(h.guestLaunch).not.toHaveBeenCalled();
    const resolved = h.hostLogic.resolveAirstrike({ itemId: 'strike-1', turnId: 1 });
    expect(resolved).not.toBeNull();
    await h.flush();
    expect(h.hostState.players.P1.hp).toBeLessThan(enemyHp);
    expect(h.guestState.players.P1.hp).toBe(h.hostState.players.P1.hp);
    expect(h.guestState.phase).toBe(phase);
    expect(h.hostState.phase).toBe(phase);
    expect(h.guestState.turnId).toBe(1);
    expect(h.guestState.currentPlayerId).toBe('P2');
    expect(h.guestState.players.P2.hasFired).toBe(false);
    expect(h.guestState.players.P2.moveRemaining).toBe(before.moveRemaining);
    expect(h.guestState.pendingAirstrike).toBeNull();
    expect(h.guestItemStateApplied.mock.calls.map(([p]) => p.kind)).toEqual(['airstrike_start', 'airstrike_end']);
    expect(computeStateHash(h.guestState)).toBe(computeStateHash(h.hostState));
    expect(h.hostLogic.resolveAirstrike({ itemId: 'strike-1', turnId: 1 })).toBeNull();
    h.guestCoord.inputBus.dispatch(fire(h)); await h.flush();
    expect(h.hostLaunch).toHaveBeenCalledTimes(1);
    expect(h.guestLaunch).toHaveBeenCalledTimes(1);
  });

  it('Host local use broadcasts the same frozen context without a Guest intent', async () => {
    const h = await make('P1'); use(h, 'P1'); await h.flush();
    expect(h.guestState.pendingAirstrike).toEqual(h.hostState.pendingAirstrike);
    expect(h.guestState.phase).toBe(TurnPhase.AIRSTRIKE);
    h.hostLogic.resolveAirstrike(); await h.flush();
    expect(h.guestState.phase).toBe(TurnPhase.ACTION);
    expect(h.guestState.currentPlayerId).toBe('P1');
    expect(computeStateHash(h.guestState)).toBe(computeStateHash(h.hostState));
  });

  it('same-operation retries, wrong-item retries and delayed starts/ends cannot spend twice or revive a completed plane', async () => {
    const h = await make(); use(h); await h.flush();
    const context = structuredClone(h.hostState.pendingAirstrike!);
    const start = buildItemStatePayload(h.hostState, 'airstrike_start', { itemId: context.itemId, playerId: context.ownerId, airstrike: context }, 'strike-op');
    const request = { playerId: 'P2', itemId: 'strike-1', operationId: 'strike-op' };
    h.guestNm.send(NetworkMessageType.USE_ITEM_REQUEST, request); await h.flush();
    expect(h.guestItemStateApplied).toHaveBeenCalledTimes(1);
    h.guestNm.send(NetworkMessageType.USE_ITEM_REQUEST, { ...request, itemId: 'other' }); await h.flush();
    expect(h.guestRejected.mock.calls.at(-1)?.[0].reason).toBe('INVALID_ITEM');
    h.hostLogic.resolveAirstrike(); await h.flush();
    const hp = h.guestState.players.P1.hp;
    const end = buildItemStatePayload(h.hostState, 'airstrike_end', { itemId: context.itemId, playerId: context.ownerId, airstrike: context });
    h.hostNm.send(NetworkMessageType.ITEM_STATE, start);
    h.hostNm.send(NetworkMessageType.ITEM_STATE, end);
    h.guestNm.send(NetworkMessageType.USE_ITEM_REQUEST, request);
    await h.flush();
    expect(h.guestItemStateApplied).toHaveBeenCalledTimes(2);
    expect(h.guestState.phase).toBe(TurnPhase.ACTION);
    expect(h.guestState.players.P1.hp).toBe(hp);
    expect(h.guestState.pendingAirstrike).toBeNull();
  });

  it('in-flight reconnect snapshots restore pending context; completion applies once without replaying damage', async () => {
    const h = await make(); use(h); await h.flush();
    h.guestCoord.requestPostReconnectSync(); await h.flush(8);
    expect(h.guestSnapshotApplied).toHaveBeenCalledTimes(1);
    expect(h.guestCoord.syncState).toBe(OnlineSyncState.SYNCED_AFTER_RECOVERY);
    expect(h.guestState.phase).toBe(TurnPhase.AIRSTRIKE);
    expect(h.guestState.pendingAirstrike).toEqual(h.hostState.pendingAirstrike);
    h.hostLogic.resolveAirstrike(); await h.flush();
    expect(h.guestState.phase).toBe(TurnPhase.ACTION);
    expect(computeStateHash(h.guestState)).toBe(computeStateHash(h.hostState));
    expect(h.guestItemStateApplied.mock.calls.filter(([p]) => p.kind === 'airstrike_end')).toHaveLength(1);
  });

  it('a completed snapshot prevents an old start from returning to AIRSTRIKE', async () => {
    const h = await make(); use(h); await h.flush();
    const context = h.hostState.pendingAirstrike!;
    const start = buildItemStatePayload(h.hostState, 'airstrike_start', { itemId: context.itemId, playerId: context.ownerId, airstrike: context }, 'strike-op');
    h.hostLogic.resolveAirstrike(); await h.flush();
    h.guestCoord.requestPostReconnectSync(); await h.flush(8);
    h.hostNm.send(NetworkMessageType.ITEM_STATE, start); await h.flush();
    expect(h.guestState.phase).toBe(TurnPhase.ACTION);
    expect(h.guestState.pendingAirstrike).toBeNull();
    expect(h.guestItemStateApplied.mock.calls.filter(([p]) => p.kind === 'airstrike_start')).toHaveLength(1);
    expect(computeStateHash(h.guestState)).toBe(computeStateHash(h.hostState));
  });

  it('lethal strike final state is confirmed immediately without a TURN_RESULT or advancing turns', async () => {
    const h = await make();
    for (const state of [h.hostState, h.guestState]) state.players.P1.hp = 1;
    use(h); await h.flush(); h.hostLogic.resolveAirstrike(); await h.flush();
    expect(h.guestState.gameOver).toBe(true);
    expect(h.guestState.winnerId).toBe('P2');
    expect(h.guestState.phase).toBe(TurnPhase.GAME_OVER);
    expect(h.guestState.turnId).toBe(1);
    expect(h.guestCoord.isFinalStateConfirmed()).toBe(true);
    expect(computeStateHash(h.guestState)).toBe(computeStateHash(h.hostState));
  });
});

describe('airstrike wire shape and relationship guards', () => {
  it('pending snapshot is deeply copied, hash-covered and applies without executing effects', () => {
    const { state } = sample(); const snapshot = buildSnapshot(state);
    expect(ONLINE_RULES_VERSION).toBe('0.2-items-v3');
    expect(isAuthoritativeGameSnapshot(snapshot)).toBe(true);
    const restored = stateFromSnapshot(snapshot);
    expect(restored.pendingAirstrike).toEqual(state.pendingAirstrike);
    expect(restored.pendingAirstrike).not.toBe(snapshot.pendingAirstrike);
    expect(restored.pendingAirstrike?.target).not.toBe(snapshot.pendingAirstrike?.target);
    expect(computeStateHash(restored)).toBe(computeStateHash(state));
    restored.pendingAirstrike!.target.x += 1;
    expect(computeStateHash(restored)).not.toBe(computeStateHash(state));
    const untouched = createInitialGameState({ matchId: 'm', seed: 4 });
    applyAuthoritativeSnapshot(untouched, snapshot);
    expect(untouched.players.P2.hp).toBe(10);
    expect(untouched.pendingAirstrike).toEqual(state.pendingAirstrike);
  });

  it.each(['missing', 'owner', 'turn', 'target-x', 'target-y', 'resume', 'phase', 'used', 'inventory', 'accepted-shot', 'details', 'game-over'] as const)('rejects contradictory start context: %s', (caseName) => {
    const { payload } = sample(); const wire = structuredClone(payload) as unknown as Record<string, any>;
    if (caseName === 'missing') delete wire.pendingAirstrike;
    if (caseName === 'owner') wire.pendingAirstrike.ownerId = 'P2';
    if (caseName === 'turn') wire.pendingAirstrike.turnId = 2;
    if (caseName === 'target-x') wire.pendingAirstrike.target.x += 1;
    if (caseName === 'target-y') wire.pendingAirstrike.target.y = Infinity;
    if (caseName === 'resume') wire.pendingAirstrike.resumePhase = TurnPhase.PROJECTILE;
    if (caseName === 'phase') wire.phase = TurnPhase.ACTION;
    if (caseName === 'used') wire.players.P1.itemUsedThisTurn = false;
    if (caseName === 'inventory') wire.players.P1.inventory[0] = { id: 'strike-1', type: 'airstrike' };
    if (caseName === 'accepted-shot') wire.acceptedShot = { ownerId: 'P1', turnId: 1, homingActivated: false };
    if (caseName === 'details') wire.airstrike.resumePhase = TurnPhase.AIM;
    if (caseName === 'game-over') wire.gameOver = true;
    expect(isItemStatePayload(payload)).toBe(true);
    expect(isItemStatePayload(wire)).toBe(false);
  });

  it('both pending start target coordinates must match the authoritative enemy collision center', () => {
    const { state } = sample();
    const wire = buildSnapshot(state);
    expect(wire.pendingAirstrike?.target.y).toBe(wire.players.P2.y - GAME_CONFIG.player.collision.height / 2);
    expect(isAuthoritativeGameSnapshot({ ...wire, pendingAirstrike: { ...wire.pendingAirstrike!, target: { x: wire.players.P2.x + 1, y: wire.pendingAirstrike!.target.y } } })).toBe(false);
    expect(isAuthoritativeGameSnapshot({ ...wire, phase: TurnPhase.ACTION })).toBe(false);
    expect(isAuthoritativeGameSnapshot({ ...wire, pendingAirstrike: null })).toBe(false);
  });
});
