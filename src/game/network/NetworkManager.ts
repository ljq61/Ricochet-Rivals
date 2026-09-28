import type { MatchId, PlayerId, TurnId } from '../state/ids';
import type { NetworkEnvelope } from './NetworkEnvelope';
import { NetworkMessageType } from './NetworkMessageType';
import { validateEnvelope } from './NetworkProtocol';
import { TransportError, type NetworkTransport } from './NetworkTransport';
import type { TransportState } from './TransportState';

/**
 * NetworkManager —— 面向 Game Logic 的网络门面（Phase 12 委托②）。
 *
 * * 组装出站 envelope：sequence 本地单调自增（计数器从 0 起，首条 = 1）、
 *   timestamp = Date.now()，matchId / senderId / turnId 戳记；组装数据必过
 *   validateEnvelope 协议防线（失败即本类 bug，NetworkProtocolError 上抛），
 *   再交 transport.send（通道不可用由 transport throw TransportError）。
 * * 入站分发：按 NetworkMessageType 订阅；保存远端最近 sequence（getter
 *   暴露，Phase 14/15 命令对齐 / desync 检测用；本阶段无 rollback）。
 * * 保活：ping() 发 PING({sentAt})；收到 PING 自动回 PONG（透传 sentAt）；
 *   onPong 订阅应答，RTT = Date.now() − payload.sentAt。
 * * 生命周期：connect / disconnect / dispose。dispose 清全部订阅并 close
 *   transport（幂等；无全局 singleton，每局新建实例 —— scene.start 复用
 *   Scene 时不会复活旧订阅）。
 * * handler 兜底：单个 onMessage / onStateChange / onDisconnect handler
 *   抛错只 console.error 记录，不阻断其余 handler 与后续消息。
 */

/** PING / PONG 载荷：PONG 原样透传 PING 的 sentAt（RTT = now − sentAt） */
export interface PingPongPayload {
  readonly sentAt: number;
}

export interface NetworkManagerOptions {
  readonly transport: NetworkTransport;
  readonly matchId: MatchId;
  readonly localPlayerId: PlayerId;
}

type EnvelopeHandler = (envelope: NetworkEnvelope<unknown>) => void;

/** F1：入站 PING/PONG payload 形状守卫（plain object + sentAt 有限整数） */
function isPingPongPayload(value: unknown): value is PingPongPayload {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Number.isInteger((value as { sentAt?: unknown }).sentAt)
  );
}

export class NetworkManager {
  private readonly transport: NetworkTransport;
  /** 本通道绑定的 matchId（Phase 14：Coordinator 校验入站 envelope.matchId 防线用，
   * 字段名让位给下方 getter —— 具名 matchIdValue） */
  private readonly matchIdValue: MatchId;
  private readonly localPlayerId: PlayerId;
  private readonly messageHandlers = new Map<NetworkMessageType, Set<EnvelopeHandler>>();
  private readonly stateChangeHandlers = new Set<(state: TransportState) => void>();
  private readonly disconnectHandlers = new Set<(reason?: string) => void>();
  private readonly transportCancels: Array<() => void> = [];
  private sequenceCounter = 0;
  private turnId: TurnId = 0;
  private remoteSequence: number | undefined;
  private disposed = false;

  constructor(options: NetworkManagerOptions) {
    this.transport = options.transport;
    this.matchIdValue = options.matchId;
    this.localPlayerId = options.localPlayerId;
    // transport 回调统一经本类转发与兜底；dispose 时逐一取消
    this.transportCancels.push(
      this.transport.onMessage((envelope) => this.handleTransportMessage(envelope)),
      this.transport.onStateChange((state) => this.forwardStateChange(state)),
      this.transport.onDisconnect((reason) => this.forwardDisconnect(reason)),
    );
  }

  get state(): TransportState {
    return this.transport.state;
  }

  /** 本通道绑定的 matchId（出站 envelope 全部戳记该值；
   * Phase 14 Coordinator 以它校验入站 envelope.matchId 一致性） */
  get matchId(): MatchId {
    return this.matchIdValue;
  }

  /** 远端最近 sequence（按 max 合并；未收到过消息为 undefined）—— Phase 14/15 消费 */
  get lastRemoteSequence(): number | undefined {
    return this.remoteSequence;
  }

  /** 当前回合一：随出站 envelope 戳记。Phase 14 由 TurnManager 驱动 */
  get currentTurnId(): TurnId {
    return this.turnId;
  }

  setTurnId(turnId: TurnId): void {
    this.turnId = turnId;
  }

