import { describe, expect, it } from 'vitest';
import { computeViewportMetrics } from '../../src/game/platform/viewportMath';
import { dockMoveButtonLayout, screenRectsOverlap, touchAimRect } from '../../src/game/ui/touchControlLayout';
import { battleHudLayout } from '../../src/game/ui/miniMapMath';

const sizes = [
  [320, 568], [844, 390], [932, 430], [320, 180], [480, 180], [600, 180], [844, 180],
  [320, 240], [320, 250], [320, 260],
  [844, 240], [844, 250], [844, 260],
] as const;

describe('dock movement controls', () => {
  it.each(sizes)('keeps separate touch targets inside %i × %i across DPR and camera pans', (width, height) => {
    for (const playerId of ['P1', 'P2'] as const) for (const dpr of [1, 2]) for (const pan of [0, -1000, 1000, -5000, 5000]) {
      const safe = { left: 4 * dpr, right: 4 * dpr, top: 8 * dpr, bottom: 20 * dpr };
      const viewport = computeViewportMetrics(width * dpr, height * dpr, safe, undefined, dpr);
      const project = (x: number) => viewport.width / 2 + (x - 450 - pan) * viewport.zoom;
      const layout = dockMoveButtonLayout(viewport, project(25), project(925), height * dpr * 8 / 9, 180 * viewport.zoom, playerId);
      const aim = touchAimRect(viewport, playerId);
      expect(playerId === 'P2' ? aim.x < viewport.width / 2 : aim.x > viewport.width / 2).toBe(true);
      const obstacles = [
        aim,
        battleHudLayout(viewport, playerId).banner,
        // Test the rendered caption independently of the combined avoidance rectangle.
        { x: aim.x, y: aim.y + aim.height / 2 + 10 * dpr, width: 40 * dpr, height: 20 * dpr },
      ];
      expect(layout.hitSize / dpr).toBeGreaterThanOrEqual(48);
      expect(layout.visualSize).toBeCloseTo(180 * viewport.zoom * 0.82);
      expect(layout.left.x).toBeLessThan(layout.right.x);
      expect(screenRectsOverlap(layout.left, layout.right)).toBe(false);
      for (const button of [layout.left, layout.right]) {
        expect(button.x - button.width / 2).toBeGreaterThanOrEqual(safe.left);
        expect(button.x + button.width / 2).toBeLessThanOrEqual(viewport.width - safe.right);
        expect(button.y - button.height / 2).toBeGreaterThanOrEqual(safe.top);
        expect(button.y + button.height / 2).toBeLessThanOrEqual(viewport.height - safe.bottom);
        expect(obstacles.some((obstacle) => screenRectsOverlap(button, obstacle)), JSON.stringify({ dpr, pan, button, layout })).toBe(false);
      }
    }
  });

  it('follows both dock ends when the dock is visible without crowding other controls', () => {
    const viewport = computeViewportMetrics(844, 390, { left: 0, right: 0, top: 0, bottom: 0 });
    const layout = dockMoveButtonLayout(viewport, 268, 593, 346, 65);
    expect(layout.left.x + layout.visualSize / 2).toBeCloseTo(260);
    expect(layout.right.x - layout.visualSize / 2).toBeCloseTo(601);
    expect(layout.left.y).toBeCloseTo(346 - layout.visualSize / 2);
    expect(layout.right.y).toBeCloseTo(layout.left.y);
  });

  it('preserves CSS layout at DPR 2', () => {
    const make = (dpr: number) => {
      const viewport = computeViewportMetrics(844 * dpr, 390 * dpr, { left: 0, right: 0, top: 0, bottom: 0 }, undefined, dpr);
      return dockMoveButtonLayout(viewport, 268 * dpr, 593 * dpr, 346 * dpr, 65 * dpr);
    };
    const one = make(1);
    const two = make(2);
    expect(two.visualSize / 2).toBeCloseTo(one.visualSize);
    expect(two.hitSize / 2).toBeCloseTo(one.hitSize);
    for (const side of ['left', 'right'] as const) {
      expect(two[side].x / 2).toBeCloseTo(one[side].x);
      expect(two[side].y / 2).toBeCloseTo(one[side].y);
    }
  });

  it.each([[10, 335], [509, 834]])('aligns both directions beside dock %i…%i without moving above the deck', (dockLeft, dockRight) => {
    for (const dpr of [1, 2, 3]) {
      const viewport = computeViewportMetrics(844 * dpr, 390 * dpr, { left: 0, right: 0, top: 0, bottom: 0 }, undefined, dpr);
      const deck = 350 * dpr;
      const layout = dockMoveButtonLayout(viewport, dockLeft * dpr, dockRight * dpr, deck, 180 * viewport.zoom);
      const expectedY = deck - layout.visualSize / 2;
      expect(layout.left.y).toBeCloseTo(expectedY);
      expect(layout.right.y).toBeCloseTo(expectedY);

    }
  });

  it('uses the former bottom-center focus-button area when a dock edge is there', () => {
    const viewport = computeViewportMetrics(844, 390, { left: 0, right: 0, top: 0, bottom: 0 });
    const layout = dockMoveButtonLayout(viewport, 268, 380, 380, 65);
    expect(layout.right.x).toBeCloseTo(380 + layout.visualSize / 2 + 8);
    expect(layout.right.y).toBeCloseTo(380 - layout.visualSize / 2);
  });

  it('accepts an exact fractional gap while still rejecting meaningful overlap', () => {
    const obstacle = { x: 796, y: 716, width: 96, height: 96 };
    const size = 180 * (780 / 1080) * 0.82;
    const button = { x: obstacle.x - obstacle.width / 2 - size / 2 - 16, y: 642, width: size, height: size };
    expect(screenRectsOverlap(button, obstacle, 16)).toBe(false);
    expect(screenRectsOverlap({ ...button, x: button.x + 0.1 }, obstacle, 16)).toBe(true);
  });
});
