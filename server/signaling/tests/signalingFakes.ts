import type { SignalingSocket } from '../src/socket';
import { SIGNALING_PROTOCOL_VERSION } from '../../../src/game/network/signaling/SignalingMessage';

/**
 * Signaling Server 测试替身（SG-2）。
 * FakeSignalingSocket 只实现 SignalingSocket surface；FakeClock 驱动 TTL /
 * grace 语义 —— RoomManager/SignalingRoomServer 的 now 全部注入，无 fake timers。
 */

let socketCounter = 0;

export class FakeSignalingSocket implements SignalingSocket {
  readonly id: string;
  readonly sent: string[] = [];
  closed = false;

  constructor(label?: string) {
    this.id = label ?? `sock-${++socketCounter}`;
  }

  send(data: string): void {
    if (this.closed) {
      throw new Error(`FakeSignalingSocket(${this.id}).send on closed socket`);
    }
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
  }

  frames(): Array<Record<string, unknown>> {
    return this.sent.map((raw) => JSON.parse(raw) as Record<string, unknown>);
  }

  lastFrame(): Record<string, unknown> | null {
    const raw = this.sent[this.sent.length - 1];
    return raw === undefined ? null : (JSON.parse(raw) as Record<string, unknown>);
  }

  lastType(): string | null {
    const frame = this.lastFrame();
    const type = frame?.['type'];
    return typeof type === 'string' ? type : null;
  }

  clear(): void {
    this.sent.length = 0;
  }
}

export class FakeClock {
  now: number;

  constructor(start = 1_700_000_000_000) {
    this.now = start;
  }

  advance(ms: number): this {
    this.now += ms;
    return this;
  }

  current(): number {
    return this.now;
  }
}

/** Client → Server 帧形状（{ v: 1, type, ...payload }） */
export function clientFrame(payload: Record<string, unknown>): string {
  return JSON.stringify({ v: SIGNALING_PROTOCOL_VERSION, ...payload });
}

/** 从帧文本取字段（noUncheckedIndexedAccess 安全窄化） */
export function frameField(frame: Record<string, unknown> | null, key: string): unknown {
  return frame?.[key];
}