  send<T>(type: NetworkMessageType, payload: T): void {
    if (this.disposed) {
      throw new TransportError('TRANSPORT_CLOSED', '[NetworkManager] send rejected: manager disposed');
    }
    const raw: NetworkEnvelope<T> = {
      version: 1,
      type,
      matchId: this.matchIdValue,
      turnId: this.turnId,
      senderId: this.localPlayerId,
      sequence: ++this.sequenceCounter, // 计数器从 0 起：首条 = 1，跨消息类型连续
      timestamp: Date.now(),
      payload,
    };
    // 组装数据过协议防线：失败即本类 bug，NetworkProtocolError 原样上抛
    const envelope = validateEnvelope(raw);
    // 通道不可用 → transport throw TransportError（永不静默）
    this.transport.send(envelope);
  }

  onMessage<T>(type: NetworkMessageType, handler: (envelope: NetworkEnvelope<T>) => void): () => void {
    let handlers = this.messageHandlers.get(type);
    if (handlers === undefined) {
      handlers = new Set<EnvelopeHandler>();
      this.messageHandlers.set(type, handlers);
    }
    const wrapped: EnvelopeHandler = (envelope) => handler(envelope as NetworkEnvelope<T>);
    handlers.add(wrapped);
    return () => {
      handlers.delete(wrapped);
    };
  }

  /** 发 PING（payload {sentAt}）；对端 NetworkManager 收到后自动回 PONG */
  ping(): void {
    this.send<PingPongPayload>(NetworkMessageType.PING, { sentAt: Date.now() });
  }

  /** 订阅 PONG 应答：RTT = Date.now() − envelope.payload.sentAt */
  onPong(handler: (envelope: NetworkEnvelope<PingPongPayload>) => void): () => void {
    return this.onMessage<PingPongPayload>(NetworkMessageType.PONG, handler);
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

  connect(): Promise<void> {
    return this.transport.connect();
  }

  /**
   * 断开：transport.close() 为终态（接口契约）。重连 / REMATCH
   * （Phase 13+）一律新建 transport + NetworkManager，不复活旧通道。
   */
  disconnect(): void {
    this.transport.close();
  }

  /** 清全部订阅 + close transport；幂等 */
  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    for (const cancel of this.transportCancels) {
      cancel();
    }
    this.transportCancels.length = 0;
    this.messageHandlers.clear();
    this.stateChangeHandlers.clear();
    this.disconnectHandlers.clear();
    this.transport.close();
  }

  // ---- 内部 ----

  private handleTransportMessage(envelope: NetworkEnvelope): void {
    if (this.disposed) {
      return;
    }
    this.remoteSequence =
      this.remoteSequence === undefined
        ? envelope.sequence
        : Math.max(this.remoteSequence, envelope.sequence);
    if (envelope.type === NetworkMessageType.PING) {
      // F1（Phase 12 review 遗留）：入站 PING payload 视为 Untrusted Input ——
      // 形状守卫后才自动回声，畸形 PING 丢弃不回声（仍分发给订阅者）
      if (isPingPongPayload(envelope.payload)) {
        try {
          this.send<PingPongPayload>(NetworkMessageType.PONG, envelope.payload);
        } catch (error) {
          // 回复失败（通道已断）只记录，不影响后续分发
          console.error('[NetworkManager] PONG auto-reply failed:', error);
        }
      } else {
        console.warn(
          '[NetworkManager] dropped malformed PING payload (expected { sentAt: number }):',
          envelope.payload,
        );
      }
    }
    const handlers = this.messageHandlers.get(envelope.type);
    if (handlers === undefined || handlers.size === 0) {
      return;
    }
    for (const handler of [...handlers]) {
      try {
        handler(envelope);
      } catch (error) {
        console.error(`[NetworkManager] onMessage handler for ${envelope.type} threw:`, error);
      }
    }
  }

  private forwardStateChange(state: TransportState): void {
    if (this.disposed) {
      return;
    }
    for (const handler of [...this.stateChangeHandlers]) {
      try {
        handler(state);
      } catch (error) {
        console.error('[NetworkManager] onStateChange handler threw:', error);
      }
    }
  }

  private forwardDisconnect(reason?: string): void {
    if (this.disposed) {
      return;
    }
    for (const handler of [...this.disconnectHandlers]) {
      try {
        handler(reason);
      } catch (error) {
        console.error('[NetworkManager] onDisconnect handler threw:', error);
      }
    }
  }
}
