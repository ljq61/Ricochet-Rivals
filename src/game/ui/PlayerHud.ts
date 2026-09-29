import Phaser from 'phaser';
import { GAME_CONFIG } from '../config/GameConfig';
import { PALETTE, playerColor, toCssColor } from '../config/Palette';
import type { ViewportService } from '../platform/ViewportService';
import type { PlayerState } from '../state/PlayerState';
import type { PlayerId } from '../state/ids';

/** 屏幕手感常量（CSS px，运行时 ×uiScale） */
const BAR_WIDTH = 150;
const BAR_HEIGHT = 16;
const LABEL_X = 0;
const BAR_X = 34;
const HP_TEXT_X = BAR_X + BAR_WIDTH + 10;
const HUD_HEIGHT = 20;
const EDGE_MARGIN = 20;
const HP_TWEEN_MS = 350;

interface HudEntry {
  container: Phaser.GameObjects.Container;
  label: Phaser.GameObjects.Text;
  bar: Phaser.GameObjects.Graphics;
  hpText: Phaser.GameObjects.Text;
  /** 上次展示的 HP（变化检测 → 动画）；null = 尚未初始化 */
  displayedHp: number | null;
  /** 动画驱动的当前展示值 */
  shownHp: number;
  tween: Phaser.Tweens.Tween | null;
}

/**
 * HP HUD（Phase 7 反馈）：双方血条 + 数值。
 * - 左上 P1 / 右上 P2（Safe Area 内边距），resize / 旋转 / DPR 变化自动重排
 * - 每帧从 PlayerState 刷新（State 是唯一数据源），
 *   HP 变化时播放过渡动画（血条宽度 Tween + 数值闪红）
 * - 阵亡后置灰；HP 只由 DamageSystem 修改，本类只读
 * - 真机修复：尺寸 / 字号经 uiScale（= DPR）换算（游戏坐标 = 物理像素）
 */
export class PlayerHud {
  private readonly scene: Phaser.Scene;
  private readonly viewport: ViewportService;
  private readonly entries: Record<PlayerId, HudEntry>;
  private readonly unsubscribeViewport: () => void;

  constructor(scene: Phaser.Scene, viewport: ViewportService) {
    this.scene = scene;
    this.viewport = viewport;

    this.entries = {
      P1: this.createEntry('P1'),
      P2: this.createEntry('P2'),
    };

    this.unsubscribeViewport = viewport.onChange(() => this.reposition());
    this.reposition();
  }

  /** 每帧刷新：HP 变化时触发动画（首次直接就位） */
  refresh(players: Record<PlayerId, PlayerState>): void {
    for (const [playerId, entry] of Object.entries(this.entries) as [
      PlayerId,
      HudEntry,
    ][]) {
      const player = players[playerId];
      if (entry.displayedHp === player.hp) {
        continue;
      }
      const previous = entry.displayedHp;
      entry.displayedHp = player.hp;
      if (previous === null) {
        // 首次刷新：直接就位，不播动画
        entry.shownHp = player.hp;
        this.drawEntry(entry, player);
        continue;
      }
      this.animateTo(entry, player, previous);
    }
  }

  destroy(): void {
    this.unsubscribeViewport();
    this.entries.P1.container.destroy();
    this.entries.P2.container.destroy();
  }

  // ---- 创建与布局 --------------------------------------------------------

  private createEntry(playerId: PlayerId): HudEntry {
    const color = playerColor(playerId);
    const container = this.scene.add.container(0, 0).setScrollFactor(0).setDepth(950);

    const label = this.scene.add
      .text(LABEL_X, 0, playerId, {
        fontFamily: 'monospace',
        color: toCssColor(color),
      })
      .setOrigin(0, 0.5);

    const bar = this.scene.add.graphics();

    const hpText = this.scene.add
      .text(HP_TEXT_X, 0, '', {
        fontFamily: 'monospace',
        color: '#e8eef7',
      })
      .setOrigin(0, 0.5);

    container.add([bar, label, hpText]);

    return {
      container,
      label,
      bar,
      hpText,
      displayedHp: null,
      shownHp: GAME_CONFIG.player.maxHp,
      tween: null,
    };
  }

