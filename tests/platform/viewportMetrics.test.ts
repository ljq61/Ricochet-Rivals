import { describe, expect, it } from 'vitest';
import {
  computeViewportMetrics,
  type SafeAreaInsets,
} from '../../src/game/platform/viewportMath';
import { GAME_CONFIG } from '../../src/game/config/GameConfig';

/**
 * Viewport 策略（CODELY.md §25 / Phase 6.5）：
 * - 纵向构图稳定：zoom = height / worldViewHeight，
 *   所有设备显示相同的世界纵向范围
 * - 19.5:9 / 20:9 超宽屏自然看到更多横向场景
 * - World / Physics 参数完全不随设备改变
 */

const NO_SAFE_AREA: SafeAreaInsets = {
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
};

const WORLD_VIEW_H = GAME_CONFIG.viewport.worldViewHeight;
const MIN_ZOOM = GAME_CONFIG.viewport.minZoom;
const MAX_ZOOM = GAME_CONFIG.viewport.maxZoom;

describe('computeViewportMetrics — 纵向构图稳定', () => {
  it('桌面 16:9 1080p：zoom = 1，行为与 Phase 1～6 完全一致', () => {
    const m = computeViewportMetrics(1920, 1080, NO_SAFE_AREA);
    expect(m.zoom).toBeCloseTo(1, 10);
    expect(m.visibleWorldWidth).toBeCloseTo(1920, 10);
    expect(m.visibleWorldHeight).toBeCloseTo(1080, 10);
    expect(m.orientation).toBe('landscape');
  });

  it('超宽手机 19.5:9（844×390）：纵向构图相同，横向看到更多世界', () => {
    const desktop = computeViewportMetrics(1920, 1080, NO_SAFE_AREA);
    const phone = computeViewportMetrics(844, 390, NO_SAFE_AREA);

    // 纵向构图稳定：可见世界高度一致
    expect(phone.visibleWorldHeight).toBeCloseTo(WORLD_VIEW_H, 10);
    // 横向自然扩展：手机可见世界宽度 > 桌面 16:9
    expect(phone.visibleWorldWidth).toBeGreaterThan(desktop.visibleWorldWidth);
    expect(phone.zoom).toBeCloseTo(390 / WORLD_VIEW_H, 10);
  });

  it('20:9 超宽（832×360）比 16:9（640×360）同高度看到更宽', () => {
    const ultrawide = computeViewportMetrics(832, 360, NO_SAFE_AREA);
    const sixteenNine = computeViewportMetrics(640, 360, NO_SAFE_AREA);
    expect(ultrawide.visibleWorldHeight).toBeCloseTo(
      sixteenNine.visibleWorldHeight,
      10
    );
    expect(ultrawide.visibleWorldWidth).toBeGreaterThan(
      sixteenNine.visibleWorldWidth
    );
  });

  it('zoom 随高度等比：同窗口高度不同宽度 → zoom 相同', () => {
    const a = computeViewportMetrics(800, 600, NO_SAFE_AREA);
    const b = computeViewportMetrics(1280, 600, NO_SAFE_AREA);
    expect(a.zoom).toBeCloseTo(b.zoom, 10);
  });

  it('极矮视口：zoom 不低于 minZoom（可见纵向范围被压缩为防御上限）', () => {
    const m = computeViewportMetrics(1920, 200, NO_SAFE_AREA);
    expect(m.zoom).toBe(MIN_ZOOM);
    expect(m.visibleWorldHeight).toBe(200 / MIN_ZOOM);
  });

  it('极高视口：zoom 不超过 maxZoom', () => {
    const m = computeViewportMetrics(1000, 5000, NO_SAFE_AREA);
    expect(m.zoom).toBe(MAX_ZOOM);
  });

  it('方向判定：宽 ≥ 高 = landscape，反之为 portrait', () => {
    expect(computeViewportMetrics(390, 844, NO_SAFE_AREA).orientation).toBe(
      'portrait'
    );
    expect(computeViewportMetrics(500, 500, NO_SAFE_AREA).orientation).toBe(
      'landscape'
    );
  });

  it('safe area 原样透传（HUD 布局消费）', () => {
    const insets: SafeAreaInsets = { top: 0, right: 59, bottom: 34, left: 59 };
    const m = computeViewportMetrics(844, 390, insets);
    expect(m.safeArea).toEqual(insets);
  });

  it('自定义 config：worldViewHeight 可调（默认 = world.height 1080）', () => {
    const m = computeViewportMetrics(1000, 500, NO_SAFE_AREA, {
      viewport: { worldViewHeight: 1000, minZoom: 0.2, maxZoom: 4 },
    });
    expect(m.zoom).toBeCloseTo(0.5, 10);
    expect(m.visibleWorldHeight).toBeCloseTo(1000, 10);
  });

  it('uiScale（DPR）口径：物理像素输入 → zoom 随 DPR 放大，可见世界不变', () => {
    // iPhone 级：CSS 844×390 @DPR 3（游戏坐标 = 物理像素，清晰渲染）
    const css = computeViewportMetrics(844, 390, NO_SAFE_AREA, undefined, 1);
    const physical = computeViewportMetrics(
      844 * 3,
      390 * 3,
      NO_SAFE_AREA,
      undefined,
      3
    );
    expect(physical.uiScale).toBe(3);
    expect(physical.zoom).toBeCloseTo(css.zoom * 3, 10);
    // 纵向构图稳定：可见世界与 CSS 口径完全一致（zoom 补偿了 DPR）
    expect(physical.visibleWorldHeight).toBeCloseTo(css.visibleWorldHeight, 10);
    expect(physical.visibleWorldWidth).toBeCloseTo(css.visibleWorldWidth, 10);
  });

  it('uiScale 透传（HUD 尺寸 / 字号 ×uiScale 消费；默认 1）', () => {
    const m = computeViewportMetrics(500, 300, NO_SAFE_AREA, undefined, 2);
    expect(m.uiScale).toBe(2);
    expect(computeViewportMetrics(500, 300, NO_SAFE_AREA).uiScale).toBe(1);
  });
});
