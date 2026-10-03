import type { ViewportMetrics } from '../platform/viewportMath';
import type { PlayerId } from '../state/ids';
import type { ScreenRect } from './touchAimLayout';

/** Fixed background docks have priority over controls projected from the moving world. */
export function battleItemDock(viewport: ViewportMetrics, playerId: PlayerId, expanded = true) {
  const { width, height, safeArea, uiScale: ui } = viewport;
  const size = 52 * ui, step = 60 * ui;
  const collapsed = (height - safeArea.top - safeArea.bottom) / ui < 360;
  const canExpand = (width - safeArea.left - safeArea.right) / ui >= 344;
  const right = playerId === 'P2';
  const x = right ? width - safeArea.right - 34 * ui : safeArea.left + 34 * ui;
  const y = safeArea.top + (height - safeArea.top - safeArea.bottom) / 2;
  const rect = (index: number): ScreenRect => ({
    x: collapsed ? x + (right ? -1 : 1) * index * step : x,
    y: collapsed ? y : y + (index - 1) * step, width: size, height: size,
  });
  return { collapsed, bag: collapsed ? rect(0) : null,
    slots: Array.from({ length: collapsed ? (expanded && canExpand ? 3 : 0) : 3 }, (_, i) => rect(collapsed ? i + 1 : i)) };
}

/** Gear stays below the portrait, away from either team's fixed item and aim docks. */
export function battleSettingsRect(viewport: ViewportMetrics): ScreenRect {
  const { width, height, safeArea, uiScale: ui } = viewport;
  const available = (width - safeArea.left - safeArea.right) / ui;
  const scale = Math.max(0, Math.min(1, (available - 110) / 540)) * ui;
  const dock = battleItemDock(viewport, 'P1');
  let x = safeArea.left + 110 * ui;
  let y = safeArea.top + 83 * scale + 32 * ui;
  if (dock.collapsed && y + 24 * ui + 8 * ui > dock.bag!.y - 26 * ui) {
    // Place the gear after the public inventory badges; scaling also preserves notch clearance.
    x = safeArea.left + 44 * ui + 155 * scale;
    const above = dock.bag!.y - 58 * ui;
    const below = dock.bag!.y + 58 * ui;
    // The top edge of a 48px gear needs clearance below the raised HP trough.
    // Short browser chrome can remove that clearance; use the space below the fixed row.
    const clearsHp = above - 24 * ui >= safeArea.top + 39 * scale + 8 * ui;
    const fitsBelow = below + 24 * ui <= height - safeArea.bottom;
    y = !clearsHp && fitsBelow ? below : above;
  }
  return { x, y: Math.max(safeArea.top + 24 * ui, Math.min(y, height - safeArea.bottom - 24 * ui)),
    width: 48 * ui, height: 48 * ui };
}