  private reposition(): void {
    const { width, safeArea, uiScale } = this.viewport.current;
    const y = safeArea.top + EDGE_MARGIN * uiScale + (HUD_HEIGHT * uiScale) / 2;
    // P1 左上；P2 右上（整体宽度 = HP_TEXT_X + 文本宽度估算）
    const totalWidth = (HP_TEXT_X + 52) * uiScale;
    this.entries.P1.container.setPosition(safeArea.left + EDGE_MARGIN * uiScale, y);
    this.entries.P2.container.setPosition(
      width - safeArea.right - EDGE_MARGIN * uiScale - totalWidth,
      y
    );
    // 字号跟随 uiScale（DPR 变化时同步）
    for (const entry of Object.values(this.entries)) {
      entry.label.setFontSize(18 * uiScale);
      entry.hpText.setFontSize(16 * uiScale);
    }
  }

  // ---- 绘制与动画 --------------------------------------------------------

  private drawEntry(entry: HudEntry, player: PlayerState): void {
    const ui = this.viewport.current.uiScale;
    const color = playerColor(player.id);
    const barWidth = BAR_WIDTH * ui;
    const barHeight = BAR_HEIGHT * ui;
    const barX = BAR_X * ui;
    const radius = 5 * ui;
    const ratio =
      player.maxHp > 0 ? Math.max(0, entry.shownHp) / player.maxHp : 0;

    entry.bar.clear();
    entry.bar.fillStyle(0x151c22, 0.94);
    entry.bar.fillRoundedRect(-8 * ui, -20 * ui, (HP_TEXT_X + 64) * ui, 40 * ui, 3 * ui);
    entry.bar.lineStyle(2 * ui, 0xb4b6ad, 0.8);
    entry.bar.strokeRoundedRect(-8 * ui, -20 * ui, (HP_TEXT_X + 64) * ui, 40 * ui, 3 * ui);
    entry.bar.fillStyle(0x0d1420, 0.8);
    entry.bar.fillRoundedRect(barX, -barHeight / 2, barWidth, barHeight, radius);
    if (ratio > 0) {
      entry.bar.fillStyle(player.isAlive ? color : PALETTE.zoneLine, 0.95);
      entry.bar.fillRoundedRect(
        barX,
        -barHeight / 2,
        Math.max(barHeight, barWidth * ratio),
        barHeight,
        radius
      );
    }
    entry.bar.lineStyle(1 * ui, 0x56698a, 0.8);
    entry.bar.strokeRoundedRect(barX, -barHeight / 2, barWidth, barHeight, radius);

    entry.hpText.setX((HP_TEXT_X) * ui);
    entry.hpText.setText(
      `${Math.max(0, Math.round(entry.shownHp))}/${player.maxHp}`
    );
    entry.hpText.setColor(player.isAlive ? '#e8eef7' : '#63769b');
  }

  /** HP 变化动画：血条宽度收缩 + 数值闪红 */
  private animateTo(
    entry: HudEntry,
    player: PlayerState,
    previousHp: number
  ): void {
    entry.tween?.stop();

    const decreasing = player.hp < previousHp;
    if (decreasing) {
      // 受击闪红一拍（血条本体收缩由 Tween 驱动）
      entry.hpText.setColor('#ff5063');
      entry.hpText.setScale(1.25);
      this.scene.tweens.add({
        targets: entry.hpText,
        scale: 1,
        duration: HP_TWEEN_MS,
        ease: 'Sine.easeOut',
      });
    }

    const proxy = { hp: entry.shownHp };
    entry.tween = this.scene.tweens.add({
      targets: proxy,
      hp: player.hp,
      duration: HP_TWEEN_MS,
      ease: 'Sine.easeOut',
      onUpdate: () => {
        entry.shownHp = proxy.hp;
        this.drawEntry(entry, player);
      },
      onComplete: () => {
        entry.shownHp = player.hp;
        this.drawEntry(entry, player);
        entry.tween = null;
      },
    });
  }
}
