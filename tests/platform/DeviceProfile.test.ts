import { describe, expect, it } from 'vitest';
import {
  resolveControlProfile,
  type InputCapabilities,
} from '../../src/game/platform/DeviceProfile';

/**
 * Control Profile 只由输入能力决定（CODELY.md §25 禁止 User Agent 判断）。
 */

const fine = (touchPoints: number): InputCapabilities => ({
  primaryPointerFine: true,
  primaryPointerHover: true,
  maxTouchPoints: touchPoints,
});

const coarse = (touchPoints: number): InputCapabilities => ({
  primaryPointerFine: false,
  primaryPointerHover: false,
  maxTouchPoints: touchPoints,
});

describe('resolveControlProfile（能力矩阵）', () => {
  it('无触摸硬件 → desktop', () => {
    expect(resolveControlProfile(fine(0))).toBe('desktop');
  });

  it('maxTouchPoints 未定义 / 负数 → desktop', () => {
    expect(resolveControlProfile(fine(-1))).toBe('desktop');
  });

  it('手机典型：coarse + 不可悬停 + 多触点 → touch', () => {
    expect(resolveControlProfile(coarse(5))).toBe('touch');
  });

  it('coarse 但无触摸点（异常组合）→ desktop（触屏 UI 无意义）', () => {
    expect(
      resolveControlProfile({
        primaryPointerFine: false,
        primaryPointerHover: false,
        maxTouchPoints: 0,
      })
    ).toBe('desktop');
  });

  it('混合设备：fine + hover + 有触摸（Surface / 触屏笔记本）→ desktop', () => {
    expect(resolveControlProfile(fine(10))).toBe('desktop');
  });

  it('fine 指针但不可悬停 + 触摸 → touch（以手指为主的交互优先）', () => {
    expect(
      resolveControlProfile({
        primaryPointerFine: true,
        primaryPointerHover: false,
        maxTouchPoints: 5,
      })
    ).toBe('touch');
  });
});
