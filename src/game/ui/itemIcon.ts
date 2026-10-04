import { t } from '../i18n/locale';
import type Phaser from 'phaser';
import type { WorldItemType } from '../state/ids';
import { ART } from '../config/ArtAssets';

/** Generated button art is shared by the HUD, crate badge and pickup flight. */
export function createItemArt(scene: Phaser.Scene, type: WorldItemType | 'bag' | 'empty',
  x: number, y: number, size: number): Phaser.GameObjects.Image | null {
  const texture = type === 'airstrike' ? ART.airstrikeIcon : ART.itemHud;
  if (!scene.textures?.exists(texture) || !scene.textures.get(texture).has(type)) return null;
  return scene.add.image(x, y, texture, type).setOrigin(0.5).setDisplaySize(size, size);
}

export const ITEM_LABELS: Record<WorldItemType, string> = {
  heal: '+2 HP', damage_boost: t('威力', 'Power'), range_boost: t('范围', 'Blast'), homing: t('锁定', 'Homing'), airstrike: t('空袭', 'Airstrike'),
};

export const ITEM_COLORS: Record<WorldItemType, number> = {
  heal: 0x82d29b, damage_boost: 0xf5ad66, range_boost: 0x80d7ee, homing: 0xffdd79, airstrike: 0xffce71,
};

/** One readable symbol language shared by crates, slots and read-only inventory badges. */
export function drawItemIcon(g: Phaser.GameObjects.Graphics, type: WorldItemType, x: number, y: number, size: number): void {
  const r = size / 2;
  g.lineStyle(Math.max(1, size / 10), ITEM_COLORS[type], 1);
  g.fillStyle(ITEM_COLORS[type], 1);
  if (type === 'heal') {
    g.fillRoundedRect(x - r / 3, y - r, r * 2 / 3, size, r / 8);
    g.fillRoundedRect(x - r, y - r / 3, size, r * 2 / 3, r / 8);
  } else if (type === 'damage_boost') {
    g.fillTriangle(x - r * 0.8, y, x + r * 0.2, y - r, x + r * 0.2, y + r * 0.15);
    g.fillTriangle(x - r * 0.2, y - r * 0.15, x + r * 0.8, y, x - r * 0.2, y + r);
  } else if (type === 'range_boost') {
    g.strokeCircle(x, y, r * 0.9);
    g.strokeCircle(x, y, r * 0.42);
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      g.lineBetween(x + dx! * r * 0.6, y + dy! * r * 0.6, x + dx! * r * 1.15, y + dy! * r * 1.15);
    }
  } else {
    g.strokeCircle(x, y, r * 0.65);
    g.fillCircle(x, y, r * 0.17);
    g.lineBetween(x - r, y, x - r * 0.45, y);
    g.lineBetween(x + r * 0.45, y, x + r, y);
    g.lineBetween(x, y - r, x, y - r * 0.45);
    g.lineBetween(x, y + r * 0.45, x, y + r);
  }
}
