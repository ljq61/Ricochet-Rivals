import Phaser from 'phaser';
import type { InputRouter } from '../input/InputRouter';
import type { GesturePointerEvent } from '../input/gesture';
import type { ViewportService } from '../platform/ViewportService';
import type { GameState } from '../state/GameState';
import type { PlayerId } from '../state/ids';
import { itemHudLayout, type ItemHudLayout, type ItemHudObstacle } from './itemHudLayout';
import { ART } from '../config/ArtAssets';
import { createItemArt, drawItemIcon, ITEM_LABELS } from './itemIcon';
import type { ScreenRect } from './touchControlLayout';

export interface ItemHudDeps {
  router: InputRouter;
  viewport: ViewportService;
  getState: () => GameState;
  getPlayerId: () => PlayerId;
  canUse: () => boolean;
  getSelectedItemId: () => string | null;
  isPending: () => boolean;
  onSlotTap: (itemId: string) => void;
  /** Actual movement, desktop aim and launcher drag hot regions in canvas pixels. */
  getReservedRects?: () => readonly ItemHudObstacle[];
}

/** Read-only presentation. Rule mutations and pending attack selection belong to BattleScene. */
export class ItemHud {
  private readonly container: Phaser.GameObjects.Container;
  private readonly graphics: Phaser.GameObjects.Graphics;
  private readonly overlays: Phaser.GameObjects.Graphics;
  private readonly art: Array<Phaser.GameObjects.Image | null>;
  private readonly labels: Phaser.GameObjects.Text[];
  private readonly unsubscribeViewport: () => void;
  private layout: ItemHudLayout;
  private expanded = false;
  private context = '';
  private drawKey = '';
  private pressed: { pointerId: number; key: number; itemId: string | null; clientX: number; clientY: number; dragged: boolean } | null = null;

  constructor(scene: Phaser.Scene, private readonly deps: ItemHudDeps) {
    this.graphics = scene.add.graphics();
    this.overlays = scene.add.graphics();
    // Reuse images while moving/aiming instead of allocating textures on every HUD refresh.
    this.art = Array.from({ length: 7 }, () => createItemArt(scene, 'empty', 0, 0, 52));
    this.labels = Array.from({ length: 4 }, () => scene.add.text(0, 0, '', {
      fontFamily: 'sans-serif', color: '#ffefc6', fontStyle: 'bold',
    }).setOrigin(0.5));
    this.container = scene.add.container(0, 0, [this.graphics, ...this.art.filter((art) => art !== null), this.overlays, ...this.labels])
      .setScrollFactor(0).setDepth(960);
    this.layout = itemHudLayout(deps.viewport.current, deps.getPlayerId(), false);
    // A disabled visible slot still owns its pointer, so it cannot fire or move the player.
    for (let key = -1; key < 3; key++) {
      deps.router.registerZone({ id: `item-slot-${key}`, kind: 'UI',
        isActive: () => this.rectFor(key) !== null,
        contains: (x, y) => this.contains(this.rectFor(key), x, y),
        onDown: (e) => this.down(key, e), onUp: (e) => this.up(key, e),
        onCancel: (e) => { if (this.pressed?.pointerId === e.pointerId) this.pressed = null; },
      });
    }
    // GestureZone intentionally lacks onMove; tracking displacement does not claim another owner.
    window.addEventListener('pointermove', this.trackMove);
    this.unsubscribeViewport = deps.viewport.onChange(() => {
      this.pressed = null; this.expanded = false; this.drawKey = ''; this.refresh();
    });
    this.refresh();
  }

  get debugState() {
    const state = this.deps.getState();
    const playerId = this.deps.getPlayerId();
    return { playerId, collapsed: this.layout.collapsed, expanded: this.expanded,
      bag: this.layout.bag ? { ...this.layout.bag } : null,
      slots: this.layout.slots.map((rect, slot) => ({ ...rect, slot,
        item: state.players[playerId].inventory[slot] ?? null })),
      selected: this.deps.getSelectedItemId(), canUse: this.deps.canUse(), pending: this.deps.isPending(),
      used: state.players[playerId].itemUsedThisTurn };
  }

  /** Screen/canvas point shared by the pickup flight and the public inventory display. */
  inventoryTarget(playerId: PlayerId, slot: number): { x: number; y: number } {
    if (playerId === this.deps.getPlayerId()) {
      const rect = this.layout.slots[slot] ?? this.layout.bag;
      if (rect) return { x: rect.x, y: rect.y };
    }
    const { width, safeArea, uiScale: ui } = this.deps.viewport.current;
    const scale = Math.max(0, Math.min(1, ((width - safeArea.left - safeArea.right) / ui - 110) / 540));
    return { x: (playerId === 'P1' ? safeArea.left + 12 * ui + 102 * scale * ui
      : width - safeArea.right - 12 * ui - 166 * scale * ui) + slot * 22 * scale * ui,
      y: safeArea.top + 58 * scale * ui };
  }

