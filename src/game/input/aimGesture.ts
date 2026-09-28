/**
 * 瞄准触控手势纯函数（Phase 6.5，CODELY.md §25 Aim Dead Zone）。
 *
 * 触摸拖拽在超过死区前处于 pending 状态：
 * 防止手指落点抖动 / 误触直接进入瞄准。
 * 死区为 0（桌面鼠标）时立即激活，与 Phase 4 行为一致。
 */

export interface AimPendingDrag {
  /** pointerdown 的屏幕坐标 */
  startScreenX: number;
  startScreenY: number;
}

/** 拖动是否超过死区（屏幕 px）；deadZonePx ≤ 0 视为立即激活 */
export function exceedsAimDeadZone(
  pending: AimPendingDrag,
  screenX: number,
  screenY: number,
  deadZonePx: number
): boolean {
  if (deadZonePx <= 0) {
    return true;
  }
  const dx = screenX - pending.startScreenX;
  const dy = screenY - pending.startScreenY;
  return Math.hypot(dx, dy) > deadZonePx;
}
