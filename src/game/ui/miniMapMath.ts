import { GAME_CONFIG } from '../config/GameConfig';
import type { ViewportMetrics } from '../platform/viewportMath';
import type { PlayerState } from '../state/PlayerState';
import type { PlayerId } from '../state/ids';
import { touchAimRect, type ScreenRect } from './touchAimLayout';

/** Shared screen-space positions keep the map, HP cards and turn message separate. */
export function battleHudLayout(viewport: ViewportMetrics): { map: ScreenRect; banner: ScreenRect } {
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
  const aim = touchAimRect(viewport);
  let bannerHeight = 52 * uiScale;
  let bannerY = safeArea.top + Math.max(83 * hudScale + 8, 50) * uiScale + bannerHeight / 2;
  let bannerWidth = (available - 16) * uiScale;
  const spaceAboveAim = aim.y - aim.height / 2 - (map.y + map.height / 2 + 10 * uiScale);
  if (viewport.height / uiScale <= 220) {
    // Keep short messages between the map and movement row, instead of covering
    // the base controls. Wide displays have a clear gap between the HP cards.
    const movementTop = viewport.height - safeArea.bottom - 48 * uiScale - 8 * uiScale;
    const belowCards = Math.max(map.y + map.height / 2 + 8 * uiScale,
      safeArea.top + 83 * hudScale * uiScale + 4 * uiScale);
    if (available < 600 && movementTop - 8 * uiScale - belowCards >= 28 * uiScale) {
      bannerWidth = Math.min(bannerWidth, aim.x - aim.width / 2 - safeArea.left - 16 * uiScale);
      bannerHeight = Math.min(36 * uiScale, movementTop - 8 * uiScale - belowCards);
      bannerY = belowCards + bannerHeight / 2;
      return { map, banner: { x: safeArea.left + 8 * uiScale + bannerWidth / 2,
        y: bannerY, width: bannerWidth, height: bannerHeight } };
    }
    bannerWidth = Math.max(48 * uiScale, (middleGap - 12) * uiScale);
    bannerHeight = 36 * uiScale;
    bannerY = map.y + map.height / 2 + 8 * uiScale + bannerHeight / 2;
  } else if (available < 600 && viewport.height / uiScale < 320 && spaceAboveAim >= 16 * uiScale) {
    bannerHeight = Math.min(24 * uiScale, spaceAboveAim);
    bannerY = map.y + map.height / 2 + 6 * uiScale + bannerHeight / 2;
  } else if (Math.abs(bannerY - aim.y) < (bannerHeight + aim.height) / 2) {
    // On short landscape screens, long connection messages must stop before Aim.
    bannerWidth = Math.min(bannerWidth, 2 * (aim.x - aim.width / 2 - map.x - 8 * uiScale));
  }
  return { map, banner: { x: map.x, y: bannerY, width: bannerWidth, height: bannerHeight } };
}

export function miniMapWorldX(x: number, width: number, uiScale: number): number {
  const inset = 8 * uiScale;
  const ratio = Math.max(0, Math.min(1, x / GAME_CONFIG.world.width));
  return -width / 2 + inset + ratio * (width - 2 * inset);
}

export function miniMapSnapshot(
  viewport: ViewportMetrics,
  players: Record<PlayerId, PlayerState>,
  currentPlayerId: PlayerId,
) {
  const { map } = battleHudLayout(viewport);
  const project = (x: number) => map.x + miniMapWorldX(x, map.width, viewport.uiScale);
  const base = (id: PlayerId) => {
    const bounds = id === 'P1' ? GAME_CONFIG.player.leftBounds : GAME_CONFIG.player.rightBounds;
    return { left: project(bounds.minX), right: project(bounds.maxX), y: map.y + 8 * viewport.uiScale };
  };
  const player = (id: PlayerId) => ({
    x: project(players[id].x), worldX: players[id].x, y: map.y - 3 * viewport.uiScale,
    alive: players[id].isAlive, current: id === currentPlayerId,
  });
  return { rect: map, bases: { P1: base('P1'), P2: base('P2') },
    players: { P1: player('P1'), P2: player('P2') }, currentPlayerId };
}

export type MiniMapSnapshot = ReturnType<typeof miniMapSnapshot>;