  refresh(): void {
    const state = this.deps.getState(), playerId = this.deps.getPlayerId();
    const context = `${state.matchId}:${state.turnId}:${playerId}`;
    if (this.context !== context) { this.context = context; this.pressed = null; this.expanded = false; }
    if (this.pressed && this.pressed.key >= 0 && (!this.deps.canUse() || this.deps.isPending())) this.pressed = null;
    const viewport = this.deps.viewport.current;
    this.layout = itemHudLayout(viewport, playerId, this.expanded, this.deps.getReservedRects?.());
    const key = JSON.stringify([this.layout.slots, this.layout.bag, state.players,
      this.deps.getSelectedItemId(), this.deps.canUse(), this.deps.isPending(), viewport.zoom]);
    if (key === this.drawKey) return;
    this.drawKey = key;
    const { width, height, zoom, uiScale: ui, safeArea } = viewport;
    this.container.setPosition(width / 2, height / 2).setScale(1 / zoom);
    const g = this.graphics.clear();
    const overlay = this.overlays.clear();
    this.art.forEach((image) => image?.setVisible(false));
    this.labels.forEach((label) => label.setVisible(false));
    const player = state.players[playerId];
    const selected = this.deps.getSelectedItemId();
    const drawPlate = (rect: ScreenRect, enabled: boolean, active: boolean) => {
      const x = rect.x - width / 2, y = rect.y - height / 2;
      g.fillStyle(0x101820, 0.97).fillRoundedRect(x - rect.width / 2, y - rect.height / 2, rect.width, rect.height, 5 * ui);
      g.fillStyle(active ? 0x715329 : 0x382a21, enabled ? 1 : 0.7)
        .fillRoundedRect(x - rect.width / 2 + 4 * ui, y - rect.height / 2 + 4 * ui, rect.width - 8 * ui, rect.height - 8 * ui, 3 * ui);
      g.lineStyle((active ? 3 : 1.5) * ui, active ? 0xffdc81 : 0xa38d63, enabled ? 1 : 0.5)
        .strokeRoundedRect(x - rect.width / 2, y - rect.height / 2, rect.width, rect.height, 5 * ui);
      for (const dx of [-1, 1]) for (const dy of [-1, 1]) {
        g.fillStyle(0xc7b186).fillCircle(x + dx * (rect.width / 2 - 6 * ui), y + dy * (rect.height / 2 - 6 * ui), 1.5 * ui);
      }
    };
    this.layout.slots.forEach((rect, slot) => {
      const item = player.inventory[slot];
      const enabled = this.deps.canUse() && !this.deps.isPending() && !!item && (item.type !== 'heal' || player.hp < player.maxHp);
      const active = !!item && selected === item.id;
      const image = this.art[slot];
      if (image) {
        image.setVisible(true).setTexture(item?.type === 'airstrike' ? ART.airstrikeIcon : ART.itemHud, item?.type ?? 'empty')
          .setPosition(rect.x - width / 2, rect.y - height / 2)
          .setDisplaySize(rect.width, rect.height).setAlpha(enabled || active ? 1 : 0.55);
        if (active) overlay.lineStyle(3 * ui, 0xffdc81).strokeRoundedRect(
          rect.x - width / 2 - rect.width / 2, rect.y - height / 2 - rect.height / 2,
          rect.width, rect.height, 5 * ui);
        overlay.fillStyle(0x101820, 0.8).fillRoundedRect(
          rect.x - width / 2 - 20 * ui, rect.y - height / 2 + 14 * ui, 40 * ui, 10 * ui, 2 * ui);
      } else {
        drawPlate(rect, enabled, active);
        if (item) drawItemIcon(g, item.type, rect.x - width / 2, rect.y - height / 2 - 6 * ui, 24 * ui);
      }
      this.labels[slot]!.setVisible(true).setPosition(rect.x - width / 2, rect.y - height / 2 + 19 * ui)
        .setFontSize(8 * ui).setAlpha(enabled || active ? 1 : 0.55)
        .setText(active ? (item?.type === 'homing' ? '待用 0.8s' : '待用') : item ? ITEM_LABELS[item.type] : '空槽');
    });
    if (this.layout.bag) {
      const rect = this.layout.bag;
      const x = rect.x - width / 2, y = rect.y - height / 2;
      const image = this.art[3];
      if (image) {
        image.setVisible(true).setTexture(ART.itemHud, 'bag').setPosition(x, y)
          .setDisplaySize(rect.width, rect.height).setAlpha(1);
        if (selected !== null) overlay.lineStyle(3 * ui, 0xffdc81)
          .strokeRoundedRect(x - rect.width / 2, y - rect.height / 2, rect.width, rect.height, 5 * ui);
        overlay.fillStyle(0x101820, 0.8).fillRoundedRect(x - 22 * ui, y + 12 * ui, 44 * ui, 14 * ui, 2 * ui);
      } else {
        drawPlate(rect, true, selected !== null);
        g.fillStyle(0xa28250).fillRoundedRect(x - 13 * ui, y - 17 * ui, 26 * ui, 23 * ui, 3 * ui);
        g.lineStyle(2 * ui, 0xf4dc9c).strokeRoundedRect(x - 8 * ui, y - 21 * ui, 16 * ui, 8 * ui, 3 * ui);
      }
      this.labels[3]!.setVisible(true).setPosition(x, y + 19 * ui).setFontSize(8 * ui)
        .setText(this.expanded ? '收起' : `背包 ${player.inventory.filter(Boolean).length}/3`);
    }
    // Public opponent inventory badges below the HP bar, never an input zone.
    const opponentId = playerId === 'P1' ? 'P2' : 'P1';
    const hpScale = Math.max(0, Math.min(1, ((width - safeArea.left - safeArea.right) / ui - 110) / 540));
    const badgeY = safeArea.top + 58 * hpScale * ui;
    const baseX = opponentId === 'P1' ? safeArea.left + 12 * ui + 102 * hpScale * ui
      : width - safeArea.right - 12 * ui - 166 * hpScale * ui;
    state.players[opponentId].inventory.forEach((item, i) => {
      const x = baseX + i * 22 * hpScale * ui - width / 2, y = badgeY - height / 2;
      const image = this.art[4 + i];
      if (image) image.setVisible(true).setTexture(item?.type === 'airstrike' ? ART.airstrikeIcon : ART.itemHud, item?.type ?? 'empty').setPosition(x, y)
        .setDisplaySize(18 * hpScale * ui, 18 * hpScale * ui).setAlpha(item ? 1 : 0.45);
      else {
        g.fillStyle(0x101820, 0.9).fillCircle(x, y, 8 * hpScale * ui);
        if (item) drawItemIcon(g, item.type, x, y, 11 * hpScale * ui);
      }
    });
    // Keep state captions inside their plate; external captions could cover the next slot or Aim.
    const statusText = this.deps.isPending() ? '确认中…' : player.itemUsedThisTurn ? '本回合已用'
      : selected && this.layout.collapsed ? '下一发待用' : '';
    const caption = this.layout.bag ? this.labels[3] : this.labels[0];
    if (statusText && caption?.visible) {
      caption.setFontSize(8 * ui).setAlpha(1).setText(this.layout.bag
        ? `背包 ${player.inventory.filter(Boolean).length}/3\n${statusText}` : statusText);
    }
  }

