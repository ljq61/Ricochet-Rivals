import type { PeerRole } from '../../src/game/network/PeerRole';
import { TransportError } from '../../src/game/network/NetworkTransport';
import { WebRTCTransport } from '../../src/game/network/WebRTCTransport';
import { makeEnvelope } from './envelopeFixture';

/**
 * WebRTC 测试替身（Phase 12 建立的最小 fake，Phase 13 提取共享）。
 * 只实现 WebRTCTransport 用到的 surface（事件回调属性 + add/removeEventListener），
 * 模拟真实 RTCPeerConnection / RTCDataChannel 时序，不 mock 超出契约的行为。
 */
export class FakeRTCDataChannel {
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

export interface Bundle {
  readonly transport: WebRTCTransport;
  readonly pc: FakeRTCPeerConnection;
  readonly channel: FakeRTCDataChannel | null;
}

export function makeTransport(role: PeerRole): Bundle {
  const pc = new FakeRTCPeerConnection();
  const transport = new WebRTCTransport({
    role,
    peerConnectionFactory: () => pc as unknown as RTCPeerConnection,
  });
  return { transport, pc, channel: role === 'host' ? pc.dataChannels[0] ?? null : null };
}

export const tick = (): Promise<void> =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });

export async function createOfferWithIce(bundle: Bundle): Promise<string> {
  const pending = bundle.transport.createOffer();
  await tick(); // setLocalDescription 已执行 → fake 进入 gathering
  bundle.pc.completeIceGathering();
  return pending;
}

export async function createAnswerWithIce(bundle: Bundle): Promise<string> {
  const pending = bundle.transport.createAnswer();
  await tick();
  bundle.pc.completeIceGathering();
  return pending;
}

export async function connectHost(bundle: Bundle): Promise<FakeRTCDataChannel> {
  if (!bundle.channel) {
    throw new Error('host channel missing');
  }
  const pending = bundle.transport.connect();
  bundle.channel.simulateOpen();
  await pending;
  return bundle.channel;
}

export async function expectRejection(promise: Promise<unknown>): Promise<TransportError> {
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

export function sendError(transport: WebRTCTransport): TransportError {
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

/**
 * 双通道桥接（Phase 13 Controller 测试）：a.send 的 wire 同步投递到 b 的
 * 'message' 事件，反之亦然 —— 模拟已建立的 DataChannel 全双工。
 */
export function bridgeChannels(
  a: FakeRTCDataChannel,
  b: FakeRTCDataChannel,
  options?: { guestToHost?: boolean }
): void {
  const originalSendA = a.send.bind(a);
  a.send = (data: string) => {
    originalSendA(data);
    b.emit('message', { data });
  };
  if (options?.guestToHost !== false) {
    const originalSendB = b.send.bind(b);
    b.send = (data: string) => {
      originalSendB(data);
      a.emit('message', { data });
    };
  }
}
