import type { ViewportMetrics } from '../platform/viewportMath';
import type { PlayerId } from '../state/ids';
import { battleItemDock, battleSettingsRect } from './battleSideDockLayout';
import { battleHudLayout } from './miniMapMath';
import { screenRectsOverlap, touchAimVisualRect, type ScreenRect } from './touchControlLayout';

export type ItemHudObstacle = ScreenRect & { radius?: number };

/** Circle hot regions reserve the actual aim disk, preserving usable corner space. */
export function itemHudObstacleOverlaps(rect: ScreenRect, obstacle: ItemHudObstacle, gap = 0): boolean {
  if (obstacle.radius === undefined) return screenRectsOverlap(rect, obstacle, gap);
  const dx = Math.max(0, Math.abs(rect.x - obstacle.x) - rect.width / 2);
  const dy = Math.max(0, Math.abs(rect.y - obstacle.y) - rect.height / 2);
  return dx * dx + dy * dy < (obstacle.radius + gap) ** 2 - 1e-6;
}

export interface ItemHudLayout {
  collapsed: boolean;
  bag: ScreenRect | null;
  slots: ScreenRect[];
  reserved: ItemHudObstacle[];
}

/** Fixed team-side controls never chase camera-projected movement or invisible aim regions. */
export function itemHudLayout(viewport: ViewportMetrics, playerId: PlayerId, expanded: boolean,
  _extraReserved: readonly ItemHudObstacle[] = []): ItemHudLayout {
  const { map, banner } = battleHudLayout(viewport, playerId);
  const dock = battleItemDock(viewport, playerId, expanded);
  return { ...dock, reserved: [map, banner, touchAimVisualRect(viewport, playerId), battleSettingsRect(viewport)] };
}
