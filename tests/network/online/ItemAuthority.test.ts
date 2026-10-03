import { afterEach, describe, expect, it, vi } from 'vitest';
import { NetworkMessageType } from '../../../src/game/network/NetworkMessageType';
import { createLoopbackPair } from '../../../src/game/network/LocalLoopbackTransport';
import { NetworkManager } from '../../../src/game/network/NetworkManager';
import { OnlineGameCoordinator } from '../../../src/game/network/online/OnlineGameCoordinator';
import { ONLINE_RULES_VERSION } from '../../../src/game/network/online/OnlineTypes';
import { buildSnapshot, computeStateHash, stateFromSnapshot } from '../../../src/game/network/online/AuthoritativeState';
import { buildItemStatePayload, applyItemState } from '../../../src/game/network/online/ItemAuthority';
import { isAuthoritativeGameSnapshot, isItemStatePayload, isUseItemRequestPayload } from '../../../src/game/network/online/OnlinePayloads';
import { ItemSystem } from '../../../src/game/systems/ItemSystem';
import { createInitialGameState } from '../../../src/game/state/GameState';
import { TurnPhase } from '../../../src/game/state/TurnPhase';
import { OnlineSyncState } from '../../../src/game/network/online/sync/OnlineSyncState';
import type { WorldItemType } from '../../../src/game/state/ids';
import { advanceToP2Turn, createOnlineHarness, flushLoopback, type OnlineHarness } from '../onlineHarness';

let harness: OnlineHarness | undefined;
afterEach(() => { harness?.dispose(); harness = undefined; vi.useRealTimers(); vi.restoreAllMocks(); });

async function make(): Promise<OnlineHarness> { harness = await createOnlineHarness(); return harness; }
function equip(h: OnlineHarness, type: WorldItemType = 'heal', id = 'owned-1'): void {
  for (const state of [h.hostState, h.guestState]) {
    state.players.P2.hp = 5;
    state.players.P2.inventory[0] = { id, type };
  }
  advanceToP2Turn(h);
}
function fire(h: OnlineHarness, itemId?: string) {
  return { type: 'FIRE' as const, playerId: 'P2' as const, turnId: h.guestState.turnId,
    weaponId: 'normal' as const, startX: h.guestState.players.P2.x,
    startY: h.guestState.players.P2.y - 64, velocityX: -1200, velocityY: -800,
    seed: h.guestState.seed, ...(itemId === undefined ? {} : { itemId }) };
}

