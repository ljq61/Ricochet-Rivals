/**
 * DeviceProfile — 控制档位检测（Phase 6.5，CODELY.md §25）。
 *
 * 规则：禁止通过 User Agent 判断 iPhone / Android。
 * 只根据实际输入能力决定 Control Profile：
 * - pointer capability（主输入精度：fine / coarse）
 * - hover capability（能否悬停）
 * - 触点数量（navigator.maxTouchPoints）
 * - viewport（尺寸 / 方向由 ViewportService 单独消费）
 *
 * Profile 只决定 Input Adapter 与 HUD Layout；
 * Gameplay（GameState / Command / Movement / Aim / Projectile）不分端。
 */

export type ControlProfile = 'desktop' | 'touch';

/** 能力快照（由 DOM 检测注入，纯函数可单测） */
export interface InputCapabilities {
  /** matchMedia('(pointer: fine)')：主输入设备精确（鼠标 / 触控板） */
  primaryPointerFine: boolean;
  /** matchMedia('(hover: hover)')：主输入可悬停 */
  primaryPointerHover: boolean;
  /** navigator.maxTouchPoints：可同时追踪的触点数（0 = 无触摸硬件） */
  maxTouchPoints: number;
}

export interface DeviceProfile {
  controlProfile: ControlProfile;
  /** 原始能力（DebugOverlay 展示用） */
  capabilities: InputCapabilities;
}

/**
 * 纯函数：由能力快照决定控制档位。
 *
 * 判定规则：
 * 1. 无触摸硬件（maxTouchPoints ≤ 0）→ desktop（触屏 UI 无意义）
 * 2. 主输入 coarse 或不可悬停 → touch（手指为主输入）
 * 3. 精确指针 + 可悬停 + 有触摸（Surface / 触屏笔记本）→ desktop
 *    （鼠标为主输入，触屏仍可用 —— 指针手势两条 profile 都能吃）
 */
export function resolveControlProfile(
  capabilities: InputCapabilities
): ControlProfile {
  if (capabilities.maxTouchPoints <= 0) {
    return 'desktop';
  }
  if (!capabilities.primaryPointerFine || !capabilities.primaryPointerHover) {
    return 'touch';
  }
  return 'desktop';
}

export function resolveDeviceProfile(
  capabilities: InputCapabilities
): DeviceProfile {
  return {
    controlProfile: resolveControlProfile(capabilities),
    capabilities,
  };
}

/** DOM 检测（薄封装，检测逻辑在纯函数中可测） */
export function detectDeviceProfile(): DeviceProfile {
  return resolveDeviceProfile({
    primaryPointerFine: window.matchMedia('(pointer: fine)').matches,
    primaryPointerHover: window.matchMedia('(hover: hover)').matches,
    maxTouchPoints:
      typeof navigator.maxTouchPoints === 'number' ? navigator.maxTouchPoints : 0,
  });
}
