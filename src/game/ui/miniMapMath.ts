import { GAME_CONFIG } from '../config/GameConfig';
import type { ViewportMetrics } from '../platform/viewportMath';
import type { PlayerState } from '../state/PlayerState';
import type { PlayerId } from '../state/ids';
import type { ProjectileState } from '../state/ProjectileState';
import { touchAimRect, type ScreenRect } from './touchAimLayout';
import { battleItemDock, battleSettingsRect } from './battleSideDockLayout';

/** Shared screen-space positions keep the map, HP cards and turn message separate. */
export function battleHudLayout(viewport: ViewportMetrics, playerId: PlayerId = 'P1'): { map: ScreenRect; banner: ScreenRect } {
  const { width, safeArea, uiScale } = viewport;
  const available = (width - safeArea.left - safeArea.right) / uiScale;
  const hudScale = Math.max(0, Math.min(1, (available - 110) / 540));
  const middleGap = available - 24 - 540 * hudScale;
  const mapWidth = Math.max(48, Math.min(220, middleGap - 12)) * uiScale;
  const map = {
    x: safeArea.left + available * uiScale / 2,
    y: safeArea.top + 24 * uiScale,
    width: mapWidth,
    height: 36 * uiScale,
  };
  const finish = (banner: ScreenRect) => {
    const dock = battleItemDock(viewport, playerId);
    const obstacles = [...dock.slots, battleSettingsRect(viewport), ...(dock.bag ? [dock.bag] : [])];
    const gap = 8 * uiScale;
    let left = banner.x - banner.width / 2, right = banner.x + banner.width / 2;
    for (const rect of obstacles) {
      if (Math.abs(rect.y - banner.y) >= (rect.height + banner.height) / 2 + gap) continue;
      if (rect.x < map.x) left = Math.max(left, rect.x + rect.width / 2 + gap);
      else right = Math.min(right, rect.x - rect.width / 2 - gap);
    }
    // Retain the existing tiny-surface fallback; the landscape gate owns unsupported sizes.
    if (right - left < 48 * uiScale) return { map, banner };
    return { map, banner: { ...banner, x: (left + right) / 2, width: right - left } };
  };
  const aim = touchAimRect(viewport, playerId);
  const shortScreen = (viewport.height - safeArea.top - safeArea.bottom) / uiScale < 280;
  let bannerHeight = (shortScreen ? 24 : 52) * uiScale;
  let bannerY = safeArea.top + Math.max(83 * hudScale + 8, 50) * uiScale + bannerHeight / 2;
  let bannerWidth = (available - 16) * uiScale;
  if (viewport.height / uiScale <= 220) {
    // On the narrowest landscape surface, leave the upper corners available
    // for 48px controls rather than stretching the message across one side.
    if (available < 360) return finish({ x: map.x,
      y: map.y + map.height / 2 + 8 * uiScale + bannerHeight / 2,
      width: 48 * uiScale, height: bannerHeight });
    // Keep short messages between the map and movement row, instead of covering
    // the base controls. Wide displays have a clear gap between the HP cards.
    bannerWidth = Math.max(48 * uiScale, (middleGap - 12) * uiScale);
    bannerY = map.y + map.height / 2 + 8 * uiScale + bannerHeight / 2;
  } else if (Math.abs(bannerY - aim.y) < (bannerHeight + aim.height) / 2) {
    // On short landscape screens, long connection messages must stop before Aim.
    bannerWidth = Math.min(bannerWidth, 2 * (Math.abs(aim.x - map.x) - aim.width / 2 - 8 * uiScale));
  }
  return finish({ x: map.x, y: bannerY, width: bannerWidth, height: bannerHeight });
}

export function miniMapWorldX(x: number, width: number, uiScale: number): number {
  const inset = 8 * uiScale;
  const ratio = Math.max(0, Math.min(1, x / GAME_CONFIG.world.width));
  return -width / 2 + inset + ratio * (width - 2 * inset);
}

export interface MiniMapWorldRect { x: number; y: number; width: number; height: number }
export interface MiniMapContext {
  cameraWorldView: MiniMapWorldRect;
  projectiles: readonly ProjectileState[];
}

/** Map the full world into a small 2D plot; high arcs stay visible on its top edge. */
export function miniMapProjection(viewport: ViewportMetrics) {
  const { map } = battleHudLayout(viewport);
  const ui = viewport.uiScale;
  const plot = { left: map.x - map.width / 2 + 8 * ui, right: map.x + map.width / 2 - 8 * ui,
    top: map.y - map.height / 2 + 6 * ui, bottom: map.y + map.height / 2 - 6 * ui };
  const project = (x: number, y: number) => ({
    x: plot.left + Math.max(0, Math.min(1, x / GAME_CONFIG.world.width)) * (plot.right - plot.left),
    y: plot.top + Math.max(0, Math.min(1, y / GAME_CONFIG.world.height)) * (plot.bottom - plot.top),
  });
  return { plot, project };
}

export function miniMapCameraFrame(viewport: ViewportMetrics, world: MiniMapWorldRect) {
  const { project } = miniMapProjection(viewport);
  const clampX = (x: number) => Math.max(0, Math.min(GAME_CONFIG.world.width, x));
  const clampY = (y: number) => Math.max(0, Math.min(GAME_CONFIG.world.height, y));
  const left = clampX(world.x), right = clampX(world.x + Math.max(0, world.width));
  const top = clampY(world.y), bottom = clampY(world.y + Math.max(0, world.height));
  const first = project(left, top), last = project(right, bottom);
  return {
    world: { ...world },
    clampedWorld: { x: left, y: top, width: right - left, height: bottom - top },
    frame: { x: (first.x + last.x) / 2, y: (first.y + last.y) / 2,
      width: last.x - first.x, height: last.y - first.y },
    visible: right > left && bottom > top,
  };
}

export function miniMapSnapshot(
  viewport: ViewportMetrics,
  players: Record<PlayerId, PlayerState>,
  currentPlayerId: PlayerId,
  context?: MiniMapContext,
) {
  const { map } = battleHudLayout(viewport);
  const { plot, project: projectPoint } = miniMapProjection(viewport);
  const project = (x: number) => map.x + miniMapWorldX(x, map.width, viewport.uiScale);
  const base = (id: PlayerId) => {
    const bounds = id === 'P1' ? GAME_CONFIG.player.leftBounds : GAME_CONFIG.player.rightBounds;
    return { left: project(bounds.minX), right: project(bounds.maxX),
      y: projectPoint(bounds.minX, GAME_CONFIG.world.groundTopY).y };
  };
  const player = (id: PlayerId) => ({
    ...projectPoint(players[id].x, players[id].y), worldX: players[id].x, worldY: players[id].y,
    markerY: projectPoint(players[id].x, players[id].y).y - 5 * viewport.uiScale,
    alive: players[id].isAlive, current: id === currentPlayerId,
  });
  const projectiles = (context?.projectiles ?? []).filter((p) => p.status === 'flying').map((p) => ({
    id: p.id, ownerId: p.ownerId, worldX: p.x, worldY: p.y,
    ...projectPoint(p.x, p.y),
    clamped: p.x < 0 || p.x > GAME_CONFIG.world.width || p.y < 0 || p.y > GAME_CONFIG.world.height,
  }));
  return { rect: map, plot, bases: { P1: base('P1'), P2: base('P2') },
    players: { P1: player('P1'), P2: player('P2') }, currentPlayerId, projectiles,
    cameraView: context ? miniMapCameraFrame(viewport, context.cameraWorldView) : null };
}

export type MiniMapSnapshot = ReturnType<typeof miniMapSnapshot>;
