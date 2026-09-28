import type { NetworkEnvelope } from './NetworkEnvelope';
import { TransportError, type NetworkTransport } from './NetworkTransport';
import { TransportState } from './TransportState';
import { deserializeEnvelope, serializeEnvelope } from './serialization/NetworkSerializer';

/**
 * 本地回环 Transport 对（Phase 12 协议层测试替身 / 联机逻辑离线开发用）。
 *
 * * 双向：a.send → b 收；b.send → a 收。投递走 JSON 序列化副本 + setTimeout，
 *   与真实 wire 同构（收到的是副本而非引用，且顺带全链路协议校验）。
 * * connect() 即时握手：发起端 IDLE → CONNECTING → CONNECTED；对端直接
 *   IDLE → CONNECTED（模拟 RTCDataChannel onopen，两侧一起就绪）。
 * * close()：本端 → CLOSED（幂等）；对端 → DISCONNECTED + onDisconnect('PEER_CLOSED')；
 *   两个方向的在途消息一律丢弃（真实数据通道 close 不保证投递）。
 * * FAILED 状态 / 丢包模拟 / 重连：本阶段不实现 —— 归 WebRTCTransport（委托②）。
 *
 * 零 Phaser / DOM 依赖；Vitest node 环境可测。
 */

export interface LoopbackPairOptions {
  /**
   * 单向投递延迟（毫秒）。默认 0 —— 仍为异步投递（macrotask）。
   * 负数 / NaN / Infinity 抛错（测试配置错误应尽早炸出）。
   * 未来如需模拟丢包，在此扩展 packetLoss 等选项（本阶段不实现）。
   */
  latencyMs?: number;
}

export interface LoopbackPair {
  a: NetworkTransport;
  b: NetworkTransport;
}

export function createLoopbackPair(options: LoopbackPairOptions = {}): LoopbackPair {
  const latencyMs = resolveLatencyMs(options.latencyMs);
  const a = new LoopbackEndpoint('a', latencyMs);
  const b = new LoopbackEndpoint('b', latencyMs);
  a.linkPeer(b);
  b.linkPeer(a);
  return { a, b };
}

function resolveLatencyMs(value: number | undefined): number {
  if (value === undefined) {
    return 0;
  }
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(
      `[LocalLoopbackTransport] invalid latencyMs: ${String(value)} (expected finite number >= 0)`,
    );
  }
  return value;
}

class LoopbackEndpoint implements NetworkTransport {
  private readonly messageHandlers = new Set<(message: NetworkEnvelope) => void>();
  private readonly stateChangeHandlers = new Set<(state: TransportState) => void>();
  private readonly disconnectHandlers = new Set<(reason?: string) => void>();
  private readonly pendingDeliveries = new Set<ReturnType<typeof setTimeout>>();
  private peer: LoopbackEndpoint | null = null;
  private transportState: TransportState = TransportState.IDLE;

  constructor(
    private readonly label: string,
    private readonly latencyMs: number,
  ) {}

  get state(): TransportState {
    return this.transportState;
  }

  get connected(): boolean {
    return this.transportState === TransportState.CONNECTED;
  }

  /** 仅供 createLoopbackPair 布线，调用一次；重复调用 = 工厂内部 bug，抛错 */
  linkPeer(peer: LoopbackEndpoint): void {
    if (this.peer !== null) {
      throw new Error(`[LocalLoopbackTransport:${this.label}] peer already linked`);
    }
    this.peer = peer;
  }

  connect(): Promise<void> {
    if (
      this.transportState === TransportState.CLOSED ||
      this.transportState === TransportState.FAILED ||
      this.transportState === TransportState.DISCONNECTED
    ) {
      return Promise.reject(
        new TransportError(
          'TRANSPORT_CLOSED',
          `[loopback:${this.label}] cannot connect: pair is dead (${this.transportState}) — 重连需新建 transport`,
        ),
      );
    }
    if (this.transportState === TransportState.CONNECTED) {
      return Promise.resolve();
    }
    // loopback 握手即时完成：CONNECTING → 通知对端 → CONNECTED
    this.setState(TransportState.CONNECTING);
    this.peer?.handleChannelOpen();
    this.setState(TransportState.CONNECTED);
    return Promise.resolve();
  }

