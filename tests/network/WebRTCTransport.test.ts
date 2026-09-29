import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NetworkEnvelope } from '../../src/game/network/NetworkEnvelope';
import type { PeerRole } from '../../src/game/network/PeerRole';
import { NetworkMessageType } from '../../src/game/network/NetworkMessageType';
import { TransportError } from '../../src/game/network/NetworkTransport';
import { TransportState } from '../../src/game/network/TransportState';
import { WebRTCTransport } from '../../src/game/network/WebRTCTransport';
import { serializeEnvelope } from '../../src/game/network/serialization/NetworkSerializer';
import { makeEnvelope } from './envelopeFixture';

/**
 * 最小替身：只实现 WebRTCTransport 用到的 surface（事件回调属性 +
 * addEventListener/removeEventListener），模拟真实 RTCPeerConnection /
 * RTCDataChannel 时序。不 mock 超出契约的行为。
 */
class FakeRTCDataChannel {
  readonly label: string;
  readonly options?: RTCDataChannelInit;
  readyState: RTCDataChannelState = 'connecting';
  closed = false;
  readonly sent: string[] = [];
  private readonly listeners = new Map<string, Set<(event: unknown) => void>>();

  constructor(label: string, options?: RTCDataChannelInit) {
    this.label = label;
    this.options = options;
  }

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

  emit(type: string, event?: unknown): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) {
      listener(event ?? {});
    }
  }

  send(data: string): void {
    if (this.readyState !== 'open') {
      throw new Error(`FakeRTCDataChannel.send in readyState=${this.readyState}`);
    }
    this.sent.push(data);
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.readyState = 'closed';
    this.emit('close');
  }

  simulateOpen(): void {
    this.readyState = 'open';
    this.emit('open');
  }
}

class FakeRTCPeerConnection {
  connectionState: RTCPeerConnectionState = 'new';
  iceConnectionState: RTCIceConnectionState = 'new';
  iceGatheringState: RTCIceGatheringState = 'new';
  closed = false;
  readonly dataChannels: FakeRTCDataChannel[] = [];
  localDescription: { type: RTCSdpType; sdp: string } | null = null;
  remoteDescription: { type: RTCSdpType; sdp: string } | null = null;
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

  emit(type: string, event?: unknown): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) {
      listener(event ?? {});
    }
  }

  createDataChannel(label: string, options?: RTCDataChannelInit): FakeRTCDataChannel {
    const channel = new FakeRTCDataChannel(label, options);
    this.dataChannels.push(channel);
    return channel;
  }

  async createOffer(): Promise<RTCSessionDescriptionInit> {
    return { type: 'offer', sdp: 'fake:offer-sdp' };
  }

  async createAnswer(): Promise<RTCSessionDescriptionInit> {
    return { type: 'answer', sdp: 'fake:answer-sdp' };
  }

  async setLocalDescription(description: RTCSessionDescriptionInit): Promise<void> {
    this.localDescription = { type: description.type, sdp: description.sdp ?? '' };
    // 模拟真实时序：setLocal 后 ICE gathering 启动
    this.iceGatheringState = 'gathering';
    this.emit('icegatheringstatechange');
  }

  async setRemoteDescription(description: RTCSessionDescriptionInit): Promise<void> {
    this.remoteDescription = { type: description.type, sdp: description.sdp ?? '' };
    if (description.type === 'offer') {
      const channel = new FakeRTCDataChannel('game');
      this.dataChannels.push(channel);
      this.emit('datachannel', { channel });
    }
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.connectionState = 'closed';
    this.emit('connectionstatechange');
  }

  // ---- 测试驱动 ----

  completeIceGathering(): void {
    this.iceGatheringState = 'complete';
    this.emit('icegatheringstatechange');
  }

  failConnection(): void {
    this.connectionState = 'failed';
    this.emit('connectionstatechange');
  }
}

interface Bundle {
  readonly transport: WebRTCTransport;
  readonly pc: FakeRTCPeerConnection;
  readonly channel: FakeRTCDataChannel | null;
}

function makeTransport(role: PeerRole): Bundle {
  const pc = new FakeRTCPeerConnection();
  const transport = new WebRTCTransport({
    role,
    peerConnectionFactory: () => pc as unknown as RTCPeerConnection,
  });
  return { transport, pc, channel: role === 'host' ? pc.dataChannels[0] ?? null : null };
}

const tick = (): Promise<void> => new Promise<void>((resolve) => {
  setTimeout(resolve, 0);
});

async function createOfferWithIce(bundle: Bundle): Promise<string> {
  const pending = bundle.transport.createOffer();
  await tick(); // setLocalDescription 已执行 → fake 进入 gathering
  bundle.pc.completeIceGathering();
  return pending;
}

