/**
 * Transport 生命周期状态机（Phase 12 协议层）。
 *
 * * IDLE         —— 初始 / 未连接
 * * CONNECTING   —— 握手中（LocalLoopback 同步过渡；WebRTCTransport 有真实握手耗时）
 * * CONNECTED    —— 通道可用（send 合法）
 * * DISCONNECTED —— 对端关闭 / 通道中断（非本端主动 close 的终局）
 * * FAILED       —— 连接失败（WebRTC ICE failed；LocalLoopback 不产生该状态）
 * * CLOSED       —— 本端主动 close（终态）
 */
export enum TransportState {
  IDLE = 'IDLE',
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
  DISCONNECTED = 'DISCONNECTED',
  FAILED = 'FAILED',
  CLOSED = 'CLOSED',
}
