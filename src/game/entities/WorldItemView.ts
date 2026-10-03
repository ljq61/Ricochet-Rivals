import Phaser from 'phaser';
import type { WorldItemState } from '../state/WorldItemState';
import type { WorldItemType } from '../state/ids';
import { createItemArt, drawItemIcon, ITEM_COLORS, ITEM_LABELS } from '../ui/itemIcon';
import { ART, ITEM_SUPPLY_ART } from '../config/ArtAssets';

interface CrateView {
  container: Phaser.GameObjects.Container;
  icon: Phaser.GameObjects.Graphics;
  artIcon: Phaser.GameObjects.Image | null;
  type: WorldItemType;
  iconSize: number;
  bornAt: number;
  x: number;
  y: number;
}

/** Visual bobbing never changes the logical 80×64 crate or projectile physics. */
export class WorldItemView {
  private readonly views = new Map<string, CrateView>();
  private readonly pickupFlights = new Map<Phaser.GameObjects.Container, Phaser.Tweens.Tween>();

  constructor(private readonly scene: Phaser.Scene) {}

  get enteringUntil(): number {
    return Math.max(0, ...Array.from(this.views.values(), (view) => view.bornAt + 350));
  }

  refresh(items: readonly WorldItemState[]): void {
    const active = new Set(items.filter((item) => item.active).map((item) => item.id));
    for (const [id, view] of this.views) if (!active.has(id)) {
      view.container.destroy(); this.views.delete(id);
    }
    for (const item of items) {
      if (!item.active) continue;
      const existing = this.views.get(item.id);
      if (existing) {
        existing.x = item.x; existing.y = item.y;
        if (existing.type !== item.type) { existing.type = item.type; existing.iconSize = 0; }
        continue;
      }
      const g = this.scene.add.graphics();
      const supply = this.scene.textures?.exists(ART.itemSupply)
        ? this.scene.add.image(0, 0, ART.itemSupply)
          .setOrigin(ITEM_SUPPLY_ART.originX, ITEM_SUPPLY_ART.originY)
          .setDisplaySize(ITEM_SUPPLY_ART.displayWidth, ITEM_SUPPLY_ART.displayHeight)
        : null;
      // Golden canvas canopy with three cloth panels and a dark stitched rim.
      if (!supply) {
        g.fillStyle(0xa96823).fillEllipse(0, -91, 110, 52);
        g.fillStyle(0xe2af4e).fillEllipse(0, -94, 106, 46);
        g.fillStyle(0xf7d174).fillEllipse(0, -96, 48, 44);
        g.lineStyle(2, 0x80522b).lineBetween(-51, -81, 51, -81);
        g.lineStyle(2, 0xdac28b);
        for (const x of [-49, -24, 24, 49]) g.lineBetween(x, -81, Math.sign(x) * 30, -32);
        g.fillStyle(0x251b17).fillRoundedRect(-42, -34, 84, 68, 4);
        g.fillStyle(0x906037).fillRoundedRect(-40, -32, 80, 64, 3);
        g.fillStyle(0xb17e47).fillRect(-36, -28, 72, 15);
        g.lineStyle(2, 0x62402b);
        for (const y of [-12, 9, 27]) g.lineBetween(-36, y, 36, y);
        g.fillStyle(0xb9ad86);
        for (const x of [-1, 1]) for (const y of [-1, 1]) {
          g.fillRect(x < 0 ? -40 : 29, y < 0 ? -32 : 21, 11, 11);
          g.fillStyle(0x493c31).fillCircle(x * 34, y * 26, 2);
          g.fillStyle(0xb9ad86);
        }
      }
      const icon = this.scene.add.graphics();
      const artIcon = createItemArt(this.scene, item.type, 0, 0, 27);
      const container = this.scene.add.container(item.x, item.y, [supply ?? g, icon, ...(artIcon ? [artIcon] : [])]).setDepth(35);
      if (supply) g.destroy();
      this.views.set(item.id, { container, icon, artIcon, type: item.type, iconSize: 0,
        bornAt: this.scene.time.now, x: item.x, y: item.y });
    }
  }

