import { SIGNALING_PROTOCOL_VERSION } from '../../../src/game/network/signaling/SignalingMessage';

/**
 * FakeWebSocket —— Signaling 层共享测试替身（SG-1 建立，SG-3 起多测试复用）。
 * 只实现 SignalingClient 用到的 surface（addEventListener / removeEventListener /
 * send / close），模拟真实 WS 时序：readyState 0 CONNECTING / 1 OPEN / 3 CLOSED，
 * send 在非 OPEN 态 throw（同浏览器契约）。
 */
export class FakeWebSocket {
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

/** Client → Server 帧形状（{ v: 1, type, ...payload }） */
export function frame(payload: Record<string, unknown>): string {
  return JSON.stringify({ v: SIGNALING_PROTOCOL_VERSION, ...payload });
}
