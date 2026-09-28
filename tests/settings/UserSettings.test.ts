import { describe, expect, it, beforeEach } from 'vitest';
import {
  getUserSettings,
  resetUserSettingsForTest,
  toggleSound,
} from '../../src/game/settings/UserSettings';

/**
 * UserSettings（Phase 11）：Sound 开关。
 * 测试环境无 localStorage → 走内存兜底路径（同时验证 Scene 切换间保持）。
 */

describe('UserSettings', () => {
  beforeEach(() => {
    resetUserSettingsForTest();
  });

  it('默认开启声音', () => {
    expect(getUserSettings().soundEnabled).toBe(true);
  });

  it('toggle 翻转并保持（Scene 切换间状态不丢）', () => {
    expect(toggleSound()).toBe(false);
    expect(getUserSettings().soundEnabled).toBe(false);
    expect(toggleSound()).toBe(true);
    expect(getUserSettings().soundEnabled).toBe(true);
  });
});
