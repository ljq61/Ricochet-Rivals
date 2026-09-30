import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NetworkEnvelope } from '../../src/game/network/NetworkEnvelope';
import type { PeerRole } from '../../src/game/network/PeerRole';
import { NetworkMessageType } from '../../src/game/network/NetworkMessageType';
import { TransportError } from '../../src/game/network/NetworkTransport';
import { TransportState } from '../../src/game/network/TransportState';
import { WebRTCTransport } from '../../src/game/network/WebRTCTransport';
import type { WebRTCConfig } from '../../src/game/network/WebRTCConfig';
import { serializeEnvelope } from '../../src/game/network/serialization/NetworkSerializer';
import type { SignalingIceCandidate } from '../../src/game/network/signaling/SignalingMessage';
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

export class FakeRTCPeerConnection {
  connectionState: RTCPeerConnectionState = 'new';
  iceConnectionState: RTCIceConnectionState = 'new';
  iceGatheringState: RTCIceGatheringState = 'new';
  signalingState: RTCSignalingState = 'stable';
  closed = false;
  readonly dataChannels: FakeRTCDataChannel[] = [];
  /** SG-8：createOffer 收到的 options 逐次记录（iceRestart 断言用） */
  readonly createOfferOptions: Array<RTCOfferOptions | undefined> = [];
  /** SG-4：经 transport.addIceCandidate 成功落库的对端 candidate（malformed 不入） */
  readonly addedCandidates: RTCIceCandidateInit[] = [];
  /** SG-6：getStats 注入报告（transport 诊断解析 selected pair） */
  statsEntries: Array<Record<string, unknown>> = [];
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

  async createOffer(options?: RTCOfferOptions): Promise<RTCSessionDescriptionInit> {
    this.createOfferOptions.push(options);
    return { type: 'offer', sdp: options?.iceRestart === true ? 'fake:offer-sdp-restart' : 'fake:offer-sdp' };
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
    // browser contract：gathering 完结时 onicecandidate 收到 null candidate
    this.emit('icecandidate', { candidate: null });
  }

  /** SG-4：模拟浏览器逐个产出本地 candidate */
  emitLocalCandidate(candidate: {
    candidate: string;
    sdpMid?: string | null;
    sdpMLineIndex?: number | null;
  }): void {
    this.emit('icecandidate', { candidate });
  }

  /** SG-4：真实浏览器对畸形 candidate 会 reject —— fake 以 'candidate:' 前缀校验模拟 */
  async addIceCandidate(candidate?: RTCIceCandidateInit | null): Promise<void> {
    const text = candidate?.candidate;
    if (typeof text !== 'string' || !text.startsWith('candidate:')) {
      throw new Error(`FakeRTCPeerConnection.addIceCandidate malformed: ${String(text)}`);
    }
    this.addedCandidates.push(candidate ?? {});
  }

  /** SG-6：最小 RTCStatsReport 形状（forEach 遍历注入条目） */
  async getStats(): Promise<RTCStatsReport> {
    const entries = this.statsEntries;
    return {
      forEach: (callback: (stat: Record<string, unknown>) => void) => {
        for (const entry of entries) {
          callback(entry);
        }
      },
    } as unknown as RTCStatsReport;
  }

  failConnection(): void {
    this.connectionState = 'failed';
    this.emit('connectionstatechange');
  }

