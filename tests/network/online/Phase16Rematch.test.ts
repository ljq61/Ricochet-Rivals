import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInitialGameState } from '../../../src/game/state/GameState';
import { TurnPhase } from '../../../src/game/state/TurnPhase';
import { NetworkManager } from '../../../src/game/network/NetworkManager';
import { createLoopbackPair } from '../../../src/game/network/LocalLoopbackTransport';
import { OnlineGameCoordinator } from '../../../src/game/network/online/OnlineGameCoordinator';
import { flushLoopback } from '../onlineHarness';
import type { OnlineBattleBootstrap } from '../../../src/game/network/online/OnlineTypes';
import type { OnlineSession } from '../../../src/game/network/OnlineSession';
import { TransportError, type NetworkTransport } from '../../../src/game/network/NetworkTransport';

/**
 * Phase 16 —— Online Rematch（零新 wire 协议：复用 PLAYER_READY →
 * GAME_START 握手；WebRTC session 复用不重建）。
 *
 * 模拟对局结束后的 Result 场景行为：旧局协调器 dispose → 新协调器
 * （同 session）→ 双方 sendPlayerReady → Host 汇齐 → 新 GAME_START
 * （新 matchId + seed）→ 双方 onStart。
 */

let pair: { a: NetworkTransport; b: NetworkTransport };

function makeSession(
  transport: NetworkTransport,
  role: 'host' | 'guest',
  nm: NetworkManager,
): OnlineSession {
  return {
    role,
    localPlayerId: role === 'host' ? 'P1' : 'P2',
    remotePlayerId: role === 'host' ? 'P2' : 'P1',
    transport,
    networkManager: nm,
  };
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  pair = createLoopbackPair();
});

afterEach(() => {
  vi.restoreAllMocks();
  pair.a.close();
  pair.b.close();
});

