import { CameraMode } from './CameraMode';

/**
 * Aim 流程的相机模式转移表（纯函数，可单测）。
 * 返回 null 表示该请求在当前模式下应被忽略。
 *
 * 流程（CODELY.md §9）：
 *   FREE_VIEW →(requestAim)→ RETURN_HOME →(tween 完成)→ AIMING
 *   AIMING / RETURN_HOME →(cancel)→ FREE_VIEW（尚未发射前允许反复）
 */

export function nextModeOnAimRequest(mode: CameraMode): CameraMode | null {
  // 只有自由观察状态可以发起瞄准
  if (mode === CameraMode.FREE_VIEW) {
    return CameraMode.RETURN_HOME;
  }
  return null;
}

export function modeAfterReturnHome(mode: CameraMode): CameraMode | null {
  // 回家完成后正式进入 AIMING
  if (mode === CameraMode.RETURN_HOME) {
    return CameraMode.AIMING;
  }
  return null;
}

export function nextModeOnAimCancel(mode: CameraMode): CameraMode | null {
  // 瞄准中或回家途中都可以取消，回到自由观察
  if (mode === CameraMode.AIMING || mode === CameraMode.RETURN_HOME) {
    return CameraMode.FREE_VIEW;
  }
  return null;
}
