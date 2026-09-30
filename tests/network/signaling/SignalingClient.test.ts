import { describe, expect, it, vi } from 'vitest';
import {
  SignalingClient,
  SignalingClientState,
  SignalingError,
  type SignalingFailure,
} from '../../../src/game/network/signaling/SignalingClient';
import {
  SIGNALING_PROTOCOL_VERSION,
  type SignalingInboundMessage,
} from '../../../src/game/network/signaling/SignalingMessage';

/**
 * SignalingClient（SG-1）—— 信令客户端状态机（FakeWebSocket 驱动）。
 * 只实现 SignalingClient 用到的 surface（addEventListener/send/close），
 * 模拟真实 WS 时序：readyState 0 CONNECTING / 1 OPEN / 3 CLOSED，
 * send 在非 OPEN 态 throw（同浏览器契约）。
 */

class FakeWebSocket {
  readyState = 0;
  readonly sent: string[] = [];
  private readonly listeners = new Map<string, Set<(event: unknown) => void>>();

  addEventListener(type: string, listener: (event: unknown) => void): void {
    let set = this.listeners.get(type);
    if (set === undefined) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener);
  }

  removeEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  listenerCount(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }

  private emit(type: string, event?: unknown): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) {
      listener(event ?? {});
    }
  }

  send(data: string): void {
    if (this.readyState !== 1) {
      throw new Error(`FakeWebSocket.send in readyState=${this.readyState}`);
    }
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3;
  }

  // ---- 测试驱动 ----

  simulateOpen(): void {
    this.readyState = 1;
    this.emit('open');
  }

  simulateError(): void {
    this.emit('error');
  }

  /** 服务器主动断开（listener 仍挂在 client 上） */
  serverClose(): void {
    this.readyState = 3;
    this.emit('close');
  }

  serverSend(raw: string): void {
    this.emit('message', { data: raw });
  }

  /** 非文本帧（二进制 Blob 等价物） */
  serverSendNonText(data: unknown): void {
    this.emit('message', { data });
  }

  sentFrames(): Array<Record<string, unknown>> {
    return this.sent.map((raw) => JSON.parse(raw) as Record<string, unknown>);
  }
}

interface Harness {
  readonly client: SignalingClient;
  readonly ws: FakeWebSocket;
  readonly states: SignalingClientState[];
  readonly messages: SignalingInboundMessage[];
  readonly failures: SignalingFailure[];
}

function makeHarness(connectTimeoutMs?: number): Harness {
  const ws = new FakeWebSocket();
  const client = new SignalingClient({
    url: 'ws://localhost:8787/signaling',
    webSocketFactory: () => ws as unknown as WebSocket,
    connectTimeoutMs,
  });
  const states: SignalingClientState[] = [];
  const messages: SignalingInboundMessage[] = [];
  const failures: SignalingFailure[] = [];
  client.onStateChange((state) => states.push(state));
  client.onMessage((message) => messages.push(message));
  client.onFailure((failure) => failures.push(failure));
  return { client, ws, states, messages, failures };
}

function frame(payload: Record<string, unknown>): string {
  return JSON.stringify({ v: SIGNALING_PROTOCOL_VERSION, ...payload });
}

const ROOM_CREATED_FRAME = frame({
  type: 'ROOM_CREATED',
  roomCode: 'K7M4Q2',
  peerToken: 'host-token',
  iceServers: [{ urls: 'stun:stun.example.com:3478' }],
  expiresAt: 1_800_000_000_000,
});

const ROOM_JOINED_FRAME = frame({
  type: 'ROOM_JOINED',
  roomCode: 'K7M4Q2',
  peerToken: 'guest-token',
  iceServers: [{ urls: 'stun:stun.example.com:3478' }],
  expiresAt: 1_800_000_000_000,
});

/** 已拨号 + open 的客户端 */
async function dialed(h: Harness): Promise<void> {
  const pending = h.client.connect();
  h.ws.simulateOpen();
  await pending;
}

/** Host：入房完成（ROOM_WAITING） */
async function hostInRoom(h: Harness): Promise<void> {
  await dialed(h);
  h.client.createRoom();
  h.ws.serverSend(ROOM_CREATED_FRAME);
}

