import { describe, expect, it } from 'vitest';
import { CameraMode } from '../../src/game/camera/CameraMode';
import {
  modeAfterReturnHome,
  nextModeOnAimCancel,
  nextModeOnAimRequest,
} from '../../src/game/camera/aimFlow';

describe('aimFlow 转移表', () => {
  describe('nextModeOnAimRequest（发起瞄准）', () => {
    it('FREE_VIEW → RETURN_HOME', () => {
      expect(nextModeOnAimRequest(CameraMode.FREE_VIEW)).toBe(
        CameraMode.RETURN_HOME
      );
    });

    it('AIMING / RETURN_HOME 中再请求被忽略', () => {
      expect(nextModeOnAimRequest(CameraMode.AIMING)).toBeNull();
      expect(nextModeOnAimRequest(CameraMode.RETURN_HOME)).toBeNull();
    });

    it('后续 Phase 的模式（弹道跟随/爆炸/回合切换）不被瞄准请求打断', () => {
      expect(nextModeOnAimRequest(CameraMode.PROJECTILE_FOLLOW)).toBeNull();
      expect(nextModeOnAimRequest(CameraMode.IMPACT)).toBeNull();
      expect(nextModeOnAimRequest(CameraMode.TURN_TRANSITION)).toBeNull();
    });
  });

  describe('modeAfterReturnHome（回家完成）', () => {
    it('RETURN_HOME 完成 → AIMING', () => {
      expect(modeAfterReturnHome(CameraMode.RETURN_HOME)).toBe(
        CameraMode.AIMING
      );
    });

    it('非 RETURN_HOME 完成回调被忽略', () => {
      expect(modeAfterReturnHome(CameraMode.FREE_VIEW)).toBeNull();
      expect(modeAfterReturnHome(CameraMode.AIMING)).toBeNull();
    });
  });

  describe('nextModeOnAimCancel（取消瞄准）', () => {
    it('AIMING → FREE_VIEW', () => {
      expect(nextModeOnAimCancel(CameraMode.AIMING)).toBe(
        CameraMode.FREE_VIEW
      );
    });

    it('RETURN_HOME 途中取消 → FREE_VIEW（中断回家）', () => {
      expect(nextModeOnAimCancel(CameraMode.RETURN_HOME)).toBe(
        CameraMode.FREE_VIEW
      );
    });

    it('FREE_VIEW 与后续 Phase 模式取消被忽略', () => {
      expect(nextModeOnAimCancel(CameraMode.FREE_VIEW)).toBeNull();
      expect(nextModeOnAimCancel(CameraMode.PROJECTILE_FOLLOW)).toBeNull();
      expect(nextModeOnAimCancel(CameraMode.IMPACT)).toBeNull();
      expect(nextModeOnAimCancel(CameraMode.TURN_TRANSITION)).toBeNull();
    });
  });
});