  update(time: number): void {
    for (const view of this.views.values()) {
      const dpr = Math.max(1, window.devicePixelRatio || 1);
      const size = Math.max(27, 16 * dpr / this.scene.cameras.main.zoom);
      if (view.iconSize !== size) {
        view.iconSize = size;
        const g = view.icon.clear();
        if (view.artIcon) {
          view.artIcon.setFrame(view.type).setDisplaySize(size, size);
        } else {
          g.fillStyle(0x25313a).fillRoundedRect(-size / 2 - 3, -size / 2 - 3, size + 6, size + 6, 4);
          drawItemIcon(g, view.type, 0, 0, size);
        }
      }
      const age = Math.max(0, time - view.bornAt), progress = Math.min(1, age / 350);
      const bob = Math.sin(age / 650) * 3;
      view.container.setPosition(view.x, view.y - (1 - progress) * 24 + bob)
        .setAlpha(progress).setRotation(Math.sin(age / 950) * 0.025);
    }
  }

  pickupFeedback(type: WorldItemType, x: number, y: number,
    target?: { x: number; y: number }, uiScale = Math.max(1, window.devicePixelRatio || 1)): void {
    const text = this.scene.add.text(x, y, `拾取 · ${ITEM_LABELS[type]}`, {
      fontFamily: 'sans-serif', fontSize: '32px', fontStyle: 'bold', color: '#fff0c9',
      stroke: '#17242d', strokeThickness: 5,
    }).setOrigin(0.5).setDepth(70);
    const ring = this.scene.add.graphics().setPosition(x, y).setDepth(69);
    ring.lineStyle(4, ITEM_COLORS[type]).strokeCircle(0, 0, 34);
    this.scene.tweens.add({ targets: text, y: y - 75, alpha: 0, duration: 650, onComplete: () => text.destroy() });
    this.scene.tweens.add({ targets: ring, scale: 2.5, alpha: 0, duration: 450, onComplete: () => ring.destroy() });
    if (target) this.flyToInventory(type, x, y, target, uiScale);
  }

  homingFeedback(x: number, y: number): void {
    const art = createItemArt(this.scene, 'homing', x, y, 80);
    const ring = art ?? this.scene.add.graphics().setPosition(x, y);
    ring.setDepth(70);
    if (!art) drawItemIcon(ring as Phaser.GameObjects.Graphics, 'homing', 0, 0, 80);
    this.scene.tweens.add({ targets: ring, alpha: 0, scale: 0.7, duration: 450, onComplete: () => ring.destroy() });
  }

  destroy(): void {
    for (const view of this.views.values()) view.container.destroy();
    this.views.clear();
    for (const [flight, tween] of this.pickupFlights) { tween.remove(); flight.destroy(); }
    this.pickupFlights.clear();
  }

  private flyToInventory(type: WorldItemType, worldX: number, worldY: number,
    target: { x: number; y: number }, uiScale: number): void {
    const camera = this.scene.cameras.main;
    // Project exactly once; subsequent camera following must not drag this HUD feedback along.
    const start = { x: (worldX - camera.scrollX - camera.width / 2) * camera.zoom + camera.width / 2,
      y: (worldY - camera.scrollY - camera.height / 2) * camera.zoom + camera.height / 2 };
    const g = this.scene.add.graphics();
    const art = createItemArt(this.scene, type, 0, 0, 36 * uiScale);
    if (!art) {
      g.fillStyle(0x17242d, 0.95).fillCircle(0, 0, 18 * uiScale);
      g.lineStyle(2 * uiScale, ITEM_COLORS[type]).strokeCircle(0, 0, 18 * uiScale);
      drawItemIcon(g, type, 0, 0, 24 * uiScale);
    }
    const flight = this.scene.add.container(0, 0, [art ?? g]).setScrollFactor(0).setDepth(980);
    if (art) g.destroy();
    const progress = { value: 0 };
    const place = () => {
      const current = this.scene.cameras.main;
      const point = { x: start.x + (target.x - start.x) * progress.value,
        y: start.y + (target.y - start.y) * progress.value - Math.sin(progress.value * Math.PI) * 28 * uiScale };
      flight.setScale(1 / current.zoom).setPosition(
        current.width / 2 + (point.x - current.width / 2) / current.zoom,
        current.height / 2 + (point.y - current.height / 2) / current.zoom);
    };
    place();
    const tween = this.scene.tweens.add({ targets: progress, value: 1, duration: 550,
      ease: 'Cubic.easeInOut', onUpdate: place, onComplete: () => {
        this.pickupFlights.delete(flight); flight.destroy();
      } });
    this.pickupFlights.set(flight, tween);
  }
}