  destroy(): void {
    this.unsubscribeViewport();
    window.removeEventListener('pointermove', this.trackMove);
    for (let key = -1; key < 3; key++) this.deps.router.unregisterZone(`item-slot-${key}`);
    this.pressed = null; this.container.destroy();
  }

  private readonly trackMove = (e: PointerEvent): void => {
    if (this.pressed?.pointerId === e.pointerId &&
      Math.hypot(e.clientX - this.pressed.clientX, e.clientY - this.pressed.clientY) > 8) this.pressed.dragged = true;
  };
  private rectFor(key: number): ScreenRect | null { return key < 0 ? this.layout.bag : this.layout.slots[key] ?? null; }
  private contains(rect: ScreenRect | null, x: number, y: number): boolean {
    return !!rect && Math.abs(x - rect.x) <= rect.width / 2 && Math.abs(y - rect.y) <= rect.height / 2;
  }
  private down(key: number, e: GesturePointerEvent): void {
    if (this.pressed) return;
    if (key >= 0 && (!this.deps.canUse() || this.deps.isPending())) return;
    const itemId = key < 0 ? null : this.deps.getState().players[this.deps.getPlayerId()].inventory[key]?.id ?? null;
    this.pressed = { key, itemId, pointerId: e.pointerId, clientX: e.clientX, clientY: e.clientY, dragged: false };
  }
  private up(key: number, e: GesturePointerEvent): void {
    const press = this.pressed;
    if (press?.pointerId !== e.pointerId) return;
    this.pressed = null;
    if (press.dragged || press.key !== key || !this.contains(this.rectFor(key), e.x, e.y)) return;
    if (key < 0) { this.expanded = !this.expanded; this.refresh(); return; }
    if (!this.deps.canUse() || this.deps.isPending()) return;
    const player = this.deps.getState().players[this.deps.getPlayerId()];
    const item = player.inventory[key];
    if (!item || item.id !== press.itemId || player.itemUsedThisTurn || (item.type === 'heal' && player.hp >= player.maxHp)) return;
    this.deps.onSlotTap(item.id);
    if (item.type !== 'heal') this.expanded = false;
    this.refresh();
  }
}
