import type { ViewportMetrics } from '../platform/viewportMath';
import type { PlayerId } from '../state/ids';
import type { ScreenRect } from './touchAimLayout';

/** Three slots remain visible; short screens use a compact row extending inward. */
export function battleItemDock(viewport: ViewportMetrics, playerId: PlayerId, _expanded = true) {
  const { width, height, safeArea, uiScale: ui } = viewport;
  const horizontal = (height - safeArea.top - safeArea.bottom) / ui <= 600;
  const size = (horizontal ? 48 : 52) * ui, step = size + 8 * ui;
  const right = playerId === 'P2';
  const x = right ? width - safeArea.right - 8 * ui - size / 2 : safeArea.left + 8 * ui + size / 2;
  const gear = battleSettingsRect(viewport);
  const middle = safeArea.top + (height - safeArea.top - safeArea.bottom) / 2;
  const hpScale = Math.max(0, Math.min(1, ((width - safeArea.left - safeArea.right) / ui - 110) / 540));
  const tiny = (height - safeArea.top - safeArea.bottom) / ui < 200 && gear.x >= safeArea.left + 200 * ui;
  const y = tiny ? Math.min(height - safeArea.bottom - size / 2,
    safeArea.top + (83 * hpScale + 8) * ui + size / 2)
    : horizontal ? Math.min(height - safeArea.bottom - size / 2,
    Math.max(middle, gear.y + gear.height / 2 + 8 * ui + size / 2)) : middle;
  const rect = (index: number): ScreenRect => ({
    x: horizontal ? x + (right ? -1 : 1) * index * step : x,
    y: horizontal ? y : y + (index - 1) * step, width: size, height: size,
  });
  return { collapsed: false, bag: null, slots: Array.from({ length: 3 }, (_, i) => rect(i)) };
}

/** Gear stays below the portrait, away from either team's fixed item and aim docks. */
export function battleSettingsRect(viewport: ViewportMetrics): ScreenRect {
  const { width, height, safeArea, uiScale: ui } = viewport;
  const available = (width - safeArea.left - safeArea.right) / ui;
  const scale = Math.max(0, Math.min(1, (available - 110) / 540)) * ui;
  const standardY = safeArea.top + 83 * scale + 32 * ui;
  const rowBottom = height - safeArea.bottom - 24 * ui;
  // Extremely short browser surfaces cannot stack Gear and the item row.
  // Keep all four 48px targets visible side by side instead of clamping them together.
  const besideRow = standardY + 56 * ui > rowBottom;
  const x = Math.min(safeArea.left + (besideRow ? 200 : 110) * ui, width - safeArea.right - 24 * ui);
  const y = besideRow ? rowBottom : standardY;
  return { x, y: Math.max(safeArea.top + 24 * ui, Math.min(y, height - safeArea.bottom - 24 * ui)),
    width: 48 * ui, height: 48 * ui };
}
