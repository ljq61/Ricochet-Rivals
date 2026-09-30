import Phaser from 'phaser';
import { GAME_CONFIG } from '../config/GameConfig';
import { playerColor } from '../config/Palette';
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
  name: Phaser.GameObjects.Text;
  displayedHp: number | null;
  shownHp: number;
  tween: Phaser.Tweens.Tween | null;
}

/** Concept HUD: large framed portraits, team nameplates and animated red HP segments. */
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
    container.add(this.scene.add.text(portraitX, 29, id, {
      fontFamily: 'monospace', fontSize: '11px', fontStyle: 'bold', color: '#fff0c6',
      stroke: '#121c27', strokeThickness: 2,
    }).setOrigin(0.5));
    const name = this.scene.add.text(barX + 8, -27, right ? 'RED CREW' : 'BLUE CREW', {
      fontFamily: 'monospace', fontSize: '12px', fontStyle: 'bold', color: '#fff1cd',
      stroke: '#17202c', strokeThickness: 2,
    });
    const hpText = this.scene.add.text(barX + BAR_WIDTH / 2, 5, '', {
      fontFamily: 'monospace', fontSize: '13px', fontStyle: 'bold', color: '#ffffff',
      stroke: '#321815', strokeThickness: 3,
    }).setOrigin(0.5);
    container.add([name, hpText]);
    return { container, plate, portraitFill, avatar, hpText, name, displayedHp: null,
      shownHp: GAME_CONFIG.player.maxHp, tween: null };
  }

  private reposition(): void {
    const { width, height, safeArea, uiScale, zoom } = this.viewport.current;
    const available = (width - safeArea.left - safeArea.right) / uiScale;
    const scale = uiScale * Math.min(1, (available - 110) / (CARD_WIDTH * 2));
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
    const color = playerColor(player.id);
    // Raised steel housing, inset dark trough, warm top edge and team enamel nameplate.
    g.fillStyle(0x101720).fillRoundedRect(x - 5, -31, BAR_WIDTH + 10, 60, 4);
    g.lineStyle(2, 0x9b8864).strokeRoundedRect(x - 5, -31, BAR_WIDTH + 10, 60, 4);
    g.fillStyle(color).fillRect(x, -27, BAR_WIDTH, 16);
    g.fillStyle(0x27171b).fillRect(x, -6, BAR_WIDTH, 24);
    const segmentWidth = (BAR_WIDTH - 4) / player.maxHp;
    for (let i = 0; i < player.maxHp; i++) {
      const fill = Phaser.Math.Clamp(entry.shownHp - i, 0, 1);
      const sx = x + 2 + i * segmentWidth;
      g.fillStyle(0x512a2a).fillRect(sx, -4, segmentWidth - 2, 20);
      if (fill > 0) {
        const w = (segmentWidth - 2) * fill;
        g.fillStyle(player.isAlive ? 0xcc3836 : 0x65646a).fillRect(sx, -4, w, 20);
        g.fillStyle(0xff9470, 0.8).fillRect(sx, -4, w, 5);
        g.fillStyle(0x84242e).fillRect(sx, 12, w, 4);
      }
    }
    g.lineStyle(1, 0xf5d799).strokeRect(x, -6, BAR_WIDTH, 24);
    for (const sx of [x, x + BAR_WIDTH - 2]) {
      g.fillStyle(0xc7bd9d).fillCircle(sx, 23, 2);
    }
    entry.hpText.setText(`${Math.max(0, Math.round(entry.shownHp))} / ${player.maxHp}`);
    entry.name.setText(player.isAlive ? (player.id === 'P1' ? 'BLUE CREW' : 'RED CREW') : 'K.O.');
  }
}