function makeCoordinator(
  side: 'host' | 'guest',
  nm: NetworkManager,
): OnlineGameCoordinator {
  const transport = side === 'host' ? pair.a : pair.b;
  const session = makeSession(transport, side, nm);
  const coordinator = new OnlineGameCoordinator({
    session,
    createMatchIdentity: () => ({
      matchId: `match-${side}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      seed: Math.floor(Math.random() * 0x7fffffff),
    }),
  });
  return coordinator;
}

function makeNm(side: 'host' | 'guest'): NetworkManager {
  const transport = side === 'host' ? pair.a : pair.b;
  return new NetworkManager({ transport, matchId: 'rm', localPlayerId: side === 'host' ? 'P1' : 'P2' });
}

describe('Phase 16 — Online Rematch', () => {
  it('① 双方 Ready → 新 GAME_START（新 matchId / seed ≠ 旧局）→ 双方 onStart', async () => {
    const hostNm = makeNm('host');
    const guestNm = makeNm('guest');
    await pair.a.connect();
    await pair.b.connect();

    // 模拟"第一局结束"：旧局协调器（不复用 —— Rematch 用新实例）
    const oldHost = makeCoordinator('host', hostNm);
    const oldGuest = makeCoordinator('guest', guestNm);
    const oldHostBoots: OnlineBattleBootstrap[] = [];
    const oldGuestBoots: OnlineBattleBootstrap[] = [];
    const oldHostCancel = oldHost.enterLobby({ onStart: (b) => oldHostBoots.push(b), onDisconnected: () => {} });
    const oldGuestCancel = oldGuest.enterLobby({ onStart: (b) => oldGuestBoots.push(b), onDisconnected: () => {} });
    oldHost.sendPlayerReady();
    oldGuest.sendPlayerReady();
    await flushLoopback(4);
    expect(oldHostBoots).toHaveLength(1);
    expect(oldGuestBoots).toHaveLength(1);
    const firstMatchId = oldHostBoots[0]?.gameStart.matchId;
    const firstSeed = oldHostBoots[0]?.gameStart.seed;

    // 对局结束：旧协调器 dispose（订阅/保活全清，session 不动）
    oldHostCancel();
    oldGuestCancel();
    oldHost.dispose();
    oldGuest.dispose();
    await flushLoopback(2);

    // Result 场景：新协调器复用同一 session —— 双方点 REMATCH
    const host = makeCoordinator('host', hostNm);
    const guest = makeCoordinator('guest', guestNm);
    const hostBoots: OnlineBattleBootstrap[] = [];
    const guestBoots: OnlineBattleBootstrap[] = [];
    const hostCancel = host.enterLobby({ onStart: (b) => hostBoots.push(b), onDisconnected: () => {} });
    const guestCancel = guest.enterLobby({ onStart: (b) => guestBoots.push(b), onDisconnected: () => {} });
    host.sendPlayerReady();
    await flushLoopback(2);
    expect(hostBoots).toHaveLength(0); // Host 自己 Ready，等 Guest

    guest.sendPlayerReady();
    await flushLoopback(4);

    expect(hostBoots).toHaveLength(1);
    expect(guestBoots).toHaveLength(1);
    const newMatchId = hostBoots[0]?.gameStart.matchId;
    const newSeed = hostBoots[0]?.gameStart.seed;
    expect(newMatchId).not.toBe(firstMatchId);
    expect(newSeed).not.toBe(firstSeed);
    // 双方 bootstrap 同源
    expect(guestBoots[0]?.gameStart.matchId).toBe(newMatchId);
    // 新局初始状态全新：HP 10 / turn 1 / P1 先手
    const init = guestBoots[0]?.gameStart.initialState;
    expect(init?.turnId).toBe(1);
    expect(init?.players.P1.hp).toBe(10);
    expect(init?.players.P2.hp).toBe(10);
    expect(init?.phase).toBe(TurnPhase.START);

    hostCancel();
    guestCancel();
    host.dispose();
    guest.dispose();
  });

  it('② 对称 ready + started 后重复 Ready 幂等（不二次开局）', async () => {
    const hostNm = makeNm('host');
    const guestNm = makeNm('guest');
    await pair.a.connect();
    await pair.b.connect();

    const host = makeCoordinator('host', hostNm);
    const guest = makeCoordinator('guest', guestNm);
    const hostBoots: OnlineBattleBootstrap[] = [];
    const hostCancel = host.enterLobby({
      onStart: (b) => hostBoots.push(b),
      onDisconnected: () => {},
    });
    const guestCancel = guest.enterLobby({ onStart: () => {}, onDisconnected: () => {} });

    expect(guest.opponentReady).toBe(false);
    host.sendPlayerReady();
    await flushLoopback(2);
    expect(guest.opponentReady).toBe(true); // Host Ready 可见
    expect(host.opponentReady).toBe(false); // Host 视角 Guest 未 Ready

    // Guest Ready → Host 汇齐双方 → 开局
    guest.sendPlayerReady();
    await flushLoopback(4);
    expect(host.opponentReady).toBe(true);
    expect(hostBoots).toHaveLength(1);

    // started 后双方重复 Ready：handlePlayerReady 的 started 短路
    // （sequence 自增过 dedup 直达短路分支）—— 不二次 GAME_START / onStart
    guest.sendPlayerReady();
    host.sendPlayerReady();
    await flushLoopback(4);
    expect(hostBoots).toHaveLength(1);

    hostCancel();
    guestCancel();
    host.dispose();
    guest.dispose();
  });

  it('③ Rematch 期间对端离开（transport close 触发对端感知）→ 本端 onDisconnected', async () => {
    const hostNm = makeNm('host');
    const guestNm = makeNm('guest');
    await pair.a.connect();
    await pair.b.connect();

    const host = makeCoordinator('host', hostNm);
    const guest = makeCoordinator('guest', guestNm);
    let hostNotified = false;
    const hostCancel = host.enterLobby({
      onStart: () => {},
      onDisconnected: () => {
        hostNotified = true;
      },
    });
    const guestCancel = guest.enterLobby({ onStart: () => {}, onDisconnected: () => {} });

    host.sendPlayerReady();
    // Guest 直接退出（Result 期回菜单语义：dispose + transport close）。
    // 本端 onDisconnected 由通道关闭触发 —— 非 DISCONNECT 消息（通道
    // 关闭后在途消息不投递；DISCONNECT 无接收方，见 TASKS.md Known Issues）
    guestCancel();
    guest.dispose();
    pair.b.close();
    await flushLoopback(4);

    expect(hostNotified).toBe(true);

    hostCancel();
    host.dispose();
  });

  it('④ 新局 GameState 从新快照重建（重置 gameSeed / GameState / TurnState 契约）', async () => {
    // Rematch 契约核心：新 GAME_START.initialState 必须是全新权威状态
    // —— ResultScene → BattleScene 经 stateFromSnapshot 重建（复用
    // 既有路径，此处直接验证 initialState 与旧局终态无关）
    const fresh = createInitialGameState({ matchId: 'new-match', seed: 424242 });
    expect(fresh.players.P1.hp).toBe(10);
    expect(fresh.players.P2.hp).toBe(10);
    expect(fresh.players.P1.hasFired).toBe(false);
    expect(fresh.players.P2.hasFired).toBe(false);
    expect(fresh.players.P1.moveRemaining).toBe(250);
    expect(fresh.currentPlayerId).toBe('P1');
    expect(fresh.phase).toBe(TurnPhase.START);
    expect(fresh.gameOver).toBe(false);
  });

  it('⑤ 一方点 REMATCH 后另一方迟迟不点：等待方不超时（open-ended）', async () => {
    const hostNm = makeNm('host');
    const guestNm = makeNm('guest');
    await pair.a.connect();
    await pair.b.connect();

    const host = makeCoordinator('host', hostNm);
    const guest = makeCoordinator('guest', guestNm);
    const hostBoots: OnlineBattleBootstrap[] = [];
    const hostCancel = host.enterLobby({ onStart: (b) => hostBoots.push(b), onDisconnected: () => {} });
    const guestCancel = guest.enterLobby({ onStart: () => {}, onDisconnected: () => {} });

    host.sendPlayerReady();
    // 长等待（无任何超时机制 —— 真人节奏）
    await flushLoopback(8);
    expect(hostBoots).toHaveLength(0);
    expect(host.opponentReady).toBe(false);

    hostCancel();
    guestCancel();
    host.dispose();
    guest.dispose();
  });

  it('⑥ 对端先离开后点 REMATCH：通道已死可检测（Result 守卫依据，不死按钮）', async () => {
    const hostNm = makeNm('host');
    const guestNm = makeNm('guest');
    await pair.a.connect();
    await pair.b.connect();

    const host = makeCoordinator('host', hostNm);
    const guest = makeCoordinator('guest', guestNm);
    const hostCancel = host.enterLobby({ onStart: () => {}, onDisconnected: () => {} });
    const guestCancel = guest.enterLobby({ onStart: () => {}, onDisconnected: () => {} });

    // 对端先离开（Result 期回菜单语义）—— 本端旧协调器 gameOver 抑制
    // 断线提示，ResultScene 无从得知，只能在点击时检测
    guestCancel();
    guest.dispose();
    pair.b.close();
    await flushLoopback(2);

    // ResultScene 守卫依据：session.transport.connected === false → 直接
    // 给 OPPONENT LEFT 反馈并跳过 sendPlayerReady；否则向死通道发送抛
    // TransportError（tap 回调未捕获 = 按钮死路无提示）
    expect(host.transport.connected).toBe(false);
    expect(() => host.sendPlayerReady()).toThrow(TransportError);

    hostCancel();
    host.dispose();
  });
});
