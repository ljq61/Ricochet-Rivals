/**
 * OnlineConnectionState（Phase 13）—— 手动配对流程状态机。
 *
 * Scene 只按状态渲染 UI；转移由 OnlineConnectionController 驱动。
 * 非法转移一律忽略（与 aimFlow / TurnManager 同防御风格）。
 */
export enum OnlineConnectionState {
  /** 首屏：CREATE / JOIN / BACK */
  CHOOSE_ROLE = 'CHOOSE_ROLE',
  /** Host：生成 Offer 中（含 ICE gathering 等待） */
  HOST_CREATING_OFFER = 'HOST_CREATING_OFFER',
  /** Host：展示 Code，等待粘贴 Guest Response */
  HOST_WAITING_FOR_ANSWER = 'HOST_WAITING_FOR_ANSWER',
  /** Host：应用 Answer → 连接验证中 */
  HOST_APPLYING_ANSWER = 'HOST_APPLYING_ANSWER',
  /** Guest：等待粘贴 Host Code */
  GUEST_WAITING_FOR_OFFER = 'GUEST_WAITING_FOR_OFFER',
  /** Guest：生成 Response 中（acceptOffer → createAnswer → ICE） */
  GUEST_CREATING_ANSWER = 'GUEST_CREATING_ANSWER',
  /** Guest：Response 已展示，等 Host 接受（通道打开即推进） */
  GUEST_WAITING_FOR_HOST = 'GUEST_WAITING_FOR_HOST',
  /** 双方：等待 DataChannel open */
  CONNECTING = 'CONNECTING',
  /** DataChannel 已 open，PING/PONG 验证中 */
  CONNECTED = 'CONNECTED',
  /** PING/PONG 验证通过，OnlineSession 就绪 */
  VERIFIED = 'VERIFIED',
  FAILED = 'FAILED',
  CLOSED = 'CLOSED',
}
