/**
 * RoomConnectionState（SG-3）—— 房间码连接流程状态机（UI 渲染契约）。
 *
 * 与 Manual SDP 流的 OnlineConnectionState 完全独立（后者保留为
 * DEBUG_GAME 门控 fallback，迁移稳定后单独 Cleanup）。
 * 转移由 RoomConnectionController 驱动；Scene 只按状态渲染。
 *
 * 流程（Online Connection Migration 规格 Stage SG-3）：
 * * Host：IDLE → CONNECTING_SIGNALING → CREATING_ROOM → ROOM_WAITING
 *   （展示房间码）→ PEER_JOINED → NEGOTIATING（createOffer → sendOffer）
 *   → ANSWER → acceptAnswer → CONNECTING → CONNECTED → VERIFIED
 * * Guest：IDLE → CONNECTING_SIGNALING → JOINING_ROOM → ROOM_JOINED 即
 *   NEGOTIATING（Host 已在房内）→ 收 OFFER → acceptOffer → createAnswer
 *   → sendAnswer → CONNECTING → CONNECTED → VERIFIED
 */

export enum RoomConnectionState {
  /** 初始态：未开始（CREATE GAME / JOIN GAME） */
  IDLE = 'IDLE',
  /** Signaling WS 拨号中 */
  CONNECTING_SIGNALING = 'CONNECTING_SIGNALING',
  /** Host：CREATE_ROOM 已发，等 ROOM_CREATED */
  CREATING_ROOM = 'CREATING_ROOM',
  /** Host：房间已建，展示房间码等对手（Server TTL 到点推 ERROR） */
  ROOM_WAITING = 'ROOM_WAITING',
  /** Guest：JOIN_ROOM 已发，等 ROOM_JOINED */
  JOINING_ROOM = 'JOINING_ROOM',
  /** Offer/Answer 自动交换中 */
  NEGOTIATING = 'NEGOTIATING',
  /** DataChannel 等待 open */
  CONNECTING = 'CONNECTING',
  /** 通道已 open，PING/PONG 验证中 */
  CONNECTED = 'CONNECTED',
  /** 验证通过，OnlineSession 就绪（交接 SessionManager） */
  VERIFIED = 'VERIFIED',
  FAILED = 'FAILED',
  CLOSED = 'CLOSED',
}

/**
 * 失败分类（SG-7 失败 UX 的原始输入；正式文案由 Scene 映射）。
 * 对应规格内部区分：SIGNALING_FAILED / ROOM_NOT_FOUND·ROOM_FULL·…（SERVER_ERROR
 * 的 code）/ OFFER_FAILED / ANSWER_FAILED / PEER_LEFT / DATA_CHANNEL_FAILED
 * （CONNECT_FAILED）/ VERIFICATION_TIMEOUT。
 */
export type RoomConnectionFailureReason =
  /** Signaling WS 拨号失败 / 超时 / 中断（携带 SignalingFailure reason） */
  | 'SIGNALING_FAILED'
  /** Signaling Server ERROR 消息（code 字段承载 ROOM_NOT_FOUND / ROOM_FULL / ROOM_EXPIRED / …） */
  | 'SERVER_ERROR'
  /** 本端房间码输入不合法（UI 应保留输入允许直接重试） */
  | 'INVALID_ROOM_CODE'
  /** transport / NetworkManager 创建失败（无 WebRTC 支持等） */
  | 'SETUP_FAILED'
  /** Host：createOffer / acceptAnswer 异常 */
  | 'OFFER_FAILED'
  /** Guest：acceptOffer / createAnswer 异常 */
  | 'ANSWER_FAILED'
  /** 协商期对端离开（PEER_LEFT / 房间被服务器终止） */
  | 'PEER_LEFT'
  /** 协商 deadline 超时 / DataChannel 未 open / 通道中断（DATA_CHANNEL_FAILED） */
  | 'CONNECT_FAILED'
  /** CONNECTED 后验证窗口内无 PONG */
  | 'VERIFICATION_TIMEOUT';

export interface RoomConnectionFailure {
  readonly reason: RoomConnectionFailureReason;
  /** SERVER_ERROR 时承载服务器错误码（ROOM_NOT_FOUND 等） */
  readonly code?: string;
  readonly detail?: string;
}