async function createAnswerWithIce(bundle: Bundle): Promise<string> {
  const pending = bundle.transport.createAnswer();
  await tick();
  bundle.pc.completeIceGathering();
  return pending;
}

async function connectHost(bundle: Bundle): Promise<FakeRTCDataChannel> {
  if (!bundle.channel) {
    throw new Error('host channel missing');
  }
  const pending = bundle.transport.connect();
  bundle.channel.simulateOpen();
  await pending;
  return bundle.channel;
}

async function expectRejection(promise: Promise<unknown>): Promise<TransportError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof TransportError) {
      return error;
    }
    throw error;
  }
  throw new Error('expected promise to reject');
}

function sendError(transport: WebRTCTransport): TransportError {
  try {
    transport.send(makeEnvelope());
  } catch (error) {
    if (error instanceof TransportError) {
      return error;
    }
    throw error;
  }
  throw new Error('expected send to throw');
}

describe('WebRTCTransport', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('① host 状态迁移 IDLE → CONNECTING → CONNECTED；dataChannel 可靠有序配置', async () => {
    const bundle = makeTransport('host');
    expect(bundle.transport.state).toBe(TransportState.IDLE);
    const channel = bundle.channel;
    expect(channel?.label).toBe('game');
    expect(channel?.options).toEqual({ ordered: true });
    expect(channel?.options).not.toHaveProperty('maxRetransmits');
    expect(channel?.options).not.toHaveProperty('maxPacketLifeTime');
    const states: TransportState[] = [];
    bundle.transport.onStateChange((state) => states.push(state));
    const pending = bundle.transport.connect();
    expect(bundle.transport.state).toBe(TransportState.CONNECTING);
    channel?.simulateOpen();
    await pending;
    expect(bundle.transport.state).toBe(TransportState.CONNECTED);
    expect(bundle.transport.connected).toBe(true);
    expect(states).toEqual([TransportState.CONNECTING, TransportState.CONNECTED]);
  });

  it('① guest 经 acceptOffer 收到 datachannel 后迁移 CONNECTED；重复 connect 幂等', async () => {
    const bundle = makeTransport('guest');
    await bundle.transport.acceptOffer(JSON.stringify({ type: 'offer', sdp: 'fake:offer-sdp' }));
    const channel = bundle.pc.dataChannels[0];
    expect(channel?.label).toBe('game');
    expect(bundle.transport.state).toBe(TransportState.IDLE); // channel 未 open 前仍 IDLE
    const pending = bundle.transport.connect();
    expect(bundle.transport.state).toBe(TransportState.CONNECTING);
    channel?.simulateOpen();
    await pending;
    expect(bundle.transport.state).toBe(TransportState.CONNECTED);
    // 已连接时再 connect：立即 resolve
    await bundle.transport.connect();
    expect(bundle.transport.state).toBe(TransportState.CONNECTED);
  });

  it('② close 全清理：对象关闭、listener 摘除、订阅清空、幂等、后续 send 抛错', async () => {
    const bundle = makeTransport('host');
    const channel = await connectHost(bundle);
    bundle.transport.close();
    expect(bundle.transport.state).toBe(TransportState.CLOSED);
    expect(channel.closed).toBe(true);
    expect(bundle.pc.closed).toBe(true);
    // DOM listener 全部摘除
    expect(channel.listenerCount('open')).toBe(0);
    expect(channel.listenerCount('message')).toBe(0);
    expect(channel.listenerCount('close')).toBe(0);
    expect(channel.listenerCount('error')).toBe(0);
    expect(bundle.pc.listenerCount('connectionstatechange')).toBe(0);
    expect(bundle.pc.listenerCount('iceconnectionstatechange')).toBe(0);
    expect(bundle.pc.listenerCount('datachannel')).toBe(0);
    // CLOSED 终态 send → TRANSPORT_CLOSED
    expect(sendError(bundle.transport).reason).toBe('TRANSPORT_CLOSED');
    // 幂等：再 close 不抛
    expect(() => bundle.transport.close()).not.toThrow();
    expect(bundle.transport.state).toBe(TransportState.CLOSED);
  });

  it('② CONNECTING 中 close：pending connect reject TRANSPORT_CLOSED', async () => {
    const bundle = makeTransport('host');
    const pending = bundle.transport.connect();
    bundle.transport.close();
    const error = await expectRejection(pending);
    expect(error.reason).toBe('TRANSPORT_CLOSED');
    expect(bundle.transport.state).toBe(TransportState.CLOSED);
  });

  it('③ 未连接 send 抛 TransportError(NOT_CONNECTED)；连接后 wire 落到 channel', async () => {
    const bundle = makeTransport('host');
    expect(sendError(bundle.transport).reason).toBe('NOT_CONNECTED'); // IDLE
    const pending = bundle.transport.connect();
    expect(sendError(bundle.transport).reason).toBe('NOT_CONNECTED'); // CONNECTING
    bundle.channel?.simulateOpen();
    await pending;
    bundle.transport.send(makeEnvelope());
    expect(bundle.channel?.sent).toHaveLength(1);
    expect(JSON.parse(bundle.channel?.sent[0] ?? '{}')).toMatchObject({ version: 1, sequence: 0 });
  });

  it('④ createOffer 等待 ICE gathering complete 后 resolve 完整 SDP', async () => {
    const bundle = makeTransport('host');
    const pending = bundle.transport.createOffer();
    await tick();
    expect(bundle.pc.iceGatheringState).toBe('gathering');
    expect(bundle.pc.localDescription).toEqual({ type: 'offer', sdp: 'fake:offer-sdp' });
    bundle.pc.completeIceGathering();
    const encoded = await pending;
    expect(JSON.parse(encoded)).toEqual({ type: 'offer', sdp: 'fake:offer-sdp' });
  });

  it('④ ICE gathering 不结束：2s 兜底超时 resolve 当前 SDP', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const bundle = makeTransport('host');
    const pending = bundle.transport.createOffer();
    await vi.advanceTimersByTimeAsync(2_000);
    const encoded = await pending;
    expect(JSON.parse(encoded)).toEqual({ type: 'offer', sdp: 'fake:offer-sdp' });
  });

  it('⑤ offer/answer 编码往返：setLocal/setRemote 记录、guest 收 datachannel、非法信令拒绝', async () => {
    const host = makeTransport('host');
    const guest = makeTransport('guest');
    const offer = await createOfferWithIce(host);
    expect(JSON.parse(offer)).toEqual({ type: 'offer', sdp: 'fake:offer-sdp' });
    await guest.transport.acceptOffer(offer);
    expect(guest.pc.remoteDescription).toEqual({ type: 'offer', sdp: 'fake:offer-sdp' });
    expect(guest.pc.dataChannels[0]?.label).toBe('game');
    const answer = await createAnswerWithIce(guest);
    expect(JSON.parse(answer)).toEqual({ type: 'answer', sdp: 'fake:answer-sdp' });
    await host.transport.acceptAnswer(answer);
    expect(host.pc.remoteDescription).toEqual({ type: 'answer', sdp: 'fake:answer-sdp' });
    // 非法信令：非 JSON / 类型不匹配 / 缺 sdp
    expect((await expectRejection(guest.transport.acceptOffer('not json'))).reason).toBe('INVALID_SIGNALING');
    expect((await expectRejection(host.transport.acceptAnswer(offer))).reason).toBe('INVALID_SIGNALING');
    expect(
      (await expectRejection(host.transport.acceptAnswer(JSON.stringify({ type: 'answer' })))).reason,
    ).toBe('INVALID_SIGNALING');
  });

  it('⑥ 非法 wire 消息：记录丢弃不崩、状态不变，合法消息仍投递', async () => {
    const bundle = makeTransport('host');
    const channel = await connectHost(bundle);
    const received: NetworkEnvelope[] = [];
    bundle.transport.onMessage((envelope) => received.push(envelope));
    channel.emit('message', { data: 'this is not json' });
    channel.emit('message', { data: JSON.stringify({ hello: 'world' }) });
    channel.emit('message', { data: JSON.stringify(42) });
    channel.emit('message', { data: 123 }); // 非字符串帧
    channel.emit('message', {
      data: JSON.stringify({
        version: 2,
        type: NetworkMessageType.PING,
        matchId: 'm',
        turnId: 0,
        senderId: 'P1',
        sequence: 0,
        timestamp: 1,
        payload: null,
      }),
    });
    expect(received).toHaveLength(0);
    expect(bundle.transport.state).toBe(TransportState.CONNECTED);
    const valid = serializeEnvelope(makeEnvelope({ type: NetworkMessageType.PLAYER_READY }));
    channel.emit('message', { data: valid });
    expect(received).toHaveLength(1);
    expect(received[0]?.type).toBe(NetworkMessageType.PLAYER_READY);
  });

  it('⑦ connect 超时：迁移 FAILED + reject CONNECT_FAILED；死通道 connect 拒绝', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const bundle = makeTransport('guest'); // 无 channel 永不 open
    const pending = bundle.transport.connect();
    expect(bundle.transport.state).toBe(TransportState.CONNECTING);
    // 先挂 rejection handler 再推进时钟，避免超时瞬间成为 unhandled rejection
    let timedOut: TransportError | undefined;
    const observed = pending.catch((error: unknown) => {
      if (error instanceof TransportError) {
        timedOut = error;
        return;
      }
      throw error;
    });
    await vi.advanceTimersByTimeAsync(10_000);
    await observed;
    expect(timedOut?.reason).toBe('CONNECT_FAILED');
    expect(bundle.transport.state).toBe(TransportState.FAILED);
    expect((await expectRejection(bundle.transport.connect())).reason).toBe('TRANSPORT_CLOSED');
  });

  it('⑦b connect(Infinity)：无 open 超时，远超 10s 后通道 open 仍正常 CONNECTED', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const bundle = makeTransport('guest');
    await bundle.transport.acceptOffer(JSON.stringify({ type: 'offer', sdp: 'fake:offer-sdp' }));
    const pending = bundle.transport.connect(Infinity); // Phase 13 Guest 手动传码：开放等待
    expect(bundle.transport.state).toBe(TransportState.CONNECTING);
    await vi.advanceTimersByTimeAsync(180_000); // Host 人肉应用 Answer 的分钟级窗口
    expect(bundle.transport.state).toBe(TransportState.CONNECTING); // 不得 FAILED
    const channel = bundle.pc.dataChannels[0];
    channel?.simulateOpen();
    await pending;
    expect(bundle.transport.state).toBe(TransportState.CONNECTED);
  });

  it('⑦ 握手期 pc failed：connect reject CONNECT_FAILED 且状态 FAILED', async () => {
    const bundle = makeTransport('host');
    const pending = bundle.transport.connect();
    bundle.pc.failConnection();
    const error = await expectRejection(pending);
    expect(error.reason).toBe('CONNECT_FAILED');
    expect(bundle.transport.state).toBe(TransportState.FAILED);
  });

  it('⑦ 已连接后通道关闭：DISCONNECTED + onDisconnect(CHANNEL_CLOSED)；pc 失败 → FAILED', async () => {
    const bundle = makeTransport('host');
    const channel = await connectHost(bundle);
    const reasons: Array<string | undefined> = [];
    bundle.transport.onDisconnect((reason) => reasons.push(reason));
    channel.close();
    expect(bundle.transport.state).toBe(TransportState.DISCONNECTED);
    expect(reasons).toEqual(['CHANNEL_CLOSED']);
    expect(sendError(bundle.transport).reason).toBe('NOT_CONNECTED');
    bundle.pc.failConnection();
    expect(bundle.transport.state).toBe(TransportState.FAILED);
    expect(reasons).toEqual(['CHANNEL_CLOSED', 'CONNECTION_FAILED']);
  });

  // ---- Phase 13 守护测试（T1/T2/T3 + F2，reviewer 遗留项） ---------------

  it('F2：FAILED 粘滞 —— 后续通道关闭事件不降级为 DISCONNECTED', async () => {
    const bundle = makeTransport('host');
    const channel = await connectHost(bundle);
    const reasons: Array<string | undefined> = [];
    bundle.transport.onDisconnect((reason) => reasons.push(reason));

    bundle.pc.failConnection();
    expect(bundle.transport.state).toBe(TransportState.FAILED);
    expect(reasons).toEqual(['CONNECTION_FAILED']);

    // 后续迟到事件：FAILED 必须粘滞（不降级、不重复 onDisconnect）
    channel.close();
    bundle.pc.close();
    expect(bundle.transport.state).toBe(TransportState.FAILED);
    expect(reasons).toEqual(['CONNECTION_FAILED']);
  });

  it('T1：close() 打断 ICE gathering —— 未决 createOffer reject TRANSPORT_CLOSED', async () => {
    const bundle = makeTransport('host');
    const pending = bundle.transport.createOffer();
    await tick(); // 已进入 gathering
    bundle.transport.close();
    const error = await expectRejection(pending);
    expect(error.reason).toBe('TRANSPORT_CLOSED');
  });

  it('T2：pc/ice disconnected 瞬态 —— 状态保持 CONNECTED、onDisconnect 不触发', async () => {
    const bundle = makeTransport('host');
    const channel = await connectHost(bundle);
    const reasons: Array<string | undefined> = [];
    bundle.transport.onDisconnect((reason) => reasons.push(reason));

    bundle.pc.connectionState = 'disconnected';
    bundle.pc.emit('connectionstatechange');
    bundle.pc.iceConnectionState = 'disconnected';
    bundle.pc.emit('iceconnectionstatechange');

    expect(bundle.transport.state).toBe(TransportState.CONNECTED);
    expect(reasons).toEqual([]);
    // 通道仍可用
    bundle.transport.send(makeEnvelope());
    expect(channel?.sent.length).toBe(1);
  });

  it('T3：CONNECTING 中重复 connect() —— 同一 promise 引用、单次 resolve', async () => {
    const bundle = makeTransport('host');
    const first = bundle.transport.connect();
    const second = bundle.transport.connect();
    expect(second).toBe(first); // 复用同一 promise，不产生第二个等待

    bundle.channel?.simulateOpen();
    await first;
    await second;
    expect(bundle.transport.state).toBe(TransportState.CONNECTED);
  });
});
