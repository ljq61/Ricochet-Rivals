/**
 * Phase 15 联机同步状态机（Turn Boundary 同步）。
 *
 * 状态流（Guest 恢复链；Host 仅经重试阶梯进入 SYNC_FAILED）：
 *
 *   SYNCED ──hash mismatch / MISSING_TURN_RESULT / future turn──▶ DESYNC_DETECTED
 *   DESYNC_DETECTED ──STATE_SYNC_REQUEST 发出──▶ SYNC_REQUESTED
 *   SYNC_REQUESTED ──STATE_SNAPSHOT 到达──▶ APPLYING_SNAPSHOT
 *   APPLYING_SNAPSHOT ──复验一致──▶ SYNCED_AFTER_RECOVERY
 *   APPLYING_SNAPSHOT ──validator 拒绝──▶ SYNC_REQUESTED（重试 ≤ 2 次）
 *   任意恢复态 ──重试耗尽 / apply 后复验失败──▶ SYNC_FAILED（终局）
 *
 * SYNCED_AFTER_RECOVERY 为粘性诊断态：本局发生过恢复即保持 —— 是否同步
 * 的流程判定一律以 TURN_RESULT 边界 hash 为准，本枚举只做提示 / DEBUG
 * 展示（SYNCED_AFTER_RECOVERY 与 SYNCED 对 gating 同义）。
 *
 * 仅本地状态（不进 wire envelope）；单一事实源在 OnlineGameCoordinator。
 */
export enum OnlineSyncState {
  SYNCED = 'SYNCED',
  DESYNC_DETECTED = 'DESYNC_DETECTED',
  SYNC_REQUESTED = 'SYNC_REQUESTED',
  APPLYING_SNAPSHOT = 'APPLYING_SNAPSHOT',
  SYNCED_AFTER_RECOVERY = 'SYNCED_AFTER_RECOVERY',
  SYNC_FAILED = 'SYNC_FAILED',
}