  send(message: NetworkEnvelope): void {
    if (this.transportState === TransportState.CLOSED || this.transportState === TransportState.FAILED) {
      throw new TransportError(
        'TRANSPORT_CLOSED',
        `[loopback:${this.label}] send rejected: transport is ${this.transportState}`,
      );
    }
    if (this.transportState !== TransportState.CONNECTED) {
      throw new TransportError(
        'NOT_CONNECTED',
        `[loopback:${this.label}] send rejected: transport is ${this.transportState}`,
      );
    }
    const peer = this.peer;
    if (peer === null) {
      throw new TransportError('NOT_CONNECTED', `[loopback:${this.label}] send rejected: no peer`);
    }
    // 与真实 wire 一致：同步序列化（坏 envelope 立刻抛）→ 延迟投递反序列化副本
    const wire = serializeEnvelope(message);
    const timer = setTimeout(() => {
      this.pendingDeliveries.delete(timer);
      peer.deliver(wire);
    }, this.latencyMs);
    this.pendingDeliveries.add(timer);
  }

  onMessage(handler: (message: NetworkEnvelope) => void): () => void {
    this.messageHandlers.add(handler);
    return () => {
      this.messageHandlers.delete(handler);
    };
  }

  onStateChange(handler: (state: TransportState) => void): () => void {
    this.stateChangeHandlers.add(handler);
    return () => {
      this.stateChangeHandlers.delete(handler);
    };
  }

  onDisconnect(handler: (reason?: string) => void): () => void {
    this.disconnectHandlers.add(handler);
    return () => {
      this.disconnectHandlers.delete(handler);
    };
  }

  close(): void {
    if (this.transportState === TransportState.CLOSED) {
      return; // 幂等
    }
    this.clearPendingDeliveries();
    this.setState(TransportState.CLOSED);
    const peer = this.peer;
    this.peer = null;
    peer?.handlePeerClosed('PEER_CLOSED');
  }

  // ---- 内部 ----

  /** 对端 connect() 成功：本端视为收到 onopen（IDLE → CONNECTED） */
  private handleChannelOpen(): void {
    if (this.transportState === TransportState.IDLE) {
      this.setState(TransportState.CONNECTED);
    }
  }

  /** 对端 close()：丢弃发往对端的在途消息，进入 DISCONNECTED 并广播 */
  private handlePeerClosed(reason: string): void {
    this.clearPendingDeliveries();
    this.peer = null;
    if (this.transportState === TransportState.CLOSED || this.transportState === TransportState.FAILED) {
      return; // 本端已终态：不重复广播
    }
    this.setState(TransportState.DISCONNECTED);
    for (const handler of [...this.disconnectHandlers]) {
      handler(reason);
    }
  }

  /** 投递反序列化副本；handler 异常向上传播，由订阅方自行兜底（Transport 不吞错） */
  private deliver(wire: string): void {
    if (this.transportState !== TransportState.CONNECTED) {
      return; // 防御：close 链已清理定时器，正常不可达
    }
    const result = deserializeEnvelope(wire);
    if (!result.ok) {
      // wire 来自本模块 serializeEnvelope（已校验）—— 到这里必为内部 bug，显式炸出
      throw new Error(`[LocalLoopbackTransport:${this.label}] internal deserialize failure: ${result.error.message}`);
    }
    for (const handler of [...this.messageHandlers]) {
      handler(result.envelope);
    }
  }

  private clearPendingDeliveries(): void {
    for (const timer of this.pendingDeliveries) {
      clearTimeout(timer);
    }
    this.pendingDeliveries.clear();
  }

  private setState(next: TransportState): void {
    if (this.transportState === next) {
      return;
    }
    this.transportState = next;
    for (const handler of [...this.stateChangeHandlers]) {
      handler(next);
    }
  }
}
