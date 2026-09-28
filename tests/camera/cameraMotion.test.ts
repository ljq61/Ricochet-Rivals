import { describe, expect, it } from 'vitest';
import { exponentialApproach } from '../../src/game/camera/cameraMotion';

describe('exponentialApproach（相机平滑跟随）', () => {
  it('逐步逼近目标且不越过', () => {
    let value = 0;
    for (let i = 0; i < 60; i++) {
      value = exponentialApproach(value, 100, 10, 16.67);
    }
    // 1 秒后应接近但不超过目标
    expect(value).toBeGreaterThan(99);
    expect(value).toBeLessThanOrEqual(100);
  });

  it('时间可加性：两帧 16.67ms ≈ 一帧 33.34ms（帧率无关）', () => {
    const twoFrames = exponentialApproach(
      exponentialApproach(0, 100, 10, 16.67),
      100,
      10,
      16.67
    );
    const oneFrame = exponentialApproach(0, 100, 10, 33.34);
    expect(twoFrames).toBeCloseTo(oneFrame, 9);
  });

  it('速率越大收敛越快', () => {
    const slow = exponentialApproach(0, 100, 5, 100);
    const fast = exponentialApproach(0, 100, 20, 100);
    expect(fast).toBeGreaterThan(slow);
  });

  it('rate <= 0 时保持不动', () => {
    expect(exponentialApproach(42, 100, 0, 16.67)).toBe(42);
    expect(exponentialApproach(42, 100, -5, 16.67)).toBe(42);
  });

  it('大 deltaMs 直接贴近目标', () => {
    const value = exponentialApproach(0, 100, 10, 60000);
    expect(value).toBeCloseTo(100, 0);
  });
});