describe('V0.2 authoritative item intents', () => {
  it('heal remains pending without local mutation; FIRE is blocked until the authoritative acceptance', async () => {
    const h = await make(); equip(h);
    h.guestCoord.inputBus.dispatch({ type: 'USE_ITEM', playerId: 'P2', turnId: 1, itemId: 'owned-1', operationId: 'op-1' });
    expect(h.guestCoord.itemUsePending).toBe(true);
    expect(h.guestState.players.P2.hp).toBe(5);
    h.guestCoord.inputBus.dispatch(fire(h));
    expect(h.hostLaunch).not.toHaveBeenCalled();
    await h.flush();
    expect(h.guestCoord.itemUsePending).toBe(false);
    expect(h.hostState.players.P2.hp).toBe(7);
    expect(h.guestState.players.P2.hp).toBe(7);
    expect(h.guestState.players.P2.inventory).toEqual([null, null, null]);
    expect(h.guestState.players.P2.itemUsedThisTurn).toBe(true);
    expect(h.guestItemUsePendingChange.mock.calls).toEqual([[true], [false]]);
    h.guestCoord.inputBus.dispatch(fire(h)); await h.flush();
    expect(h.hostLaunch).toHaveBeenCalledTimes(1);
    expect(computeStateHash(h.hostState)).toBe(computeStateHash(h.guestState));
  });

  it('retries with a new sequence but the same operation ID cannot heal twice or consume another item', async () => {
    const h = await make(); equip(h);
    h.hostState.players.P2.inventory[1] = { id: 'owned-2', type: 'heal' };
    h.guestState.players.P2.inventory[1] = { id: 'owned-2', type: 'heal' };
    const request = { playerId: 'P2', itemId: 'owned-1', operationId: 'once' };
    h.guestNm.setTurnId(1); h.guestNm.send(NetworkMessageType.USE_ITEM_REQUEST, request); await h.flush();
    h.guestNm.send(NetworkMessageType.USE_ITEM_REQUEST, { ...request, itemId: 'owned-2' }); await h.flush();
    expect(h.hostState.players.P2.hp).toBe(7);
    expect(h.guestState.players.P2.hp).toBe(7);
    expect(h.hostState.players.P2.inventory[1]?.id).toBe('owned-2');
  });

  it.each(['full', 'not-owned', 'attack-item', 'used'] as const)('heal rejection %s clears pending and retains inventory', async (caseName) => {
    const h = await make(); equip(h, caseName === 'attack-item' ? 'range_boost' : 'heal');
    if (caseName === 'full') h.hostState.players.P2.hp = 10;
    if (caseName === 'used') h.hostState.players.P2.itemUsedThisTurn = true;
    h.guestCoord.inputBus.dispatch({ type: 'USE_ITEM', playerId: 'P2', turnId: 1,
      itemId: caseName === 'not-owned' ? 'other-owner' : 'owned-1', operationId: 'reject-me' });
    await h.flush();
    expect(h.guestCoord.itemUsePending).toBe(false);
    expect(h.guestRejected).toHaveBeenCalledTimes(1);
    expect(h.guestRejected.mock.calls[0]?.[0].operationId).toBe('reject-me');
    expect(h.hostState.players.P2.inventory[0]?.id).toBe('owned-1');
    expect(h.hostLaunch).not.toHaveBeenCalled();
  });

  it.each(['damage_boost', 'range_boost', 'homing'] as const)('accepted FIRE consumes %s once and creates the same shot context', async (type) => {
    const h = await make(); equip(h, type);
    h.guestCoord.inputBus.dispatch(fire(h, 'owned-1')); await h.flush();
    expect(h.hostState.players.P2.inventory[0]).toBeNull();
    expect(h.guestState.players.P2.inventory[0]).toBeNull();
    expect(h.hostState.acceptedShot?.itemType).toBe(type);
    expect(h.guestState.acceptedShot).toEqual(h.hostState.acceptedShot);
    expect(h.hostState.players.P2.itemUsedThisTurn).toBe(true);
    h.guestCoord.inputBus.dispatch(fire(h, 'owned-1')); await h.flush();
    expect(h.hostLaunch).toHaveBeenCalledTimes(1);
    expect(h.guestLaunch).toHaveBeenCalledTimes(1);
  });

  it('invalid attack item and stale/forged heal requests cannot mutate authority', async () => {
    const h = await make(); equip(h, 'damage_boost');
    h.guestCoord.inputBus.dispatch(fire(h, 'stolen')); await h.flush();
    expect(h.hostState.players.P2.inventory[0]?.id).toBe('owned-1');
    expect(h.hostLaunch).not.toHaveBeenCalled();
    h.guestNm.setTurnId(0);
    h.guestNm.send(NetworkMessageType.USE_ITEM_REQUEST, { playerId: 'P2', itemId: 'owned-1', operationId: 'old' });
    await h.flush();
    expect(h.guestRejected.mock.calls.at(-1)?.[0].reason).toBe('STALE_TURN');
    h.guestNm.setTurnId(1);
    h.guestNm.send(NetworkMessageType.USE_ITEM_REQUEST, { playerId: 'P1', itemId: 'owned-1', operationId: 'forged' });
    await h.flush();
    expect(h.guestRejected.mock.calls.at(-1)?.[0].reason).toBe('INVALID_PLAYER');
    expect(h.hostState.players.P2.hp).toBe(5);
  });

  it('lost heal intent times out into snapshot recovery instead of unlocking a speculative FIRE', async () => {
    const h = await make(); equip(h);
    const send = h.guestNm.send.bind(h.guestNm);
    vi.spyOn(h.guestNm, 'send').mockImplementation((type, payload) => {
      if (type !== NetworkMessageType.USE_ITEM_REQUEST) send(type, payload);
    });
    vi.useFakeTimers();
    h.guestCoord.inputBus.dispatch({ type: 'USE_ITEM', playerId: 'P2', turnId: 1, itemId: 'owned-1', operationId: 'lost' });
    await vi.advanceTimersByTimeAsync(8_050);
    expect(h.guestSnapshotApplied).toHaveBeenCalledTimes(1);
    expect(h.guestCoord.itemUsePending).toBe(false);
    expect(h.guestState.players.P2.hp).toBe(5);
    expect(h.guestState.players.P2.inventory[0]?.id).toBe('owned-1');
    expect(h.guestCoord.syncState).toBe(OnlineSyncState.SYNCED_AFTER_RECOVERY);
  });
});