  /** SG-8：模拟 ICE restart 后连接重建（connectionState → connected） */
  restoreConnection(): void {
    this.connectionState = 'connected';
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
    pcCloseDelayMs: 0, // 单测即时关闭（延迟刷出行为由 R6 专测）
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

describe('WebRTCTransport — Trickle ICE（SG-4）', () => {
  const CAND_A: SignalingIceCandidate = { candidate: 'candidate:1 1 UDP 1 10.0.0.1 40000 typ host', sdpMid: '0' };
  const CAND_B: SignalingIceCandidate = { candidate: 'candidate:2 1 UDP 1 10.0.0.2 40001 typ srflx', sdpMid: '0' };

  it('T4：beginOffer/beginAnswer 即时返回 —— 不等 ICE gathering（对照 createOffer 仍等待）', async () => {
    const host = makeTransport('host');
    const hostPending = host.transport.beginOffer();
    const hostSdp = await hostPending; // 无 completeIceGathering 也 resolve
    expect(JSON.parse(hostSdp)).toMatchObject({ type: 'offer', sdp: 'fake:offer-sdp' });
    expect(host.pc.iceGatheringState).toBe('gathering'); // gather 仍在进行

    const guest = makeTransport('guest');
    await guest.transport.acceptOffer(JSON.stringify({ type: 'offer', sdp: 'fake:offer-sdp' }));
    const guestSdp = await guest.transport.beginAnswer();
    expect(JSON.parse(guestSdp)).toMatchObject({ type: 'answer', sdp: 'fake:answer-sdp' });
  });

  it('T5：本地 candidate 事件映射 + null 完结（browser contract）', async () => {
    const bundle = makeTransport('host');
    const received: Array<unknown> = [];
    bundle.transport.onLocalIceCandidate((candidate) => received.push(candidate));

    bundle.pc.emitLocalCandidate({ candidate: 'candidate:1 1 UDP 1 10.0.0.1 40000 typ host', sdpMid: '0' });
    bundle.pc.emitLocalCandidate({ candidate: 'candidate:2 1 UDP 1 10.0.0.2 40001 typ srflx', sdpMid: '0' });
    bundle.pc.completeIceGathering(); // → null candidate 事件

    expect(received.length).toBe(3);
    const first = received[0] as { candidate?: string; sdpMid?: string };
    expect(first.candidate).toContain('typ host');
    expect(first.sdpMid).toBe('0');
    expect(received[2]).toBeNull(); // end of candidates
  });

  it('T6：candidate 先于 remoteDescription → 入队；acceptOffer 后按序 flush', async () => {
    const bundle = makeTransport('guest');
    bundle.transport.addIceCandidate(CAND_A);
    bundle.transport.addIceCandidate(CAND_B);
    expect(bundle.pc.addedCandidates.length).toBe(0); // remoteDescription 未 set → 入队

    await bundle.transport.acceptOffer(JSON.stringify({ type: 'offer', sdp: 'fake:offer-sdp' }));
    expect(bundle.pc.addedCandidates.length).toBe(2);
    expect(bundle.pc.addedCandidates[0]?.candidate).toContain('10.0.0.1');
    expect(bundle.pc.addedCandidates[1]?.candidate).toContain('10.0.0.2'); // flush 顺序保持
  });

  it('T7：remoteDescription 已 apply → candidate 直通（无队列）', async () => {
    const bundle = makeTransport('host');
    await createOfferWithIce(bundle); // host 侧 localDescription 就绪
    await bundle.transport.acceptAnswer(JSON.stringify({ type: 'answer', sdp: 'fake:answer-sdp' }));

    bundle.transport.addIceCandidate(CAND_A);
    await tick();
    expect(bundle.pc.addedCandidates.length).toBe(1); // 直通
  });

  it('T8：duplicate candidate 丢弃（candidate 文本复合键去重）', async () => {
    const bundle = makeTransport('host');
    await bundle.transport.acceptAnswer(JSON.stringify({ type: 'answer', sdp: 'fake:answer-sdp' }));

    bundle.transport.addIceCandidate(CAND_A);
    bundle.transport.addIceCandidate(CAND_A); // 完全重复
    bundle.transport.addIceCandidate({ ...CAND_A, sdpMid: '1' }); // 同文本不同 m-line → 不算重复
    await tick();
    expect(bundle.pc.addedCandidates.length).toBe(2);
  });

  it('T9：malformed candidate 拒收不崩 —— 后续合法候选不受影响', async () => {
    const bundle = makeTransport('host');
    await bundle.transport.acceptAnswer(JSON.stringify({ type: 'answer', sdp: 'fake:answer-sdp' }));

    expect(() => bundle.transport.addIceCandidate({ candidate: 'garbage-line' })).not.toThrow();
    await tick();
    bundle.transport.addIceCandidate(CAND_A);
    await tick();
    expect(bundle.pc.addedCandidates.length).toBe(1); // 畸形被拒、合法落库
  });

  it('T10：close 全清理扩展 —— icecandidate listener 摘除、candidate 订阅清空、pending 队列弃置', async () => {
    const bundle = makeTransport('guest');
    let endEvents = 0;
    bundle.transport.onLocalIceCandidate((candidate) => {
      if (candidate === null) endEvents += 1;
    });
    bundle.transport.addIceCandidate(CAND_A); // 入队
    bundle.transport.close();

    expect(bundle.pc.listenerCount('icecandidate')).toBe(0);
    // close 后 fake 事件不再到达 transport（listener 已摘）—— 订阅侧零回调
    bundle.pc.completeIceGathering();
    bundle.pc.emitLocalCandidate({ candidate: 'candidate:3 1 UDP 1 10.0.0.3 40002 typ relay' });
    expect(endEvents).toBe(0);

    // 队列已弃置：重新 open 不可达（transport CLOSED），无泄漏路径
    expect(bundle.transport.state).toBe(TransportState.CLOSED);
  });
});

describe('WebRTCTransport — SG-6（iceTransportPolicy + 诊断）', () => {
  function makePolicyTransport() {
    const captured: WebRTCConfig[] = [];
    const pc = new FakeRTCPeerConnection();
    const transport = new WebRTCTransport({
      role: 'host',
      config: { iceServers: [{ urls: 'stun:stun.unit:3478' }], iceTransportPolicy: 'relay' },
      peerConnectionFactory: (config) => {
        captured.push(config);
        return pc as unknown as RTCPeerConnection;
      },
      pcCloseDelayMs: 0,
    });
    return { transport, pc, captured };
  }

  it('D1：iceTransportPolicy 透传至 RTCPeerConnection config（DEBUG_FORCE_RELAY 链路）', () => {
    const { captured } = makePolicyTransport();
    expect(captured[0]?.iceTransportPolicy).toBe('relay');
    expect(captured[0]?.iceServers).toEqual([{ urls: 'stun:stun.unit:3478' }]);
  });

  it('D2：本地 candidate 类型收集 + icecandidateerror 计数', async () => {
    const { transport, pc } = makePolicyTransport();
    pc.emitLocalCandidate({ candidate: 'candidate:1 1 UDP 1 192.168.1.4 40000 typ host', sdpMid: '0' });
    pc.emitLocalCandidate({ candidate: 'candidate:2 1 UDP 1 8.8.8.8 40001 typ srflx', sdpMid: '0' });
    pc.emitLocalCandidate({ candidate: 'candidate:3 1 TCP 1 10.0.0.1 40002 typ relay', sdpMid: '0' });
    pc.emit('icecandidateerror', { url: 'stun:stun.unit:3478', errorCode: 300 });
    pc.emit('icecandidateerror', { url: 'turn:turn.example.com:3478?transport=udp', errorCode: 401, errorText: 'Unauthorized' });

    const diag = await transport.getDiagnostics();
    expect(diag.localCandidateTypes).toEqual(['host', 'srflx', 'relay']);
    expect(diag.iceCandidateErrorCount).toBe(2);
    expect(diag.lastIceCandidateError).toContain('401');
    expect(diag.lastIceCandidateError).toContain('turn.example.com');
    expect(diag.signalingState).toBe('stable');
  });

  it('D3：selected pair（getStats 注入）—— relay 对 → route=RELAY + relayProtocol', async () => {
    const { transport, pc } = makePolicyTransport();
    pc.statsEntries = [
      { type: 'candidate-pair', id: 'P1', selected: true, localCandidateId: 'L', remoteCandidateId: 'R', state: 'succeeded' },
      { type: 'local-candidate', id: 'L', candidateType: 'relay', protocol: 'tcp', address: '10.0.0.9', relayProtocol: 'tls' },
      { type: 'remote-candidate', id: 'R', candidateType: 'host', protocol: 'udp', address: '192.168.1.2' },
    ];
    const diag = await transport.getDiagnostics();
    expect(diag.selectedPair?.localType).toBe('relay');
    expect(diag.selectedPair?.remoteType).toBe('host');
    expect(diag.selectedPair?.relayProtocol).toBe('tls');
    expect(diag.route).toBe('RELAY');
  });

  it('D4：selected pair host↔host → DIRECT；无 stats → route=null（未连接）', async () => {
    const { transport, pc } = makePolicyTransport();
    pc.statsEntries = [
      { type: 'candidate-pair', id: 'P1', nominated: true, state: 'succeeded', localCandidateId: 'L', remoteCandidateId: 'R' },
      { type: 'local-candidate', id: 'L', candidateType: 'host', protocol: 'udp' },
      { type: 'remote-candidate', id: 'R', candidateType: 'host', protocol: 'udp' },
    ];
    expect((await transport.getDiagnostics()).route).toBe('DIRECT');

    pc.statsEntries = [];
    const none = await transport.getDiagnostics();
    expect(none.selectedPair).toBeNull();
    expect(none.route).toBeNull();
  });

  it('D5：close 清理诊断状态（candidate 类型清空、error listener 摘除）', async () => {
    const { transport, pc } = makePolicyTransport();
    pc.emitLocalCandidate({ candidate: 'candidate:1 1 UDP 1 192.168.1.4 40000 typ host', sdpMid: '0' });
    transport.close();
    const diag = await transport.getDiagnostics();
    expect(diag.transportState).toBe(TransportState.CLOSED);
    expect(diag.localCandidateTypes).toEqual([]);
    expect(pc.listenerCount('icecandidateerror')).toBe(0);
  });
});

describe('WebRTCTransport — SG-8（ICE restart 恢复面）', () => {
  it('R1：restartOffer —— iceRestart 选项 + 即返（不等 gathering）+ CLOSED 拒绝', async () => {
    const b = makeTransport('host');
    await connectHost(b);
    b.pc.failConnection();
    // FAILED → CONNECTING（恢复武装前置）；武装 promise 由 close() 收口，预挂 catch 防未处理拒绝
    void b.transport.recoverConnect(5_000).catch(() => {});

    const pending = b.transport.restartOffer();
    let returned = false;
    void pending.then(() => {
      returned = true;
    });
    await tick();
    expect(returned).toBe(true); // 即返：fake setLocal 后仍 gathering
    expect(b.pc.createOfferOptions[0]).toEqual({ iceRestart: true });
    expect(b.pc.iceGatheringState).toBe('gathering');
    expect(b.pc.localDescription?.sdp).toBe('fake:offer-sdp-restart');

    b.transport.close();
    await expectRejection(b.transport.restartOffer()); // CLOSED 拒绝（不复活）
  });

  it('R2：recoverConnect 三态 + 防假成功门（channel open 但 pc 未 connected 不 resolve）', async () => {
    // CONNECTED → 即 resolve
    const a = makeTransport('host');
    await connectHost(a);
    await expect(a.transport.recoverConnect()).resolves.toBeUndefined();

    // FAILED → 武装；真实 ICE 失败期 SCTP 通道常仍 open —— 不得在 restart
    // 生效前假成功（必须等 connectionState connected）
    a.pc.failConnection();
    const armed = a.transport.recoverConnect(200);
    await tick();
    expect(a.transport.state).toBe(TransportState.CONNECTING);
    let resolved = false;
    void armed.then(() => {
      resolved = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(resolved).toBe(false); // pc failed：channel open 也不 resolve

    a.pc.restoreConnection(); // connected + channel open → 恢复完成
    await armed;
    expect(a.transport.connected).toBe(true);

    // CLOSED → 拒绝
    a.transport.close();
    await expectRejection(a.transport.recoverConnect());
  });

  it('R3：防假成功门不伤初连 —— 通道 open 且 pc connected 时 connect() 即成', async () => {
    const b = makeTransport('host');
    b.channel?.simulateOpen(); // open 事件先于 connect()
    b.pc.connectionState = 'connected';
    await b.transport.connect();
    expect(b.transport.connected).toBe(true);
  });

  it('R4：recheckConnection 补查 —— 后台 missed 的 failed 状态经手动重查触发失败链', async () => {
    const b = makeTransport('host');
    await connectHost(b);
    const losses: string[] = [];
    b.transport.onDisconnect((reason) => losses.push(reason ?? ''));
    b.pc.connectionState = 'failed'; // 后台期 connectionstatechange 未派发
    expect(losses.length).toBe(0);

    b.transport.recheckConnection();
    expect(losses).toEqual(['CONNECTION_FAILED']);
    expect(b.transport.state).toBe(TransportState.FAILED);
  });

  it('R5：debugSimulateConnectionLost —— FAILED + lastLossReason，底层不真死（E2E 注入口）', async () => {
    const b = makeTransport('host');
    await connectHost(b);
    b.transport.debugSimulateConnectionLost('CONNECTION_FAILED');
    expect(b.transport.state).toBe(TransportState.FAILED);
    expect(b.transport.lastLossReason).toBe('CONNECTION_FAILED');
    expect(b.channel?.readyState).toBe('open');
    expect(b.pc.connectionState).not.toBe('failed');
  });

  it('R6：close() 延后 pc.close()（SCTP close 刷出窗口）—— channel 即关、pc 存活至窗口后', async () => {
    const pc = new FakeRTCPeerConnection();
    const transport = new WebRTCTransport({
      role: 'host',
      peerConnectionFactory: () => pc as unknown as RTCPeerConnection,
      pcCloseDelayMs: 15,
    });
    const channel = pc.dataChannels[0];
    expect(channel).toBeDefined();
    transport.close();

    // 立即：通道已关（SCTP 流重置已发起）、transport 已终态；pc 仍存活等刷出
    expect(channel?.closed).toBe(true);
    expect(transport.state).toBe(TransportState.CLOSED);
    expect(pc.closed).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(pc.closed).toBe(true); // 窗口后 pc 关闭
  });
});
