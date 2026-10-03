import Phaser from 'phaser';
import { GAME_CONFIG } from '../config/GameConfig';
import { playerColor } from '../config/Palette';
import { battleSettingsRect } from './battleSideDockLayout';
import { ART } from '../config/ArtAssets';
import type { ViewportService } from '../platform/ViewportService';
import type { PlayerState } from '../state/PlayerState';
import type { PlayerId } from '../state/ids';

const CARD_WIDTH = 270;
const BAR_WIDTH = 178;
const HP_TWEEN_MS = 350;
interface HudEntry {
  container: Phaser.GameObjects.Container;
  plate: Phaser.GameObjects.Graphics;
  /** 头像框内衬底（从下往上渐变，画在头像之下、框之内） */
  portraitFill: Phaser.GameObjects.Graphics;
  avatar: Phaser.GameObjects.Image | null;
  hpText: Phaser.GameObjects.Text;
  displayedHp: number | null;
  shownHp: number;
  tween: Phaser.Tweens.Tween | null;
}

/** Compact concept HUD: framed portraits and animated HP segments. */
export class PlayerHud {
  private readonly entries: Record<PlayerId, HudEntry>;
  private readonly unsubscribeViewport: () => void;

  constructor(private readonly scene: Phaser.Scene, private readonly viewport: ViewportService) {
    this.entries = { P1: this.createEntry('P1'), P2: this.createEntry('P2') };
    this.unsubscribeViewport = viewport.onChange(() => this.reposition());
    this.reposition();
  }

  refresh(players: Record<PlayerId, PlayerState>): void {
    for (const id of ['P1', 'P2'] as const) {
      const entry = this.entries[id];
      const player = players[id];
      if (entry.displayedHp === player.hp) continue;
      const first = entry.displayedHp === null;
      entry.displayedHp = player.hp;
      entry.tween?.stop();
      if (first) {
        entry.shownHp = player.hp;
        this.drawEntry(entry, player);
      } else {
        if (entry.avatar && player.hp < entry.shownHp) {
          entry.avatar.setTint(0xff8b7a);
        }
        entry.tween = this.scene.tweens.add({
          targets: entry, shownHp: player.hp, duration: HP_TWEEN_MS, ease: 'Cubic.easeOut',
          onUpdate: () => this.drawEntry(entry, player),
          onComplete: () => {
            entry.avatar?.setTint(player.isAlive ? 0xffffff : 0x777777);
            entry.tween = null;
            this.drawEntry(entry, player);
          },
        });
      }
    }
  }

  destroy(): void {
    this.unsubscribeViewport();
    for (const entry of Object.values(this.entries)) {
      entry.tween?.stop();
      entry.container.destroy();
    }
  }

  /** DOM gear center below the P1 portrait, in CSS pixels. */
  get settingsAnchor(): { x: number; y: number } {
    const rect = battleSettingsRect(this.viewport.current);
    const ui = this.viewport.current.uiScale;
    return { x: rect.x / ui, y: rect.y / ui };
  }

  private hudScale(): number {
    const { width, safeArea, uiScale } = this.viewport.current;
    const available = (width - safeArea.left - safeArea.right) / uiScale;
    return uiScale * Math.min(1, (available - 110) / (CARD_WIDTH * 2));
  }

  private createEntry(id: PlayerId): HudEntry {
    const right = id === 'P2';
    const portraitX = right ? CARD_WIDTH - 36 : 36;
    const barX = right ? 8 : 84;
    const container = this.scene.add.container(0, 0).setScrollFactor(0).setDepth(950);
    const plate = this.scene.add.graphics();
    container.add(plate);
    // 头像框内衬底：从下往上渐变（底部队色 → 顶部深色，衬出头像层次；
    // 画在头像之下，头像透明边距透出渐变）
    const portraitFill = this.scene.add.graphics();
    portraitFill.fillGradientStyle(0x0d1520, 0x0d1520, playerColor(id), playerColor(id), 1);
    portraitFill.fillRoundedRect(portraitX - 28, -30, 56, 56, 6);
    container.add(portraitFill);
    const key = right ? ART.avatarP2 : ART.avatarP1;
    const avatar = this.scene.textures.exists(key)
      ? this.scene.add.image(portraitX, -2, key).setDisplaySize(50, 50) : null;
    if (avatar) container.add(avatar);
    if (this.scene.textures.exists(ART.portraitFrame)) {
      container.add(this.scene.add.image(portraitX, 0, ART.portraitFrame).setDisplaySize(78, 78));
    }
    const hpText = this.scene.add.text(barX + BAR_WIDTH / 2, -17, '', {
      fontFamily: 'monospace', fontSize: '13px', fontStyle: 'bold', color: '#ffffff',
      stroke: '#321815', strokeThickness: 3,
    }).setOrigin(0.5);
    container.add(hpText);
    return { container, plate, portraitFill, avatar, hpText, displayedHp: null,
      shownHp: GAME_CONFIG.player.maxHp, tween: null };
  }

  private reposition(): void {
    const { width, height, safeArea, uiScale, zoom } = this.viewport.current;
    const scale = this.hudScale();
    const y = safeArea.top + 44 * scale;
    const screenY = height / 2 + (y - height / 2) / zoom;
    const leftX = safeArea.left + 12 * uiScale;
    const rightX = width - safeArea.right - 12 * uiScale - CARD_WIDTH * scale;
    this.entries.P1.container.setPosition(width / 2 + (leftX - width / 2) / zoom, screenY).setScale(scale / zoom);
    this.entries.P2.container.setPosition(width / 2 + (rightX - width / 2) / zoom, screenY).setScale(scale / zoom);
  }

  private drawEntry(entry: HudEntry, player: PlayerState): void {
    const x = player.id === 'P2' ? 8 : 84;
    const g = entry.plate.clear();
    // Restore the original inset trough and bright steel edge around the HP bar itself.
    // The large team-name housing remains removed.
    g.fillStyle(0x27171b).fillRect(x, -29, BAR_WIDTH, 24);
    const segmentWidth = (BAR_WIDTH - 4) / player.maxHp;
    for (let i = 0; i < player.maxHp; i++) {
      const fill = Phaser.Math.Clamp(entry.shownHp - i, 0, 1);
      const sx = x + 2 + i * segmentWidth;
      g.fillStyle(0x512a2a).fillRect(sx, -27, segmentWidth - 2, 20);
      if (fill > 0) {
        const w = (segmentWidth - 2) * fill;
        g.fillStyle(player.isAlive ? 0xcc3836 : 0x65646a).fillRect(sx, -27, w, 20);
        g.fillStyle(0xff9470, 0.8).fillRect(sx, -27, w, 5);
        g.fillStyle(0x84242e).fillRect(sx, -11, w, 4);
      }
    }
    g.lineStyle(1, 0xf5d799).strokeRect(x, -29, BAR_WIDTH, 24);
    entry.hpText.setText(`${Math.max(0, Math.round(entry.shownHp))} / ${player.maxHp}`);
  }
}
