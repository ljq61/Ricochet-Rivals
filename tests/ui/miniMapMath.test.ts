import { describe, expect, it } from 'vitest';
import { computeViewportMetrics } from '../../src/game/platform/viewportMath';
import { createInitialGameState } from '../../src/game/state/GameState';
import { battleHudLayout, miniMapSnapshot, miniMapWorldX } from '../../src/game/ui/miniMapMath';
import { screenRectsOverlap, touchAimRect } from '../../src/game/ui/touchControlLayout';

describe('battle mini map', () => {
  it.each([[320, 180], [480, 180], [600, 180], [844, 180], [320, 240], [320, 568], [844, 240], [844, 390], [932, 430], [1280, 800]])(
    'keeps map and banner outside the HP cards at %i × %i', (width, height) => {
      for (const dpr of [1, 2, 3]) {
        const safe = { left: 12 * dpr, right: 4 * dpr, top: 8 * dpr, bottom: 4 * dpr };
        const v = computeViewportMetrics(width * dpr, height * dpr, safe, undefined, dpr);
        const { map, banner } = battleHudLayout(v);
        const available = (v.width - safe.left - safe.right) / dpr;
        const cardScale = Math.min(1, (available - 110) / 540);
        const leftCardRight = safe.left + (12 + 270 * cardScale) * dpr;
        const rightCardLeft = v.width - safe.right - (12 + 270 * cardScale) * dpr;
        expect(map.x - map.width / 2).toBeGreaterThan(leftCardRight);
        expect(map.x + map.width / 2).toBeLessThan(rightCardLeft);
        expect(map.y - map.height / 2).toBeGreaterThanOrEqual(safe.top);
        expect(banner.y - banner.height / 2).toBeGreaterThan(map.y + map.height / 2);
        const hpY = safe.top + 44 * cardScale * dpr;
        for (const x of [safe.left + (12 + 135 * cardScale) * dpr, v.width - safe.right - (12 + 135 * cardScale) * dpr]) {
          expect(screenRectsOverlap(banner, { x, y: hpY, width: 270 * cardScale * dpr, height: 78 * cardScale * dpr })).toBe(false);
        }
        expect(screenRectsOverlap(banner, touchAimRect(v))).toBe(false);
      }
    });

  it('shows stationary bases and immediately updates both crew markers and the active turn', () => {
    const v = computeViewportMetrics(844, 390, { left: 0, right: 0, top: 0, bottom: 0 });
    const state = createInitialGameState({ matchId: 'map', seed: 1 });
    const before = miniMapSnapshot(v, state.players, 'P1');
    state.players.P1.x = 850;
    state.players.P2.x = 4150;
    state.players.P1.isAlive = false;
    const after = miniMapSnapshot(v, state.players, 'P2');
    expect(after.bases).toEqual(before.bases);
    expect(after.players.P1.x).toBeGreaterThan(before.players.P1.x);
    expect(after.players.P2.x).toBeLessThan(before.players.P2.x);
    expect(after.players.P1.worldX).toBe(850);
    expect(after.players.P1.alive).toBe(false);
    expect(after.players.P1.current).toBe(false);
    expect(after.players.P2.current).toBe(true);
    expect(after.currentPlayerId).toBe('P2');
  });

  it('maps the full 5000px world and clamps out-of-range snapshot positions', () => {
    expect(miniMapWorldX(0, 220, 1)).toBe(-102);
    expect(miniMapWorldX(2500, 220, 1)).toBe(0);
    expect(miniMapWorldX(5000, 220, 1)).toBe(102);
    expect(miniMapWorldX(-1000, 220, 1)).toBe(-102);
    expect(miniMapWorldX(6000, 220, 1)).toBe(102);
  });

  it('keeps exactly the same CSS positions at DPR 2', () => {
    const state = createInitialGameState({ matchId: 'map-dpr', seed: 2 });
    const make = (dpr: number) => miniMapSnapshot(computeViewportMetrics(844 * dpr, 390 * dpr,
      { left: 0, right: 0, top: 0, bottom: 0 }, undefined, dpr), state.players, 'P1');
    const one = make(1), two = make(2);
    expect(two.rect.width / 2).toBe(one.rect.width);
    expect(two.rect.y / 2).toBe(one.rect.y);
    expect(two.players.P1.x / 2).toBe(one.players.P1.x);
    expect(two.players.P2.x / 2).toBe(one.players.P2.x);
  });
});