describe('V0.2 events and complete recovery projections', () => {
  it('Host pickup enters only shooter inventory without replaying or consuming a current-shot modifier', async () => {
    const h = await make();
    for (const state of [h.hostState, h.guestState]) {
      state.turnId = 3; state.phase = TurnPhase.PROJECTILE;
      state.items = [{ id: 'crate', type: 'homing', x: 1600, y: 300, active: true, spawnTurnId: 3, expiresAtTurnId: 9 }];
      state.acceptedShot = { ownerId: 'P1', turnId: 3, homingActivated: false };
    }
    new ItemSystem().collectAlongSegment(h.hostState, 'P1', { x: 1500, y: 300 }, { x: 1700, y: 300 });
    h.hostCoord.notifyItemStateChanged('pickup', { itemId: 'crate', playerId: 'P1', x: 1600, y: 300 });
    await h.flush();
    expect(h.guestState.players.P1.inventory[0]).toEqual({ id: 'crate', type: 'homing' });
    expect(h.guestState.players.P2.inventory).toEqual([null, null, null]);
    expect(h.guestState.acceptedShot?.itemType).toBeUndefined();
    expect(h.guestState.items).toEqual([]);
    expect(h.guestLaunch).not.toHaveBeenCalled();
    expect(h.guestItemStateApplied.mock.calls[0]?.[0].x).toBe(1600);
  });

  it('pickup replay with a new envelope sequence cannot roll back a later pickup or repeat its toast', async () => {
    const h = await make();
    for (const state of [h.hostState, h.guestState]) {
      state.turnId = 3; state.phase = TurnPhase.PROJECTILE;
      state.items = [
        { id: 'first', type: 'heal', x: 1600, y: 300, active: true, spawnTurnId: 3, expiresAtTurnId: 9 },
        { id: 'second', type: 'homing', x: 1900, y: 300, active: true, spawnTurnId: 3, expiresAtTurnId: 9 },
      ];
    }
    const rules = new ItemSystem();
    rules.collectAlongSegment(h.hostState, 'P1', { x: 1500, y: 300 }, { x: 1700, y: 300 });
    const firstProjection = buildItemStatePayload(h.hostState, 'pickup', { itemId: 'first', playerId: 'P1' });
    h.hostCoord.notifyItemStateChanged('pickup', { itemId: 'first', playerId: 'P1' }); await h.flush();
    rules.collectAlongSegment(h.hostState, 'P1', { x: 1800, y: 300 }, { x: 2000, y: 300 });
    h.hostCoord.notifyItemStateChanged('pickup', { itemId: 'second', playerId: 'P1' }); await h.flush();
    h.hostNm.send(NetworkMessageType.ITEM_STATE, firstProjection); await h.flush();
    expect(h.guestState.players.P1.inventory[1]?.id).toBe('second');
    expect(h.guestState.items).toEqual([]);
    expect(h.guestItemStateApplied).toHaveBeenCalledTimes(2);
  });

  it('next-turn item state is queued while Guest dwells and applied after TURN_END, without Guest RNG', async () => {
    const h = await make();
    h.hostState.turnId = 2; h.guestState.turnId = 2;
    h.hostState.currentPlayerId = 'P2'; h.guestState.currentPlayerId = 'P2';
    h.hostState.itemGeneration.firstWindowParity = 0; h.guestState.itemGeneration.firstWindowParity = 0;
    h.hostTurn.notifyProjectileLaunched(); h.guestTurn.notifyProjectileLaunched();
    h.hostTurn.notifyProjectileResolved(null); h.guestTurn.notifyProjectileResolved(null);
    h.guestCoord.notifyTurnResolved(null, null);
    h.hostCoord.notifyTurnResolved(null, null); await h.flush();
    expect(h.hostCoord.onLocalAttackResolved()).toBe('proceed');
    h.hostTurn.endTurn();
    h.hostCoord.notifyItemStateChanged('turn_start'); await h.flush();
    expect(h.hostState.turnId).toBe(3);
    expect(h.hostState.items).toHaveLength(1);
    expect(h.guestState.turnId).toBe(2);
    expect(h.guestState.items).toEqual([]);
    expect(h.guestCoord.onLocalAttackResolved()).toBe('proceed');
    expect(h.guestState.items).toEqual(h.hostState.items);
    expect(h.guestState.itemGeneration).toEqual(h.hostState.itemGeneration);
    expect(computeStateHash(h.guestState)).toBe(computeStateHash(h.hostState));
  });

  it('snapshot restores items, bags, spawn pity and homing context without replaying FIRE or heal', async () => {
    const h = await make();
    h.hostState.turnId = 3; h.guestState.turnId = 3;
    h.hostState.phase = TurnPhase.PROJECTILE; h.guestState.phase = TurnPhase.PROJECTILE;
    h.hostState.players.P1.inventory[2] = { id: 'bag', type: 'damage_boost' };
    h.hostState.items = [{ id: 'crate', type: 'heal', x: 1700, y: 450, active: true, spawnTurnId: 3, expiresAtTurnId: 9 }];
    h.hostState.itemGeneration = { firstWindowParity: 1, lastWindowTurnId: 3, misses: 2, nextId: 5 };
    h.hostState.acceptedShot = { ownerId: 'P1', turnId: 3, itemId: 'spent', itemType: 'homing',
      homingActivated: true, homingTarget: { x: 4550, y: 870 } };
    h.guestCoord.requestPostReconnectSync(); await h.flush(8);
    expect(computeStateHash(h.guestState)).toBe(computeStateHash(h.hostState));
    expect(h.guestState.acceptedShot).toEqual(h.hostState.acceptedShot);
    expect(h.guestState.items).toEqual(h.hostState.items);
    expect(h.guestLaunch).not.toHaveBeenCalled();
    expect(h.guestSnapshotApplied).toHaveBeenCalledTimes(1);
    const hp = h.guestState.players.P1.hp;
    h.hostNm.send(NetworkMessageType.STATE_SNAPSHOT, { snapshot: buildSnapshot(h.hostState), stateHash: computeStateHash(h.hostState), generatedAtTurnId: 3 });
    await h.flush();
    expect(h.guestSnapshotApplied).toHaveBeenCalledTimes(1);
    expect(h.guestState.players.P1.hp).toBe(hp);
  });

  it('ACTION snapshot recovery still permits a later heal acceptance to clear pending', async () => {
    const h = await make(); equip(h);
    h.guestCoord.requestPostReconnectSync(); await h.flush(8);
    expect(h.guestState.phase).toBe(TurnPhase.ACTION);
    h.guestCoord.inputBus.dispatch({ type: 'USE_ITEM', playerId: 'P2', turnId: 1, itemId: 'owned-1', operationId: 'after-recovery' });
    await h.flush();
    expect(h.guestState.players.P2.hp).toBe(7);
    expect(h.guestCoord.itemUsePending).toBe(false);
    expect(h.guestState.players.P2.inventory[0]).toBeNull();
    expect(computeStateHash(h.guestState)).toBe(computeStateHash(h.hostState));
  });

  it('PROJECTILE snapshot recovery still applies subsequent pickup and homing authority events', async () => {
    const h = await make();
    h.hostState.turnId = 3; h.guestState.turnId = 3;
    h.hostState.phase = TurnPhase.PROJECTILE;
    h.hostState.items = [{ id: 'crate', type: 'heal', x: 1700, y: 450, active: true, spawnTurnId: 3, expiresAtTurnId: 9 }];
    h.hostState.acceptedShot = { ownerId: 'P1', turnId: 3, itemId: 'spent', itemType: 'homing', homingActivated: false };
    h.guestCoord.requestPostReconnectSync(); await h.flush(8);
    expect(h.guestState.phase).toBe(TurnPhase.PROJECTILE);
    new ItemSystem().collectAlongSegment(h.hostState, 'P1', { x: 1600, y: 450 }, { x: 1800, y: 450 });
    h.hostCoord.notifyItemStateChanged('pickup', { itemId: 'crate', playerId: 'P1' });
    h.hostState.acceptedShot!.homingActivated = true;
    h.hostState.acceptedShot!.homingTarget = { x: 4550, y: 870 };
    h.hostCoord.notifyItemStateChanged('homing', { itemId: 'spent', playerId: 'P1' });
    await h.flush();
    expect(h.guestState.players.P1.inventory[0]?.id).toBe('crate');
    expect(h.guestState.acceptedShot?.homingActivated).toBe(true);
    expect(h.guestState.acceptedShot?.homingTarget).toEqual({ x: 4550, y: 870 });
    expect(h.guestLaunch).not.toHaveBeenCalled();
    expect(computeStateHash(h.guestState)).toBe(computeStateHash(h.hostState));
  });

  it('a fresh rematch coordinator starts with empty inventories, no pending heal and reset spawn state', async () => {
    const h = await make(); equip(h);
    h.hostState.itemGeneration.misses = 2;
    h.hostState.itemGeneration.nextId = 17;
    h.guestCoord.inputBus.dispatch({ type: 'USE_ITEM', playerId: 'P2', turnId: 1, itemId: 'owned-1', operationId: 'old-pending' });
    expect(h.guestCoord.itemUsePending).toBe(true);
    h.dispose(); harness = undefined;
    const next = await make();
    expect(next.guestCoord.itemUsePending).toBe(false);
    expect(next.guestState.players.P1.inventory).toEqual([null, null, null]);
    expect(next.guestState.players.P2.inventory).toEqual([null, null, null]);
    expect(next.guestState.items).toEqual([]);
    expect(next.guestState.itemGeneration).toMatchObject({ misses: 0, nextId: 1, lastWindowTurnId: 0 });
    expect(next.guestState.acceptedShot).toBeNull();
    expect(next.guestState.players.P2.itemUsedThisTurn).toBe(false);
  });

  it('stale item events and old-match intents cannot restore a consumed crate', async () => {
    const h = await make();
    const stale = buildItemStatePayload(h.hostState, 'spawn');
    h.guestState.turnId = 2;
    h.hostNm.setTurnId(1); h.hostNm.send(NetworkMessageType.ITEM_STATE, stale); await h.flush();
    expect(h.guestItemStateApplied).not.toHaveBeenCalled();
    equip(h);
    h.guestTransport.send({ version: 1, type: NetworkMessageType.USE_ITEM_REQUEST, matchId: 'old-game', turnId: 1,
      senderId: 'P2', sequence: 999, timestamp: 1, payload: { playerId: 'P2', itemId: 'owned-1', operationId: 'old-game' } });
    await h.flush();
    expect(h.hostState.players.P2.hp).toBe(5);
    expect(h.hostState.players.P2.inventory[0]?.id).toBe('owned-1');
  });
});

