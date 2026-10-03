import { describe, expect, it } from 'vitest';
import { computeViewportMetrics } from '../../src/game/platform/viewportMath';
import { createInitialGameState } from '../../src/game/state/GameState';
import { battleHudLayout, miniMapSnapshot, miniMapWorldX, miniMapProjection, miniMapCameraFrame } from '../../src/game/ui/miniMapMath';
import type { ProjectileState } from '../../src/game/state/ProjectileState';
import { screenRectsOverlap, touchAimRect } from '../../src/game/ui/touchControlLayout';
import { battleItemDock, battleSettingsRect } from '../../src/game/ui/battleSideDockLayout';

describe('battle mini map', () => {
  it('keeps turn messages clear of fixed item docks and the relocated gear', () => {
    for (const [width, height] of [[568, 256], [667, 320], [844, 390], [1280, 800]]) {
      for (const id of ['P1', 'P2'] as const) for (const dpr of [1, 2, 3]) {
        const viewport = computeViewportMetrics(width! * dpr, height! * dpr,
          { left: 20 * dpr, right: 20 * dpr, top: 0, bottom: 8 * dpr }, undefined, dpr);
        const { banner } = battleHudLayout(viewport, id);
        const dock = battleItemDock(viewport, id);
        for (const rect of [...dock.slots, battleSettingsRect(viewport), ...(dock.bag ? [dock.bag] : [])]) {
          expect(screenRectsOverlap(banner, rect, 8 * dpr), JSON.stringify({ width, height, id, rect, banner })).toBe(false);
        }
        expect(banner.width / dpr).toBeGreaterThanOrEqual(48);
      }
    }
  });
  it.each([[320, 180], [480, 180], [600, 180], [844, 180], [320, 240], [320, 568], [844, 240], [844, 390], [932, 430], [1280, 800]])(
    'keeps map and banner outside the HP cards at %i × %i', (width, height) => {
      for (const playerId of ['P1', 'P2'] as const) for (const dpr of [1, 2, 3]) {
        const safe = { left: 12 * dpr, right: 4 * dpr, top: 8 * dpr, bottom: 4 * dpr };
        const v = computeViewportMetrics(width * dpr, height * dpr, safe, undefined, dpr);
        const { map, banner } = battleHudLayout(v, playerId);
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
        expect(screenRectsOverlap(banner, touchAimRect(v, playerId))).toBe(false);
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

  it('projects the actual top-left worldView instead of camera scroll coordinates', () => {
    const v = computeViewportMetrics(844, 390, { left: 0, right: 0, top: 0, bottom: 0 });
    const { plot } = miniMapProjection(v);
    const worldView = { x: 1000, y: 270, width: 2000, height: 540 };
    const result = miniMapCameraFrame(v, worldView);
    expect(result.world).toEqual(worldView);
    expect(result.clampedWorld).toEqual(worldView);
    expect(result.frame.x).toBeCloseTo(plot.left + (plot.right - plot.left) * 0.4);
    expect(result.frame.y).toBeCloseTo((plot.top + plot.bottom) / 2);
    expect(result.frame.width).toBeCloseTo((plot.right - plot.left) * 0.4);
    expect(result.frame.height).toBeCloseTo((plot.bottom - plot.top) * 0.5);
    expect(result.visible).toBe(true);
  });

  it('clips a window larger than the world and high camera views to the map edges', () => {
    const v = computeViewportMetrics(844, 390, { left: 0, right: 0, top: 0, bottom: 0 });
    const { plot } = miniMapProjection(v);
    const full = miniMapCameraFrame(v, { x: -1000, y: -500, width: 7000, height: 2000 });
    expect(full.clampedWorld).toEqual({ x: 0, y: 0, width: 5000, height: 1080 });
    expect(full.frame.width).toBeCloseTo(plot.right - plot.left);
    expect(full.frame.height).toBeCloseTo(plot.bottom - plot.top);
    const high = miniMapCameraFrame(v, { x: 2000, y: -720, width: 1500, height: 1080 });
    expect(high.clampedWorld.y).toBe(0);
    expect(high.clampedWorld.height).toBe(360);
    expect(high.frame.y - high.frame.height / 2).toBeCloseTo(plot.top);
    expect(high.frame.height).toBeCloseTo((plot.bottom - plot.top) / 3);
    const outside = miniMapCameraFrame(v, { x: 6000, y: -1400, width: 1000, height: 800 });
    expect(outside.visible).toBe(false);
    expect(outside.frame).toEqual({ x: plot.right, y: plot.top, width: 0, height: 0 });
  });

  it('updates flying shells in 2D, pins high arcs to the top edge and clears finished shells', () => {
    const v = computeViewportMetrics(844, 390, { left: 0, right: 0, top: 0, bottom: 0 });
    const state = createInitialGameState({ matchId: 'map-shell', seed: 1 });
    const shell: ProjectileState = { id: 'proj-1', ownerId: 'P1', weaponId: 'normal', x: 2000, y: 540,
      velocityX: 500, velocityY: -1000, status: 'flying', ageMs: 300 };
    const context = { cameraWorldView: { x: 1000, y: 0, width: 2000, height: 1080 }, projectiles: [shell] };
    const before = miniMapSnapshot(v, state.players, 'P1', context);
    expect(before.projectiles).toHaveLength(1);
    expect(before.projectiles[0]?.worldX).toBe(2000);
    expect(before.projectiles[0]?.y).toBeCloseTo((before.plot.top + before.plot.bottom) / 2);
    shell.x = 2500;
    shell.y = -600;
    const high = miniMapSnapshot(v, state.players, 'P1', context);
    expect(high.projectiles[0]?.x).toBeGreaterThan(before.projectiles[0]!.x);
    expect(high.projectiles[0]?.y).toBe(high.plot.top);
    expect(high.projectiles[0]?.worldY).toBe(-600);
    expect(high.projectiles[0]?.clamped).toBe(true);
    for (const status of ['impact', 'exploding', 'destroyed'] as const) {
      shell.status = status;
      expect(miniMapSnapshot(v, state.players, 'P1', context).projectiles).toHaveLength(0);
    }
    expect(miniMapSnapshot(v, state.players, 'P1', { ...context, projectiles: [] }).projectiles).toHaveLength(0);
  });

  it('resizes projection and changes camera frames immediately without retaining a prior mode', () => {
    const state = createInitialGameState({ matchId: 'map-camera', seed: 1 });
    const small = computeViewportMetrics(844, 390, { left: 0, right: 0, top: 0, bottom: 0 });
    const large = computeViewportMetrics(1688, 780, { left: 0, right: 0, top: 0, bottom: 0 }, undefined, 2);
    const worldA = { x: 0, y: 0, width: 2000, height: 1080 };
    const worldB = { x: 3000, y: -720, width: 2000, height: 1080 };
    const before = miniMapSnapshot(small, state.players, 'P1', { cameraWorldView: worldA, projectiles: [] });
    const resized = miniMapSnapshot(large, state.players, 'P1', { cameraWorldView: worldA, projectiles: [] });
    expect(resized.cameraView!.frame.x / 2).toBeCloseTo(before.cameraView!.frame.x);
    expect(resized.cameraView!.frame.height / 2).toBeCloseTo(before.cameraView!.frame.height);
    const after = miniMapSnapshot(small, state.players, 'P2', { cameraWorldView: worldB, projectiles: [] });
    expect(after.cameraView!.world).toEqual(worldB);
    expect(after.cameraView!.frame.x).toBeGreaterThan(before.cameraView!.frame.x);
    expect(after.cameraView!.frame.height).toBeLessThan(before.cameraView!.frame.height);
  });
});
