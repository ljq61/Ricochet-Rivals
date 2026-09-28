import { describe, expect, it } from 'vitest';
import {
  clampCameraCenterX,
  groundAnchoredCenterY,
} from '../../src/game/camera/cameraBounds';
import { GAME_CONFIG } from '../../src/game/config/GameConfig';

const WORLD_W = GAME_CONFIG.world.width;
const WORLD_H = GAME_CONFIG.world.height;

describe('clampCameraCenterX（zoom 无关的中心锚定）', () => {
  it('范围内的值原样保留（可见 1920 → 合法中心区间 [960, 4040]）', () => {
    expect(clampCameraCenterX(1500, 1920, WORLD_W)).toBe(1500);
    expect(clampCameraCenterX(2500, 1920, WORLD_W)).toBe(2500);
  });

  it('低于下界时 clamp 到 visibleWidth/2', () => {
    expect(clampCameraCenterX(-100, 1920, WORLD_W)).toBe(1920 / 2);
    expect(clampCameraCenterX(0, 1920, WORLD_W)).toBe(1920 / 2);
  });

  it('超过上界时 clamp 到 worldWidth − visibleWidth/2', () => {
    expect(clampCameraCenterX(WORLD_W, 1920, WORLD_W)).toBe(
      WORLD_W - 1920 / 2
    );
    expect(clampCameraCenterX(99999, 1920, WORLD_W)).toBe(
      WORLD_W - 1920 / 2
    );
  });

  it('zoom 感知示例：手机 zoom 0.36 可见宽度 2337 → 中心范围 [1168, 3831]', () => {
    const visible = 844 / 0.361; // ≈ 2337
    expect(clampCameraCenterX(0, visible, WORLD_W)).toBeCloseTo(
      visible / 2,
      5
    );
    expect(clampCameraCenterX(WORLD_W, visible, WORLD_W)).toBeCloseTo(
      WORLD_W - visible / 2,
      5
    );
    // 中间值不受影响
    expect(clampCameraCenterX(WORLD_W / 2, visible, WORLD_W)).toBe(
      WORLD_W / 2
    );
  });

  it('可见宽度比 World 宽时水平居中（center = worldWidth/2）', () => {
    expect(clampCameraCenterX(1234, WORLD_W + 1000, WORLD_W)).toBe(
      WORLD_W / 2
    );
  });
});

describe('groundAnchoredCenterY（贴地构图）', () => {
  it('可见高度不足 World：底边对齐 World 底部', () => {
    // 1080 世界 + 900 可见 → center = 1080 − 450 = 630 → scroll = 630 − 900/2 = 180
    expect(groundAnchoredCenterY(900, WORLD_H)).toBe(WORLD_H - 450);
  });

  it('可见高度等于 World：center = worldHeight/2（scroll = 0）', () => {
    expect(groundAnchoredCenterY(WORLD_H, WORLD_H)).toBe(WORLD_H / 2);
  });

  it('可见高度超过 World：垂直居中', () => {
    expect(groundAnchoredCenterY(1440, WORLD_H)).toBe(WORLD_H / 2);
  });

  it('zoom 感知示例：手机高 390、zoom 0.361 → 可见高 ≈ 1080，center = 540', () => {
    const visible = 390 / (390 / 1080); // zoom 公式下可见高恒等于 1080
    expect(visible).toBeCloseTo(1080, 10);
    expect(groundAnchoredCenterY(visible, WORLD_H)).toBe(WORLD_H / 2);
  });
});
