import type { ViewportMetrics } from '../platform/viewportMath';
import type { PlayerId } from '../state/ids';
import type { ScreenRect } from './touchAimLayout';

/** Phones keep a compact bag; opening it reveals three slots extending inward. */
export function battleItemDock(viewport: ViewportMetrics, playerId: PlayerId, expanded = false) {
  const { width, height, safeArea, uiScale: ui } = viewport;
  const mobile = (height - safeArea.top - safeArea.bottom) / ui <= 600;
  const size = (mobile ? 48 : 52) * ui, step = size + 8 * ui;
  const right = playerId === 'P2';
  const middle = safeArea.top + (height - safeArea.top - safeArea.bottom) / 2;
  const gear = battleSettingsRect(viewport);
  // Leave the bottom 48px movement row clear even while the bag is open.
  const y = mobile ? Math.max(safeArea.top + size / 2, Math.min(
    Math.max(middle, gear.y + 56 * ui), height - safeArea.bottom - 88 * ui)) : middle;
  const inline = mobile && y < gear.y + 56 * ui;
  const tiny = (height - safeArea.top - safeArea.bottom) / ui < 180;
  const inset = mobile ? (inline ? (tiny && !right ? 156 : 100) : 32) * ui : 34 * ui;
  const x = right ? width - safeArea.right - inset : safeArea.left + inset;
  const rect = (index: number): ScreenRect => ({
    x: mobile ? x + (right ? -1 : 1) * (index + 1) * step : x,
    y: mobile ? y : y + (index - 1) * step, width: size, height: size,
  });
  return { collapsed: mobile, bag: mobile ? { x, y, width: size, height: size } : null,
    slots: mobile && !expanded ? [] : Array.from({ length: 3 }, (_, i) => rect(i)) };
}

/** Gear stays below the portrait, away from either team's fixed item and aim docks. */
export function battleSettingsRect(viewport: ViewportMetrics): ScreenRect {
  const { width, height, safeArea, uiScale: ui } = viewport;
  const available = (width - safeArea.left - safeArea.right) / ui;
  const scale = Math.max(0, Math.min(1, (available - 110) / 540)) * ui;
  const x = Math.min(safeArea.left + ((height - safeArea.top - safeArea.bottom) / ui < 180 ? 100 : 44) * ui, width - safeArea.right - 24 * ui);
  const y = safeArea.top + 83 * scale + 32 * ui;
  return { x, y: Math.max(safeArea.top + 24 * ui, Math.min(y, height - safeArea.bottom - 24 * ui)),
    width: 48 * ui, height: 48 * ui };
}
