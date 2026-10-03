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
          expect(rect.width / dpr).toBeGreaterThanOrEqual(52);
          expect(rect.height / dpr).toBeGreaterThanOrEqual(52);
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

  it('hides collapsed slots and expands inward from the team side', () => {
    const viewport = computeViewportMetrics(667, 320, { top: 0, left: 0, right: 0, bottom: 0 });
    for (const id of ['P1', 'P2'] as const) {
      const folded = itemHudLayout(viewport, id, false);
      expect(folded.collapsed).toBe(true);
      expect(folded.bag).not.toBeNull();
      expect(folded.slots).toHaveLength(0);
      const open = itemHudLayout(viewport, id, true);
      expect(open.slots).toHaveLength(3);
      expect(open.slots.every((slot) => id === 'P1' ? slot.x > open.bag!.x : slot.x < open.bag!.x)).toBe(true);
    }
  });

  it.each([[844, 390], [667, 320], [568, 256], [1920, 1080]])(
    'anchors inventory at the team edge and vertical center at %i × %i regardless of projected controls', (width, height) => {
      for (const id of ['P1', 'P2'] as const) for (const dpr of [1, 2, 3]) {
        const safe = { top: 4 * dpr, bottom: 8 * dpr, left: 20 * dpr, right: 12 * dpr };
        const viewport = computeViewportMetrics(width * dpr, height * dpr, safe, undefined, dpr);
        const baseline = itemHudLayout(viewport, id, true);
        const anchor = baseline.bag ?? baseline.slots[1]!;
        expect(anchor.x).toBe(id === 'P1' ? safe.left + 34 * dpr : viewport.width - safe.right - 34 * dpr);
        expect(anchor.y).toBe((safe.top + viewport.height - safe.bottom) / 2);
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

  it('uses three visible vertical slots at 390 CSS px and a centered inward bag below 360', () => {
    for (const height of [390, 320, 256]) {
      const viewport = computeViewportMetrics(844, height, { top: 0, left: 0, right: 0, bottom: 0 });
      for (const id of ['P1', 'P2'] as const) {
        const layout = itemHudLayout(viewport, id, true);
        expect(layout.collapsed).toBe(height < 360);
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
    'puts the gear below the item row when %i × %i browser chrome leaves no safe space above HP', (width, height) => {
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
        if (width === 844 || height === 240) {
          expect(gear.y).toBeGreaterThan(itemHudLayout(viewport, 'P1', false).bag!.y);
        }
      }
    });

  it('uses circle corners without accepting a true intersection', () => {
    const circle = { x: 100, y: 100, width: 100, height: 100, radius: 50 };
    expect(itemHudObstacleOverlaps({ x: 150, y: 150, width: 20, height: 20 }, circle)).toBe(false);
    expect(itemHudObstacleOverlaps({ x: 140, y: 140, width: 20, height: 20 }, circle)).toBe(true);
  });
});
