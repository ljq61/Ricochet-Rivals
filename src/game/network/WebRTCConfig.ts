/**
 * WebRTC 连接配置（Phase 12 委托② / SG-6 扩展）。
 *
 * * iceServers —— ICE server 列表。开发默认只用公共 STUN；正式 Room 流的
 *   列表来自 Signaling ROOM ack（SG-6：STUN + TURN 临时凭据 —— time-limited
 *   credential，shared secret 只存 coturn 与 Signaling 两侧环境变量，
 *   永不入仓库 / 客户端 bundle）。
 * * iceTransportPolicy（SG-6）—— 缺省 'all'（production 禁默认 relay：能直连
 *   → direct，不能 → TURN 自动兜底）。DEBUG_FORCE_RELAY 验证 TURN 可用性时
 *   显式传 'relay'。
 * * 测试注入 fake factory，不触本默认值。
 */
export interface WebRTCConfig {
  readonly iceServers: RTCIceServer[];
  /** SG-6：缺省 'all'；'relay' 仅限 DEBUG_FORCE_RELAY 验证 TURN */
  readonly iceTransportPolicy?: RTCIceTransportPolicy;
}

/** STUN-only 开发默认（Manual Debug 流用；Room 流用 Signaling 下发的列表） */
export const DEFAULT_WEBRTC_CONFIG: WebRTCConfig = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
};
