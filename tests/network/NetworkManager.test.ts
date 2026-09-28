import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NetworkEnvelope } from '../../src/game/network/NetworkEnvelope';
import { createLoopbackPair } from '../../src/game/network/LocalLoopbackTransport';
import { NetworkManager, type PingPongPayload } from '../../src/game/network/NetworkManager';
import { NetworkMessageType } from '../../src/game/network/NetworkMessageType';
import { TransportError } from '../../src/game/network/NetworkTransport';
import { TransportState } from '../../src/game/network/TransportState';

const MATCH_ID = 'match-manager-test';

interface ManagerPair {
  readonly a: NetworkManager;
  readonly b: NetworkManager;
}

async function createConnectedPair(): Promise<ManagerPair> {
  const { a, b } = createLoopbackPair();
  const managerA = new NetworkManager({ transport: a, matchId: MATCH_ID, localPlayerId: 'P1' });
  const managerB = new NetworkManager({ transport: b, matchId: MATCH_ID, localPlayerId: 'P2' });
  await managerA.connect();
  await managerB.connect();
  return { a: managerA, b: managerB };
}

/** loopback 投递（含级联 PONG 回包）全部落定 */
function flushDelivery(): void {
  vi.runAllTimers();
}

describe('NetworkManager', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('① sequence 从 1 起单调递增，跨消息类型连续，远端最近 sequence 可读', async () => {
    const { a, b } = await createConnectedPair();
    expect(b.lastRemoteSequence).toBeUndefined();
    const received: NetworkEnvelope[] = [];
    const cancels = [
      b.onMessage(NetworkMessageType.PLAYER_READY, (envelope) => received.push(envelope)),
      b.onMessage(NetworkMessageType.STATE_SYNC_REQUEST, (envelope) => received.push(envelope)),
      b.onMessage(NetworkMessageType.TURN_END, (envelope) => received.push(envelope)),
    ];
    a.send(NetworkMessageType.PLAYER_READY, null);
    a.send(NetworkMessageType.STATE_SYNC_REQUEST, null);
    a.send(NetworkMessageType.TURN_END, null);
    flushDelivery();
    expect(received.map((envelope) => envelope.sequence)).toEqual([1, 2, 3]);
    expect(b.lastRemoteSequence).toBe(3);
    a.send(NetworkMessageType.PLAYER_READY, null);
    flushDelivery();
    expect(received).toHaveLength(4);
    expect(received[3]?.sequence).toBe(4);
    expect(b.lastRemoteSequence).toBe(4);
    for (const cancel of cancels) {
      cancel();
    }
  });

  it('② 发送合法 envelope 对端收到完整字段；typed 分发只命中订阅类型', async () => {
    const { a, b } = await createConnectedPair();
    const readyReceived: NetworkEnvelope[] = [];
    let syncRequests = 0;
    b.onMessage(NetworkMessageType.PLAYER_READY, (envelope) => readyReceived.push(envelope));
    b.onMessage(NetworkMessageType.STATE_SYNC_REQUEST, () => {
      syncRequests += 1;
    });
    a.setTurnId(7);
    a.send(NetworkMessageType.PLAYER_READY, null);
    flushDelivery();
    expect(syncRequests).toBe(0);
    expect(readyReceived).toHaveLength(1);
    const envelope = readyReceived[0];
    if (!envelope) {
      throw new Error('envelope not received');
    }
    expect(envelope.version).toBe(1);
    expect(envelope.type).toBe(NetworkMessageType.PLAYER_READY);
    expect(envelope.matchId).toBe(MATCH_ID);
    expect(envelope.turnId).toBe(7);
    expect(envelope.senderId).toBe('P1');
    expect(envelope.sequence).toBe(1);
    expect(Number.isInteger(envelope.timestamp)).toBe(true);
    expect(envelope.payload).toBeNull();
  });

  it('③ dispose：close transport、对端收到 PEER_CLOSED、后续 send 抛错、再 dispose 幂等', async () => {
    const { a, b } = await createConnectedPair();
    const reasons: Array<string | undefined> = [];
    b.onDisconnect((reason) => reasons.push(reason));
    let callbackCalls = 0;
    a.onMessage(NetworkMessageType.PLAYER_READY, () => {
      callbackCalls += 1;
    });
    a.onStateChange(() => {
      callbackCalls += 1;
    });
    a.dispose();
    expect(a.state).toBe(TransportState.CLOSED);
    expect(b.state).toBe(TransportState.DISCONNECTED);
    expect(reasons).toEqual(['PEER_CLOSED']);
    // dispose 先取消 transport 订阅再 close：CLOSED 迁移不回调已清空的管理器订阅
    expect(callbackCalls).toBe(0);
    expect(() => a.send(NetworkMessageType.PLAYER_READY, null)).toThrow(TransportError);
    expect(() => a.dispose()).not.toThrow();
    expect(a.state).toBe(TransportState.CLOSED);
  });

  it('④ PING/PONG over loopback：自动回包、sentAt 透传、RTT 可算', async () => {
    const { a, b } = await createConnectedPair();
    const pongs: Array<NetworkEnvelope<PingPongPayload>> = [];
    const pings: Array<NetworkEnvelope<PingPongPayload>> = [];
    a.onPong((envelope) => pongs.push(envelope));
    b.onMessage<PingPongPayload>(NetworkMessageType.PING, (envelope) => pings.push(envelope));
    const sentAt = Date.now();
    a.ping();
    flushDelivery();
    expect(pings).toHaveLength(1);
    expect(pings[0]?.payload.sentAt).toBe(sentAt);
    expect(pings[0]?.senderId).toBe('P1');
    expect(pings[0]?.sequence).toBe(1);
    expect(pongs).toHaveLength(1);
    expect(pongs[0]?.type).toBe(NetworkMessageType.PONG);
    expect(pongs[0]?.senderId).toBe('P2');
    expect(pongs[0]?.payload.sentAt).toBe(sentAt); // 透传
    expect(pongs[0]?.sequence).toBe(1); // B 侧首条 send
    const rtt = Date.now() - (pongs[0]?.payload.sentAt ?? 0);
    expect(rtt).toBeGreaterThanOrEqual(0);
  });

  it('⑤ 单个 handler 抛错不阻断其余 handler 与后续消息', async () => {
    const { a, b } = await createConnectedPair();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    let survivors = 0;
    b.onMessage(NetworkMessageType.PING, () => {
      throw new Error('handler bug');
    });
    b.onMessage(NetworkMessageType.PING, () => {
      survivors += 1;
    });
    a.send<PingPongPayload>(NetworkMessageType.PING, { sentAt: Date.now() });
    flushDelivery();
    expect(survivors).toBe(1);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    a.send<PingPongPayload>(NetworkMessageType.PING, { sentAt: Date.now() });
    flushDelivery();
    expect(survivors).toBe(2);
    let readyCalls = 0;
    b.onMessage(NetworkMessageType.PLAYER_READY, () => {
      readyCalls += 1;
    });
    a.send(NetworkMessageType.PLAYER_READY, null);
    flushDelivery();
    expect(readyCalls).toBe(1);
    expect(errorSpy).toHaveBeenCalledTimes(2);
  });

  it('F1：畸形 PING payload（null / sentAt 非整数）不自动回 PONG，仍分发订阅者', async () => {
    const { a, b } = await createConnectedPair();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const bPongs: NetworkEnvelope[] = [];
    a.onMessage(NetworkMessageType.PONG, (envelope) => bPongs.push(envelope as NetworkEnvelope));
    const receivedPings: NetworkEnvelope[] = [];
    b.onMessage(NetworkMessageType.PING, (envelope) => receivedPings.push(envelope as NetworkEnvelope));

    // 绕过 ping() 的合法封装，直接发畸形 PING payload
    a.send(NetworkMessageType.PING, null);
    flushDelivery();
    expect(bPongs).toHaveLength(0); // 未回声
    expect(receivedPings).toHaveLength(1); // 订阅者仍收到

    a.send(NetworkMessageType.PING, { sentAt: 'not-a-number' } as unknown as PingPongPayload);
    flushDelivery();
    expect(bPongs).toHaveLength(0);
    expect(receivedPings).toHaveLength(2);
    expect(warnSpy.mock.calls.filter((call) => String(call[0]).includes('malformed PING'))).toHaveLength(2);

    // 合法 PING 正常自动回 PONG
    a.ping();
    flushDelivery();
    expect(bPongs).toHaveLength(1);
  });
});
