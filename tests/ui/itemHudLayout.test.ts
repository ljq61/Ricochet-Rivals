import { describe, expect, it } from 'vitest';
import { computeViewportMetrics } from '../../src/game/platform/viewportMath';
import { itemHudLayout, itemHudObstacleOverlaps } from '../../src/game/ui/itemHudLayout';
import { battleSettingsRect } from '../../src/game/ui/battleSideDockLayout';
import { touchAimVisualRect } from '../../src/game/ui/touchAimLayout';
import { screenRectsOverlap } from '../../src/game/ui/touchControlLayout';

describe('item HUD safe area and control layout', () => {
  it.each([[844, 390], [667, 320], [568, 256], [1920, 1080], [932, 430]])(
    'keeps three usable slots inside %i × %i across both teams and DPR', (width, height) => {
      for (const playerId of ['P1', 'P2'] as const) for (const dpr of [1, 2, 3]) {
        const safeArea = { top: 0, left: 20 * dpr, right: 20 * dpr, bottom: 8 * dpr };
        const viewport = computeViewportMetrics(width * dpr, height * dpr, safeArea, undefined, dpr);
        const layout = itemHudLayout(viewport, playerId, true);
        expect(layout.slots, JSON.stringify({ width, height, playerId, layout })).toHaveLength(3);
        const rects = layout.bag ? [layout.bag, ...layout.slots] : layout.slots;
        for (const rect of rects) {
          expect(rect.width / dpr).toBeGreaterThanOrEqual(48);
          expect(rect.height / dpr).toBeGreaterThanOrEqual(48);
          expect(rect.x - rect.width / 2).toBeGreaterThanOrEqual(safeArea.left);
          expect(rect.x + rect.width / 2).toBeLessThanOrEqual(viewport.width - safeArea.right);
          expect(rect.y - rect.height / 2).toBeGreaterThanOrEqual(safeArea.top);
          expect(rect.y + rect.height / 2).toBeLessThanOrEqual(viewport.height - safeArea.bottom);
          expect(layout.reserved.some((o) => screenRectsOverlap(rect, o, 8 * dpr))).toBe(false);
        }
        for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
          expect(screenRectsOverlap(rects[i]!, rects[j]!, 8 * dpr)).toBe(false);
        }
        const anchor = layout.bag ?? layout.slots[0]!;
        expect(playerId === 'P1' ? anchor.x < viewport.width / 2 : anchor.x > viewport.width / 2).toBe(true);
      }
    });

  it('keeps all three slots visible without opening a bag on short screens', () => {
    for (const height of [390, 320, 256, 240]) for (const id of ['P1', 'P2'] as const) {
      const viewport = computeViewportMetrics(667, height, { top: 0, left: 0, right: 0, bottom: 0 });
      const layout = itemHudLayout(viewport, id, false);
      expect(layout.collapsed).toBe(false);
      expect(layout.bag).toBeNull();
      expect(layout.slots).toHaveLength(3);
      expect(layout.slots.every((slot) => slot.y === layout.slots[0]!.y)).toBe(true);
      expect(id === 'P1' ? layout.slots[2]!.x > layout.slots[0]!.x
        : layout.slots[2]!.x < layout.slots[0]!.x).toBe(true);
      expect(itemHudLayout(viewport, id, true).slots).toEqual(layout.slots);
    }
  });

  it.each([[844, 390], [667, 320], [568, 256], [1920, 1080]])(
    'anchors inventory at the team edge at %i × %i regardless of projected controls', (width, height) => {
      for (const id of ['P1', 'P2'] as const) for (const dpr of [1, 2, 3]) {
        const safe = { top: 4 * dpr, bottom: 8 * dpr, left: 20 * dpr, right: 12 * dpr };
        const viewport = computeViewportMetrics(width * dpr, height * dpr, safe, undefined, dpr);
        const baseline = itemHudLayout(viewport, id, true);
        const anchor = baseline.slots[0]!;
        const inset = height <= 600 ? 32 : 34;
        expect(anchor.x).toBe(id === 'P1' ? safe.left + inset * dpr : viewport.width - safe.right - inset * dpr);
        const middle = (safe.top + viewport.height - safe.bottom) / 2;
        if (height <= 600) expect(anchor.y).toBeGreaterThanOrEqual(middle);
        else expect(baseline.slots[1]!.y).toBe(middle);
        for (const x of [-5000, 40, width / 2, width - 40, 5000]) {
          const obstacles = [{ x: x * dpr, y: anchor.y, width: 64 * dpr, height: 64 * dpr },
            { x: anchor.x, y: anchor.y, width: 300 * dpr, height: 300 * dpr, radius: 150 * dpr }];
          const duringMovementAndAim = itemHudLayout(viewport, id, true, obstacles);
          expect(duringMovementAndAim.bag).toEqual(baseline.bag);
          expect(duringMovementAndAim.slots).toEqual(baseline.slots);
        }
        const launcher = { x: id === 'P1' ? 450 * viewport.zoom : viewport.width - 450 * viewport.zoom,
          y: 896 * viewport.zoom, width: 16 * dpr, height: 16 * dpr };
        expect([...(baseline.bag ? [baseline.bag] : []), ...baseline.slots]
          .some((slot) => screenRectsOverlap(slot, launcher))).toBe(false);
      }
    });

  it('keeps three compact slots separate from the gear at every phone height', () => {
    for (const height of [390, 320, 256]) {
      const viewport = computeViewportMetrics(844, height, { top: 0, left: 0, right: 0, bottom: 0 });
      for (const id of ['P1', 'P2'] as const) {
        const layout = itemHudLayout(viewport, id, true);
        expect(layout.collapsed).toBe(false);
        const rects = [...(layout.bag ? [layout.bag] : []), ...layout.slots];
        expect(rects.some((rect) => screenRectsOverlap(rect, battleSettingsRect(viewport), 8))).toBe(false);
      }
    }
  });

  it('keeps the short-screen gear separate from portraits, public inventory and map with a phone notch', () => {
    for (const dpr of [1, 2, 3]) for (const inset of [0, 20, 44]) {
      const safe = { left: inset * dpr, right: inset * dpr, top: 0, bottom: 8 * dpr };
      const viewport = computeViewportMetrics(568 * dpr, 256 * dpr, safe, undefined, dpr);
      const scale = ((568 - 2 * inset - 110) / 540) * dpr;
      const gear = battleSettingsRect(viewport);
      const stock = { x: safe.left + 12 * dpr + 124 * scale, y: 58 * scale,
        width: 62 * scale, height: 18 * scale };
      const hp = { x: safe.left + 12 * dpr + 173 * scale, y: 27 * scale,
        width: 178 * scale, height: 24 * scale };
      const portrait = { x: safe.left + 12 * dpr + 36 * scale, y: 44 * scale,
        width: 78 * scale, height: 78 * scale };
      const layout = itemHudLayout(viewport, 'P1', true);
      expect([stock, hp, portrait, layout.reserved[0]!].some((rect) => screenRectsOverlap(gear, rect, 8 * dpr))).toBe(false);
    }
  });

  it.each([[844, 240], [844, 256], [568, 240], [568, 256]])(
    'keeps the gear at its left anchor and clear of controls at %i × %i', (width, height) => {
      for (const dpr of [1, 2, 3]) for (const inset of [0, 20, 44]) {
        const safe = { left: inset * dpr, right: inset * dpr, top: 0, bottom: 20 * dpr };
        const viewport = computeViewportMetrics(width * dpr, height * dpr, safe, undefined, dpr);
        const scale = Math.min(1, (width - 2 * inset - 110) / 540) * dpr;
        const gear = battleSettingsRect(viewport);
        const stock = { x: safe.left + 12 * dpr + 124 * scale, y: 58 * scale,
          width: 62 * scale, height: 18 * scale };
        const hp = { x: safe.left + 12 * dpr + 173 * scale, y: 27 * scale,
          width: 178 * scale, height: 24 * scale };
        const portrait = { x: safe.left + 12 * dpr + 36 * scale, y: 44 * scale,
          width: 78 * scale, height: 78 * scale };
        for (const id of ['P1', 'P2'] as const) {
          const layout = itemHudLayout(viewport, id, true);
          const obstacles = [stock, hp, portrait, layout.reserved[0]!, touchAimVisualRect(viewport, id),
            ...(layout.bag ? [layout.bag] : []), ...layout.slots];
          expect(obstacles.some((rect) => screenRectsOverlap(gear, rect, 8 * dpr)),
            JSON.stringify({ width, height, inset, dpr, id, gear, obstacles })).toBe(false);
          expect(gear.y + gear.height / 2).toBeLessThanOrEqual(viewport.height - safe.bottom);
        }
        expect(gear.x).toBe(safe.left + 110 * dpr);
        expect(gear.y).toBe(safe.top + 83 * scale + 32 * dpr);
      }
    });

  it('keeps the gear separate from all three slots on extremely short surfaces', () => {
    for (const width of [320, 480, 568, 667, 844, 932]) for (const id of ['P1', 'P2'] as const)
      for (const dpr of [1, 2, 3]) {
        const safe = { left: 4 * dpr, right: 4 * dpr, top: 8 * dpr, bottom: 20 * dpr };
        const viewport = computeViewportMetrics(width * dpr, 180 * dpr, safe, undefined, dpr);
        const gear = battleSettingsRect(viewport);
        const layout = itemHudLayout(viewport, id, false);
        expect(layout.slots).toHaveLength(3);
        expect(layout.slots.some(slot => screenRectsOverlap(slot, gear, 8 * dpr)),
          JSON.stringify({ width, id, dpr, gear, layout })).toBe(false);
        expect(layout.slots.every(slot => slot.y + slot.height / 2 <= viewport.height - safe.bottom)).toBe(true);
      }
  });

  it('uses circle corners without accepting a true intersection', () => {
    const circle = { x: 100, y: 100, width: 100, height: 100, radius: 50 };
    expect(itemHudObstacleOverlaps({ x: 150, y: 150, width: 20, height: 20 }, circle)).toBe(false);
    expect(itemHudObstacleOverlaps({ x: 140, y: 140, width: 20, height: 20 }, circle)).toBe(true);
  });
});