async function expectSignalingRejection(promise: Promise<unknown>): Promise<SignalingError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof SignalingError) {
      return error;
    }
    throw error;
  }
  throw new Error('expected promise to reject');
}

describe('SignalingClient', () => {
  it('1. connect：CONNECTING → CONNECTED；重复 connect 复用 promise；存活态直接 resolve', async () => {
    const h = makeHarness();
    const pending = h.client.connect();
    expect(h.client.state).toBe(SignalingClientState.CONNECTING);
    const again = h.client.connect(); // CONNECTING 中复用
    h.ws.simulateOpen();
    await pending;
    await again;
    expect(h.client.state).toBe(SignalingClientState.CONNECTED);
    await h.client.connect(); // 存活态直接 resolve
    expect(h.states).toEqual([
      SignalingClientState.CONNECTING,
      SignalingClientState.CONNECTED,
    ]);
  });

  it('2. connect 失败：WS error → FAILED + CONNECT_FAILED + reject', async () => {
    const h = makeHarness();
    const pending = h.client.connect();
    h.ws.simulateError();
    const error = await expectSignalingRejection(pending);
    expect(error.reason).toBe('CONNECT_FAILED');
    expect(h.client.state).toBe(SignalingClientState.FAILED);
    expect(h.failures.length).toBe(1);
    expect(h.failures[0]?.reason).toBe('CONNECT_FAILED');
  });

  it('3. connect 超时：CONNECT_TIMEOUT → FAILED（fake timers）', async () => {
    const h = makeHarness(5_000);
    vi.useFakeTimers();
    try {
      const pending = h.client.connect();
      vi.advanceTimersByTime(5_000);
      const error = await expectSignalingRejection(pending);
      expect(error.reason).toBe('CONNECT_FAILED');
      expect(h.client.lastFailure?.reason).toBe('CONNECT_TIMEOUT');
      expect(h.client.state).toBe(SignalingClientState.FAILED);
    } finally {
      vi.useRealTimers();
    }
  });

  it('4. close：connecting 中 → reject TERMINAL；幂等；close 后 connect 拒绝', async () => {
    const h = makeHarness();
    const pending = h.client.connect();
    h.client.close();
    const error = await expectSignalingRejection(pending);
    expect(error.reason).toBe('TERMINAL');
    expect(h.client.state).toBe(SignalingClientState.DISCONNECTED);
    h.client.close(); // 幂等
    const after = await expectSignalingRejection(h.client.connect());
    expect(after.reason).toBe('TERMINAL');
  });

  it('5. Host 全流：CREATE_ROOM → ROOM_CREATED → ROOM_WAITING → PEER_JOINED → PEER_FOUND → sendOffer → NEGOTIATING', async () => {
    const h = makeHarness();
    await hostInRoom(h);
    expect(h.client.state).toBe(SignalingClientState.ROOM_WAITING);
    expect(h.ws.sentFrames()[0]?.type).toBe('CREATE_ROOM');

    h.ws.serverSend(frame({ type: 'PEER_JOINED' }));
    expect(h.client.state).toBe(SignalingClientState.PEER_FOUND);

    h.client.sendOffer('offer-sdp');
    expect(h.client.state).toBe(SignalingClientState.NEGOTIATING);
    expect(h.ws.sentFrames()[1]?.type).toBe('OFFER');
    expect(h.ws.sentFrames()[1]?.sdp).toBe('offer-sdp');

    // Trickle：candidate / ICE_END 帧续发，状态保持 NEGOTIATING
    h.client.sendIceCandidate({ candidate: 'candidate:1 1 UDP 1 192.168.1.4 54321 typ host' });
    h.client.sendIceEnd();
    const frames = h.ws.sentFrames();
    expect(frames[2]?.type).toBe('ICE_CANDIDATE');
    expect(frames[3]?.type).toBe('ICE_END');
    expect(h.client.state).toBe(SignalingClientState.NEGOTIATING);
    expect(h.states).toEqual([
      SignalingClientState.CONNECTING,
      SignalingClientState.CONNECTED,
      SignalingClientState.ROOM_WAITING,
      SignalingClientState.PEER_FOUND,
      SignalingClientState.NEGOTIATING,
    ]);
  });

  it('6. Guest 全流：joinRoom 规范化输入 → ROOM_JOINED → PEER_FOUND → 收 OFFER → NEGOTIATING → sendAnswer/ICE_END', async () => {
    const h = makeHarness();
    await dialed(h);
    h.client.joinRoom(' k7m4-q2 '); // 小写 + 空白 + 连字符
    expect(h.ws.sentFrames()[0]?.roomCode).toBe('K7M4Q2');
    h.ws.serverSend(ROOM_JOINED_FRAME);
    expect(h.client.state).toBe(SignalingClientState.PEER_FOUND);

    // 尚无任何协商活动 → 收到 Host OFFER 即 NEGOTIATING（trickle 不等 offer 收齐）
    h.ws.serverSend(frame({ type: 'OFFER', sdp: 'offer-sdp' }));
    expect(h.client.state).toBe(SignalingClientState.NEGOTIATING);
    expect(h.messages[0]?.type).toBe('ROOM_JOINED');
    expect(h.messages[1]?.type).toBe('OFFER');

    h.client.sendAnswer('answer-sdp');
    h.client.sendIceEnd();
    const frames = h.ws.sentFrames();
    expect(frames[1]?.type).toBe('ANSWER');
    expect(frames[2]?.type).toBe('ICE_END');
    expect(h.client.state).toBe(SignalingClientState.NEGOTIATING);
  });

  it('7. joinRoom 非法码：INVALID_ROOM_CODE，零帧发出', async () => {
    const h = makeHarness();
    await dialed(h);
    for (const bad of ['', 'ABC1E', 'ABC1EF', 'K7M4Q2X', '012345']) {
      expect(() => h.client.joinRoom(bad)).toThrowError(SignalingError);
      expect(h.ws.sent.length).toBe(0);
    }
    const error = (() => {
      try {
        h.client.joinRoom('K7MOQ2'); // O 不在 alphabet
      } catch (e) {
        return e as SignalingError;
      }
      throw new Error('expected throw');
    })();
    expect(error.reason).toBe('INVALID_ROOM_CODE');
  });

  it('8. 状态守卫：NOT_CONNECTED / NO_PEER / INVALID_STATE / FAILED 后 TERMINAL', async () => {
    const h = makeHarness();
    // socket 未开：createRoom → NOT_CONNECTED
    let caught: SignalingError | null = null;
    try {
      h.client.createRoom();
    } catch (e) {
      caught = e as SignalingError;
    }
    expect(caught?.reason).toBe('NOT_CONNECTED');

    await dialed(h);
    // 无对端：sendOffer → NO_PEER
    caught = null;
    try {
      h.client.sendOffer('sdp');
    } catch (e) {
      caught = e as SignalingError;
    }
    expect(caught?.reason).toBe('NO_PEER');

    // 已入房后重复 createRoom → INVALID_STATE
    await hostInRoom(h);
    caught = null;
    try {
      h.client.createRoom();
    } catch (e) {
      caught = e as SignalingError;
    }
    expect(caught?.reason).toBe('INVALID_STATE');

    // FAILED 后 connect → TERMINAL（重连需新建实例）
    h.ws.serverClose();
    expect(h.client.state).toBe(SignalingClientState.FAILED);
    const error = await expectSignalingRejection(h.client.connect());
    expect(error.reason).toBe('TERMINAL');
  });

  it('9. ERROR 消息 → FAILED + SERVER_ERROR（code 保留）；onMessage 不投递 ERROR', async () => {
    const h = makeHarness();
    await dialed(h);
    h.client.joinRoom('K7M4Q2');
    h.ws.serverSend(frame({ type: 'ERROR', code: 'ROOM_NOT_FOUND', message: 'no such room' }));
    expect(h.client.state).toBe(SignalingClientState.FAILED);
    expect(h.client.lastFailure?.reason).toBe('SERVER_ERROR');
    expect(h.client.lastFailure?.code).toBe('ROOM_NOT_FOUND');
    expect(h.client.lastFailure?.detail).toBe('no such room');
    expect(h.failures.length).toBe(1);
    expect(h.messages).toEqual([]); // ERROR 由 onFailure 承载，不重复投递
  });

  it('10. PEER_LEFT：状态不变，事件照常投递（controller 裁决生死）', async () => {
    const h = makeHarness();
    await hostInRoom(h);
    h.ws.serverSend(frame({ type: 'PEER_JOINED' }));
    h.client.sendOffer('offer-sdp');
    h.ws.serverSend(frame({ type: 'PEER_LEFT' }));
    expect(h.client.state).toBe(SignalingClientState.NEGOTIATING);
    const last = h.messages[h.messages.length - 1];
    expect(last?.type).toBe('PEER_LEFT');
  });

  it('11. 非法入站帧全丢弃：非文本 / 非 JSON / 未知类型 / 坏 payload —— 状态不变不崩', async () => {
    const h = makeHarness();
    await hostInRoom(h);
    const before = h.client.state;
    const messageCount = h.messages.length; // setup 的 ROOM_CREATED 已合法投递
    h.ws.serverSendNonText({ binary: true }); // 非文本帧
    h.ws.serverSend('{not-json');
    h.ws.serverSend(frame({ type: 'FOO' }));
    h.ws.serverSend(frame({ type: 'OFFER', sdp: '' })); // 空SDP
    h.ws.serverSend(frame({ v: 2, type: 'PEER_JOINED' })); // 版本不符
    expect(h.client.state).toBe(before);
    expect(h.messages.length).toBe(messageCount);
    // 之后协议恢复正常：PEER_JOINED 照常迁移
    h.ws.serverSend(frame({ type: 'PEER_JOINED' }));
    expect(h.client.state).toBe(SignalingClientState.PEER_FOUND);
  });

  it('12. WS 中断分类：握手期 → CONNECT_FAILED；建立后 → WS_CLOSED', async () => {
    const h = makeHarness();
    const pending = h.client.connect();
    h.ws.simulateError();
    await expectSignalingRejection(pending);
    expect(h.client.lastFailure?.reason).toBe('CONNECT_FAILED');

    const h2 = makeHarness();
    await hostInRoom(h2);
    h2.ws.serverClose();
    expect(h2.client.state).toBe(SignalingClientState.FAILED);
    expect(h2.client.lastFailure?.reason).toBe('WS_CLOSED');
  });

  it('13. close() 全清理：listener 摘除、订阅清空、后续 socket 事件不可复活', async () => {
    const h = makeHarness();
    await hostInRoom(h);
    h.client.close();
    expect(h.client.state).toBe(SignalingClientState.DISCONNECTED);
    expect(h.ws.listenerCount('open')).toBe(0);
    expect(h.ws.listenerCount('message')).toBe(0);
    expect(h.ws.listenerCount('error')).toBe(0);
    expect(h.ws.listenerCount('close')).toBe(0);
    expect(h.ws.readyState).toBe(3); // 底层 socket 已关

    // 订阅已清：close 后的 socket 事件 / server 帧不再触发任何回调
    const stateCount = h.states.length;
    const messageCount = h.messages.length;
    h.ws.serverSend(frame({ type: 'PEER_JOINED' }));
    h.ws.serverClose();
    expect(h.states.length).toBe(stateCount);
    expect(h.messages.length).toBe(messageCount);
    expect(h.client.state).toBe(SignalingClientState.DISCONNECTED);
  });

  it('14. handler 异常隔离：一个订阅者抛错不阻断其余订阅者', async () => {
    const h = makeHarness();
    const seen: string[] = [];
    h.client.onStateChange(() => {
      throw new Error('boom');
    });
    h.client.onStateChange((state) => seen.push(state));
    await dialed(h);
    expect(seen).toContain(SignalingClientState.CONNECTED);

    const seenMessages: string[] = [];
    h.client.onMessage(() => {
      throw new Error('boom');
    });
    h.client.onMessage((message) => seenMessages.push(message.type));
    h.ws.serverSend(frame({ type: 'PEER_JOINED' }));
    expect(seenMessages).toContain('PEER_JOINED');
  });
});
