import type { NetworkEnvelope } from './NetworkEnvelope';
import type { TransportState } from './TransportState';

/** Transport 契约错误原因 */
export type TransportErrorReason =
  /** 通道未就绪（IDLE / CONNECTING / DISCONNECTED）—— send() 拒绝 */
  | 'NOT_CONNECTED'
  /** 通道已终态（CLOSED / FAILED）—— send() 与 connect() 均拒绝 */
  | 'TRANSPORT_CLOSED'
  /** 连接建立失败（WebRTCTransport：dataChannel open 超时 / 握手期通道中断）—— connect() reject */
  | 'CONNECT_FAILED'
  /** 信令载荷非法（WebRTCTransport：offer/answer JSON 解码失败 / 类型不匹配）—— acceptOffer/acceptAnswer 等 reject */
  | 'INVALID_SIGNALING';

/**
 * Transport 契约错误：通道不可用时 send()/connect() 显式抛出；
 * WebRTCTransport 的连接建立失败与 offer/answer 信令解码失败同用本错误
 * （reason 语义见 TransportErrorReason 注释）。
 *
 * 项目规则"send 不可用禁止静默失败"：与 FireResult accepted/reason 同属
 * "不吞错"原则，但 Transport 侧失败没有"部分成功"的语义可继续，
 * 故选择 throw 而非 Result —— 调用方（NetworkManager）必须处理。
 */
export class TransportError extends Error {
  readonly reason: TransportErrorReason;

  constructor(reason: TransportErrorReason, message: string) {
    super(message);
    this.name = 'TransportError';
    this.reason = reason;
  }
}

/**
 * 网络传输抽象（TASKS.md Contracts + Phase 12 扩展 state/onStateChange）。
 * Game Logic / NetworkManager 只依赖本接口，禁止 import RTCPeerConnection。
 *
 * 契约语义：
 * * send 在通道不可用时 throw TransportError；envelope 非法时由实现
 *   的序列化防线 throw NetworkProtocolError —— 永不静默失败。
 * * onMessage / onStateChange / onDisconnect 返回取消函数（同 CommandBus 风格）。
 * * close 幂等；触发对端 DISCONNECTED + onDisconnect。
 */
export interface NetworkTransport {
  /** 当前生命周期状态 */
  readonly state: TransportState;
  /** state === CONNECTED 的便捷读法 */
  readonly connected: boolean;
  /** 建立通道；终态（DISCONNECTED / CLOSED / FAILED）下 reject TransportError */
  connect(): Promise<void>;
  /** 发送消息（不可用时 throw，见类注释） */
  send(message: NetworkEnvelope): void;
  /** 订阅对端消息；返回取消函数 */
  onMessage(handler: (message: NetworkEnvelope) => void): () => void;
  /** 订阅状态变化（每次迁移触发一次，携带新状态）；返回取消函数 */
  onStateChange(handler: (state: TransportState) => void): () => void;
  /** 订阅通道中断（对端关闭 / 掉线，携带原因）；返回取消函数 */
  onDisconnect(handler: (reason?: string) => void): () => void;
  /** 主动关闭（幂等） */
  close(): void;
}
