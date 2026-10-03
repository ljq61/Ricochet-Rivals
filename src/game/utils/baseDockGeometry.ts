import { GAME_CONFIG } from '../config/GameConfig';
import type { PlayerId } from '../state/ids';

/** Shared base deck geometry in world coordinates, without renderer dependencies. */
export function baseDockGeometry(id: PlayerId): { center: number; dockWidth: number } {
  const bounds = id === 'P1' ? GAME_CONFIG.player.leftBounds : GAME_CONFIG.player.rightBounds;
  return {
    center: (bounds.minX + bounds.maxX) / 2,
    dockWidth: bounds.maxX - bounds.minX + GAME_CONFIG.world.platformOverhang * 2,
  };
}
