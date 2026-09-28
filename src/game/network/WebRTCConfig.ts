/**
 * WebRTC 连接配置（Phase 12 委托②）。
 *
 * * iceServers —— ICE server 列表。开发默认只用公共 STUN（协助 NAT
 *   traversal，无凭据、无账号）。
 * * 架构允许未来注入 TURN（严格 NAT / 企业防火墙场景的中继），
 *   Phase 12 不部署任何 TURN —— TURN 凭据属部署环境 / signaling，
 *   禁止出现在仓库或客户端代码（任何 secret 一律不入库）。
 * * 真实环境的 iceServers 由 Phase 13 房间 / 连接流程按环境注入；
 *   测试注入 fake factory，不触本默认值。
 */
export interface WebRTCConfig {
  readonly iceServers: RTCIceServer[];
}

/** STUN-only 开发默认（无 secret；TURN 由部署环境按需注入，Phase 12 不部署） */
export const DEFAULT_WEBRTC_CONFIG: WebRTCConfig = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
};
