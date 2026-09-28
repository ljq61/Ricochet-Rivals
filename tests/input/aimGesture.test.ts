import { describe, expect, it } from 'vitest';
import {
  exceedsAimDeadZone,
  type AimPendingDrag,
} from '../../src/game/input/aimGesture';

/**
 * 瞄准死区（CODELY.md §25 Aim Dead Zone）：
 * 触摸拖动超过死区才激活瞄准，防止落点抖动 / 误触直接发射。
 */

const PENDING: AimPendingDrag = { startScreenX: 100, startScreenY: 100 };

describe('exceedsAimDeadZone', () => {
  it('死区为 0（桌面）→ 立即激活（与 Phase 4 行为一致）', () => {
    expect(exceedsAimDeadZone(PENDING, 100, 100, 0)).toBe(true);
    expect(exceedsAimDeadZone(PENDING, 100, 100, -1)).toBe(true);
  });

  it('死区内（≤14px）不激活', () => {
    expect(exceedsAimDeadZone(PENDING, 110, 100, 14)).toBe(false); // dx=10
    expect(exceedsAimDeadZone(PENDING, 100, 114, 14)).toBe(false); // dy=14（未超过）
    expect(exceedsAimDeadZone(PENDING, 105, 105, 14)).toBe(false); // 对角 ≈ 7.07
  });

  it('超过死区（>14px）激活', () => {
    expect(exceedsAimDeadZone(PENDING, 115, 100, 14)).toBe(true); // dx=15
    expect(exceedsAimDeadZone(PENDING, 100, 115, 14)).toBe(true); // dy=15
    expect(exceedsAimDeadZone(PENDING, 85, 100, 14)).toBe(true); // 反方向 dx=−15 同样计入
  });

  it('对角距离按欧氏范数计算', () => {
    // dx=10, dy=10 → 距离 ≈ 14.14 > 14
    expect(exceedsAimDeadZone(PENDING, 110, 110, 14)).toBe(true);
  });
});