describe('V0.2 input schemas and hash contract', () => {
  it('hash changes for inventory, turn budget, generation and accepted homing target; snapshots are detached', () => {
    const base = createInitialGameState({ matchId: 'm', seed: 4 });
    const hash = computeStateHash(base);
    for (const mutate of [
      (state: typeof base) => { state.players.P1.inventory[0] = { id: 'a', type: 'heal' }; },
      (state: typeof base) => { state.players.P1.itemUsedThisTurn = true; },
      (state: typeof base) => { state.itemGeneration.misses = 1; },
      (state: typeof base) => { state.itemGeneration.nextId = 5; },
      (state: typeof base) => { state.acceptedShot = { ownerId: 'P1', turnId: 1, itemId: 'spent', itemType: 'homing', homingActivated: true, homingTarget: { x: 4550, y: 870 } }; },
    ]) { const state = structuredClone(base); mutate(state); expect(computeStateHash(state)).not.toBe(hash); }
    base.players.P1.inventory[0] = { id: 'a', type: 'heal' };
    const snapshot = buildSnapshot(base); const restored = stateFromSnapshot(snapshot);
    restored.players.P1.inventory[0]!.type = 'range_boost';
    expect(snapshot.players.P1.inventory[0]?.type).toBe('heal');
    expect(base.players.P1.inventory[0]?.type).toBe('heal');
  });

  it('wire projection copies only declared generation fields and ignores prototype-shaped extra keys', () => {
    const state = createInitialGameState({ matchId: 'm', seed: 4 });
    const payload = buildItemStatePayload(state, 'turn_start');
    const withExtras = JSON.parse(JSON.stringify(payload).replace('"nextId":1', '"nextId":1,"unexpected":"ignored","__proto__":{"polluted":true}'));
    expect(isItemStatePayload(withExtras)).toBe(true);
    applyItemState(state, withExtras);
    expect(Object.keys(state.itemGeneration).sort()).toEqual(['firstWindowParity', 'lastWindowTurnId', 'misses', 'nextId']);
    expect(Object.getPrototypeOf(state.itemGeneration)).toBe(Object.prototype);
    expect((state.itemGeneration as unknown as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it('rejects invalid item IDs, duplicated ownership, malformed crates and homing coordinates', () => {
    const state = createInitialGameState({ matchId: 'm', seed: 4 });
    const sample = buildItemStatePayload(state, 'turn_start');
    expect(isItemStatePayload(sample)).toBe(true);
    expect(isUseItemRequestPayload({ playerId: 'P1', itemId: '', operationId: 'op' })).toBe(false);
    expect(isUseItemRequestPayload({ playerId: 'P1', itemId: 'a', operationId: 'x'.repeat(129) })).toBe(false);
    state.players.P1.inventory[0] = { id: 'a', type: 'heal' }; state.players.P2.inventory[0] = { id: 'a', type: 'homing' };
    expect(isAuthoritativeGameSnapshot(buildSnapshot(state))).toBe(false);
    state.players.P2.inventory[0] = null;
    const badSlot = structuredClone(sample); (badSlot.players.P1.inventory as unknown[]).push(null);
    expect(isItemStatePayload(badSlot)).toBe(false);
    state.turnId = 3;
    state.items = [{ id: 'crate', type: 'heal', x: Number.NaN, y: 300, active: true, spawnTurnId: 3, expiresAtTurnId: 9 }];
    expect(isAuthoritativeGameSnapshot(buildSnapshot(state))).toBe(false);
    state.items = []; state.acceptedShot = { ownerId: 'P1', turnId: 3, itemId: 'spent', itemType: 'homing', homingActivated: true,
      homingTarget: { x: Infinity, y: 870 } };
    expect(isItemStatePayload(buildItemStatePayload(state, 'homing'))).toBe(false);
  });
});

describe('V0.2 lobby version boundary', () => {
  it.each([undefined, '0.1', '0.2-items-v1', '0.2-items-v2', '0.2-other-rules'])('rejects mismatched PLAYER_READY version %s before GAME_START', async (version) => {
    const { a, b } = createLoopbackPair();
    const hostNm = new NetworkManager({ transport: a, matchId: 'm', localPlayerId: 'P1' });
    const guestNm = new NetworkManager({ transport: b, matchId: 'm', localPlayerId: 'P2' });
    const coord = new OnlineGameCoordinator({ session: { role: 'host', localPlayerId: 'P1', remotePlayerId: 'P2', transport: a, networkManager: hostNm },
      createMatchIdentity: () => ({ matchId: 'm', seed: 4 }) });
    const start = vi.fn(); const disconnected = vi.fn();
    coord.enterLobby({ onStart: start, onDisconnected: disconnected });
    try {
      await hostNm.connect(); await guestNm.connect(); coord.sendPlayerReady();
      guestNm.send(NetworkMessageType.PLAYER_READY, { readyAt: 1, ...(version === undefined ? {} : { rulesVersion: version }) }); await flushLoopback();
      expect(start).not.toHaveBeenCalled();
      expect(coord.opponentReady).toBe(false);
      expect(disconnected).toHaveBeenCalledWith('RULES_VERSION_MISMATCH');
      guestNm.send(NetworkMessageType.PLAYER_READY, { readyAt: 2, rulesVersion: ONLINE_RULES_VERSION }); await flushLoopback();
      expect(start).not.toHaveBeenCalled();
      expect(disconnected).toHaveBeenCalledTimes(1);
    } finally { coord.dispose(); a.close(); b.close(); }
  });
  it.each([undefined, '0.1', '0.2-items-v1', '0.2-items-v2'])('old GAME_START version %s is rejected before inspecting its obsolete snapshot shape', async (version) => {
    const { a, b } = createLoopbackPair();
    const hostNm = new NetworkManager({ transport: a, matchId: 'm', localPlayerId: 'P1' });
    const guestNm = new NetworkManager({ transport: b, matchId: 'm', localPlayerId: 'P2' });
    const coord = new OnlineGameCoordinator({ session: { role: 'guest', localPlayerId: 'P2', remotePlayerId: 'P1', transport: b, networkManager: guestNm },
      createMatchIdentity: () => ({ matchId: 'm', seed: 4 }) });
    const start = vi.fn(); const disconnected = vi.fn();
    coord.enterLobby({ onStart: start, onDisconnected: disconnected });
    try {
      await hostNm.connect(); await guestNm.connect();
      hostNm.send(NetworkMessageType.GAME_START, { matchId: 'm', seed: 4,
        hostPlayerId: 'P1', guestPlayerId: 'P2', initialState: { items: [] },
        ...(version === undefined ? {} : { rulesVersion: version }) }); await flushLoopback();
      expect(start).not.toHaveBeenCalled();
      expect(disconnected).toHaveBeenCalledWith('RULES_VERSION_MISMATCH');
    } finally { coord.dispose(); a.close(); b.close(); }
  });
});
