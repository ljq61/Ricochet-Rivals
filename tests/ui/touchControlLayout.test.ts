import { describe, expect, it } from 'vitest';
import { computeViewportMetrics } from '../../src/game/platform/viewportMath';
import { screenMoveButtonLayout, screenRectsOverlap } from '../../src/game/ui/touchControlLayout';
import { battleItemDock, battleSettingsRect } from '../../src/game/ui/battleSideDockLayout';
import { touchAimVisualRect } from '../../src/game/ui/touchAimLayout';
import { battleHudLayout } from '../../src/game/ui/miniMapMath';

const sizes = [
  [320, 568], [844, 390], [932, 430], [320, 180], [480, 180], [600, 180], [844, 180],
  [320, 240], [320, 250], [320, 260], [844, 240], [844, 250], [844, 260],
  [667, 320], [568, 256], [1024, 768],
] as const;

describe('fixed screen movement controls', () => {
  it.each(sizes)('keeps both touch targets inside the team side of %i × %i', (width, height) => {
    for (const playerId of ['P1', 'P2'] as const) for (const dpr of [1, 2, 3]) {
      const safe = { left: 4 * dpr, right: 4 * dpr, top: 8 * dpr, bottom: 20 * dpr };
      const viewport = computeViewportMetrics(width * dpr, height * dpr, safe, undefined, dpr);
      const layout = screenMoveButtonLayout(viewport, playerId);
      expect(layout.hitSize / dpr).toBe(48);
      expect(layout.visualSize / dpr).toBe(44);
      expect(layout.left.x).toBeLessThan(layout.right.x);
      const middle = (safe.left + viewport.width - safe.right) / 2;
      if (playerId === 'P1') expect(layout.right.x + layout.hitSize / 2).toBeLessThan(middle);
      else expect(layout.left.x - layout.hitSize / 2).toBeGreaterThan(middle);
      expect(screenRectsOverlap(layout.left, layout.right, 8 * dpr)).toBe(false);
      for (const button of [layout.left, layout.right]) {
        expect(button.x - button.width / 2).toBeGreaterThanOrEqual(safe.left);
        expect(button.x + button.width / 2).toBeLessThanOrEqual(viewport.width - safe.right);
        expect(button.y - button.height / 2).toBeGreaterThanOrEqual(safe.top);
        expect(button.y + button.height / 2).toBeLessThanOrEqual(viewport.height - safe.bottom);
      }
    }
  });

  it('anchors blue arrows at the left corner and 40% of the safe width', () => {
    const safe = { left: 20, right: 12, top: 4, bottom: 8 };
    const viewport = computeViewportMetrics(844, 390, safe);
    const layout = screenMoveButtonLayout(viewport);
    expect(layout.left.x).toBe(safe.left + 24 + 8);
    expect(layout.right.x).toBe(safe.left + (844 - safe.left - safe.right) * 0.4);
    expect(layout.left.y).toBe(390 - safe.bottom - 24 - 8);
    expect(layout.right.y).toBe(layout.left.y);
  });

  it.each([[568, 240], [568, 256], [667, 240], [667, 320], [844, 240], [844, 390], [932, 240], [932, 430]])(
    'preserves fixed team-side positions on a notched phone at %i × %i', (width, height) => {
      for (const playerId of ['P1', 'P2'] as const) for (const dpr of [1, 2, 3])
      for (const right of [24, 44]) for (const bottom of [20, 34]) {
        const safe = { left: 44 * dpr, right: right * dpr, top: 8 * dpr, bottom: bottom * dpr };
        const viewport = computeViewportMetrics(width * dpr, height * dpr, safe, undefined, dpr);
        const controls = screenMoveButtonLayout(viewport, playerId);
        expect(controls.hitSize / dpr).toBe(48);
        expect(screenRectsOverlap(controls.left, controls.right, 8 * dpr)).toBe(false);
        for (const rect of [controls.left, controls.right]) {
          expect(rect.x - rect.width / 2).toBeGreaterThanOrEqual(safe.left);
          expect(rect.x + rect.width / 2).toBeLessThanOrEqual(viewport.width - safe.right);
          expect(rect.y - rect.height / 2).toBeGreaterThanOrEqual(safe.top);
          expect(rect.y + rect.height / 2).toBeLessThanOrEqual(viewport.height - safe.bottom);
        }
      }
    });

  it.each([
    [568, 240, 4, 4, 8, 20], [568, 256, 4, 4, 8, 20],
    [667, 320, 4, 4, 8, 20], [844, 390, 4, 4, 8, 20],
    [844, 240, 44, 44, 8, 34],
  ])('keeps arrows clear when the bag opens and closes at %i × %i with safe insets %i/%i/%i/%i',
    (width, height, left, right, top, bottom) => {
      for (const playerId of ['P1', 'P2'] as const) for (const dpr of [1, 2, 3]) {
        const viewport = computeViewportMetrics(width * dpr, height * dpr,
          { left: left * dpr, right: right * dpr, top: top * dpr, bottom: bottom * dpr }, undefined, dpr);
        const before = screenMoveButtonLayout(viewport, playerId);
        for (const expanded of [false, true, false]) {
          const dock = battleItemDock(viewport, playerId, expanded);
          expect(dock.collapsed).toBe(true);
          expect(dock.bag).not.toBeNull();
          expect(dock.slots).toHaveLength(expanded ? 3 : 0);
          const items = [dock.bag!, ...dock.slots];
          const otherControls = [battleSettingsRect(viewport), touchAimVisualRect(viewport, playerId),
            battleHudLayout(viewport, playerId).banner];
          const controls = screenMoveButtonLayout(viewport, playerId);
          expect(controls).toEqual(before);
          for (const button of [controls.left, controls.right]) {
            expect(items.some((item) => screenRectsOverlap(button, item, 8 * dpr)),
              JSON.stringify({ width, height, playerId, dpr, expanded, controls, items })).toBe(false);
            // Extreme notch/browser insets may leave less than 8px beside Gear,
            // but actual visual and touch rectangles must remain separate.
            expect(otherControls.some((obstacle) => screenRectsOverlap(button, obstacle)),
              JSON.stringify({ width, height, playerId, dpr, expanded, controls, otherControls })).toBe(false);
          }
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

  it('mirrors red arrows into the right half with matching safe-area spacing', () => {
    const safe = { left: 20, right: 12, top: 4, bottom: 8 };
    const viewport = computeViewportMetrics(844, 390, safe);
    const blue = screenMoveButtonLayout(viewport, 'P1');
    const red = screenMoveButtonLayout(viewport, 'P2');
    const reflection = safe.left + viewport.width - safe.right;
    expect(red.left.x).toBeCloseTo(reflection - blue.right.x);
    expect(red.right.x).toBeCloseTo(reflection - blue.left.x);
    expect(red.left.y).toBe(blue.left.y);
    expect(red.right.y).toBe(blue.right.y);
  });

  it('does not move vertically when resizing only the safe width', () => {
    for (const playerId of ['P1', 'P2'] as const) {
      const safe = { left: 20, right: 12, top: 4, bottom: 8 };
      const before = screenMoveButtonLayout(computeViewportMetrics(568, 256, safe), playerId);
      const after = screenMoveButtonLayout(computeViewportMetrics(932, 256, safe), playerId);
      expect(after.left.y).toBe(before.left.y);
      expect(after.right.y).toBe(before.right.y);
      expect(playerId === 'P1' ? after.left.x : 932 - after.right.x)
        .toBe(playerId === 'P1' ? before.left.x : 568 - before.right.x);
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
