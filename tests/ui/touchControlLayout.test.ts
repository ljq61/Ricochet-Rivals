import { describe, expect, it } from 'vitest';
import { computeViewportMetrics } from '../../src/game/platform/viewportMath';
import { screenMoveButtonLayout, screenRectsOverlap } from '../../src/game/ui/touchControlLayout';
import { touchAimVisualRect } from '../../src/game/ui/touchAimLayout';
import { battleItemDock, battleSettingsRect } from '../../src/game/ui/battleSideDockLayout';
import { battleHudLayout } from '../../src/game/ui/miniMapMath';

const sizes = [
  [320, 568], [844, 390], [932, 430], [320, 180], [480, 180], [600, 180], [844, 180],
  [320, 240], [320, 250], [320, 260], [844, 240], [844, 250], [844, 260],
  [667, 320], [568, 256], [1024, 768],
] as const;

describe('fixed screen movement controls', () => {
  it.each(sizes)('keeps separate touch targets inside %i × %i, clear of the HUD and side controls', (width, height) => {
    for (const playerId of ['P1', 'P2'] as const) for (const dpr of [1, 2, 3]) {
      const safe = { left: 4 * dpr, right: 4 * dpr, top: 8 * dpr, bottom: 20 * dpr };
      const viewport = computeViewportMetrics(width * dpr, height * dpr, safe, undefined, dpr);
      const layout = screenMoveButtonLayout(viewport, playerId);
      const dock = battleItemDock(viewport, playerId);
      const obstacles = [
        ...(dock.bag ? [dock.bag] : []), ...dock.slots,
        battleSettingsRect(viewport), touchAimVisualRect(viewport, playerId),
        battleHudLayout(viewport, playerId).banner,
      ];
      expect(layout.hitSize / dpr).toBe(48);
      expect(layout.visualSize / dpr).toBe(44);
      expect(layout.left.x).toBeLessThan(layout.right.x);
      expect(screenRectsOverlap(layout.left, layout.right, 8 * dpr)).toBe(false);
      for (const button of [layout.left, layout.right]) {
        expect(button.x - button.width / 2).toBeGreaterThanOrEqual(safe.left);
        expect(button.x + button.width / 2).toBeLessThanOrEqual(viewport.width - safe.right);
        expect(button.y - button.height / 2).toBeGreaterThanOrEqual(safe.top);
        expect(button.y + button.height / 2).toBeLessThanOrEqual(viewport.height - safe.bottom);
        expect(obstacles.some((obstacle) => screenRectsOverlap(button, obstacle, 8 * dpr)),
          JSON.stringify({ width, height, playerId, dpr, layout, obstacles })).toBe(false);
      }
    }
  });

  it('anchors both directions to the safe bottom corners when those corners are clear', () => {
    const safe = { left: 20, right: 12, top: 4, bottom: 8 };
    const viewport = computeViewportMetrics(844, 390, safe);
    const layout = screenMoveButtonLayout(viewport);
    expect(layout.left.x).toBe(safe.left + 24 + 8);
    expect(layout.right.x).toBe(844 - safe.right - 24 - 8);
    expect(layout.left.y).toBe(390 - safe.bottom - 24 - 8);
    expect(layout.right.y).toBe(layout.left.y);
  });

  it.each([[568, 240], [568, 256], [667, 240], [667, 320], [844, 240], [844, 390], [932, 240], [932, 430]])(
    'keeps notched phone controls clear at %i × %i', (width, height) => {
      for (const playerId of ['P1', 'P2'] as const) for (const dpr of [1, 2, 3])
      for (const right of [24, 44]) for (const bottom of [20, 34]) {
        const safe = { left: 44 * dpr, right: right * dpr, top: 8 * dpr, bottom: bottom * dpr };
        const viewport = computeViewportMetrics(width * dpr, height * dpr, safe, undefined, dpr);
        const controls = screenMoveButtonLayout(viewport, playerId);
        const dock = battleItemDock(viewport, playerId);
        const obstacles = [...dock.slots, battleSettingsRect(viewport),
          touchAimVisualRect(viewport, playerId), battleHudLayout(viewport, playerId).banner];
        expect(controls.hitSize / dpr).toBe(48);
        expect(screenRectsOverlap(controls.left, controls.right, 8 * dpr)).toBe(false);
        for (const rect of [controls.left, controls.right]) {
          expect(rect.x - rect.width / 2).toBeGreaterThanOrEqual(safe.left);
          expect(rect.x + rect.width / 2).toBeLessThanOrEqual(viewport.width - safe.right);
          expect(rect.y - rect.height / 2).toBeGreaterThanOrEqual(safe.top);
          expect(rect.y + rect.height / 2).toBeLessThanOrEqual(viewport.height - safe.bottom);
          expect(obstacles.some((obstacle) => screenRectsOverlap(rect, obstacle, 8 * dpr)),
            JSON.stringify({ width, height, playerId, dpr, safe, controls, obstacles })).toBe(false);
        }
      }
    });

  it.each(['P1', 'P2'] as const)('does not move or shrink %s controls when the world camera zoom changes', (playerId) => {
    const viewport = computeViewportMetrics(844, 390, { left: 20, right: 12, top: 4, bottom: 8 });
    const expected = screenMoveButtonLayout(viewport, playerId);
    for (const zoom of [0.25, 0.5, 1, 2, 3]) {
      const changedCamera = { ...viewport, zoom, visibleWorldWidth: viewport.width / zoom, visibleWorldHeight: viewport.height / zoom };
      expect(screenMoveButtonLayout(changedCamera, playerId)).toEqual(expected);
    }
  });

  it('preserves full touch targets with 4px clearance on a 480 × 180 surface with safe insets', () => {
    for (const playerId of ['P1', 'P2'] as const) for (const dpr of [1, 2, 3]) {
      const safe = { left: 20 * dpr, right: 20 * dpr, top: 0, bottom: 20 * dpr };
      const viewport = computeViewportMetrics(480 * dpr, 180 * dpr, safe, undefined, dpr);
      const controls = screenMoveButtonLayout(viewport, playerId);
      const dock = battleItemDock(viewport, playerId);
      const obstacles = [...dock.slots, battleSettingsRect(viewport),
        touchAimVisualRect(viewport, playerId), battleHudLayout(viewport, playerId).banner];
      expect(controls.visualSize / dpr).toBe(44);
      expect(controls.hitSize / dpr).toBe(48);
      expect(controls.left.x).toBeLessThan(controls.right.x);
      expect(screenRectsOverlap(controls.left, controls.right, 4 * dpr)).toBe(false);
      for (const rect of [controls.left, controls.right]) {
        expect(rect.x - rect.width / 2).toBeGreaterThanOrEqual(safe.left);
        expect(rect.x + rect.width / 2).toBeLessThanOrEqual(viewport.width - safe.right);
        expect(rect.y - rect.height / 2).toBeGreaterThanOrEqual(safe.top);
        expect(rect.y + rect.height / 2).toBeLessThanOrEqual(viewport.height - safe.bottom);
        expect(obstacles.some((obstacle) => screenRectsOverlap(rect, obstacle, 4 * dpr)),
          JSON.stringify({ playerId, dpr, controls, obstacles })).toBe(false);
      }
    }
  });

  it.each(['P1', 'P2'] as const)('preserves %s CSS layout across DPR 1, 2 and 3', (playerId) => {
    const make = (dpr: number) => {
      const viewport = computeViewportMetrics(568 * dpr, 256 * dpr,
        { left: 20 * dpr, right: 12 * dpr, top: 4 * dpr, bottom: 8 * dpr }, undefined, dpr);
      return screenMoveButtonLayout(viewport, playerId);
    };
    const one = make(1);
    for (const dpr of [2, 3]) {
      const scaled = make(dpr);
      expect(scaled.visualSize / dpr).toBeCloseTo(one.visualSize);
      expect(scaled.hitSize / dpr).toBeCloseTo(one.hitSize);
      for (const side of ['left', 'right'] as const) {
        expect(scaled[side].x / dpr).toBeCloseTo(one[side].x);
        expect(scaled[side].y / dpr).toBeCloseTo(one[side].y);
      }
    }
  });

  it('accepts an exact fractional gap while still rejecting meaningful overlap', () => {
    const obstacle = { x: 796, y: 716, width: 96, height: 96 };
    const size = 180 * (780 / 1080) * 0.82;
    const button = { x: obstacle.x - obstacle.width / 2 - size / 2 - 16, y: 642, width: size, height: size };
    expect(screenRectsOverlap(button, obstacle, 16)).toBe(false);
    expect(screenRectsOverlap({ ...button, x: button.x + 0.1 }, obstacle, 16)).toBe(true);
  });
});
