import Phaser from 'phaser';
import { GAME_CONFIG } from '../config/GameConfig';
import { PALETTE, playerColor } from '../config/Palette';
import { ART } from '../config/ArtAssets';
import type { ViewportService } from '../platform/ViewportService';
import type { PlayerState } from '../state/PlayerState';
import type { PlayerId } from '../state/ids';

/**
 * 真机反馈轮（Phase 17）：HP HUD 按 concept_UI 玩家卡语言重做 ——
 * 铆钉深色钢板 + 队色角签（P1/P2）+ 头像（生成素材，缺失回退无像）+
 * 10 段血格（HP=10 天然分段）+ n/10 数值。
 * 旧实现（连续填充条）见 git 历史。
 */

/** 屏幕手感常量（CSS px，运行时 ×uiScale） */
const AVATAR_SIZE = 30;
const AVATAR_X = 0;
const SEG_X = 42;
const SEG_WIDTH = 13;
const SEG_GAP = 3;
const SEG_HEIGHT = 14;
const HP_TEXT_X = SEG_X + GAME_CONFIG.player.maxHp * (SEG_WIDTH + SEG_GAP) - SEG_GAP + 10;
/** 板内边距（左 -8 / 上下 ±20）与总宽 */
const PLATE_PAD_X = 8;
const PLATE_WIDTH = HP_TEXT_X + 44;
const HP_TWEEN_MS = 350;

interface HudEntry {
  container: Phaser.GameObjects.Container;
  /** 头像（缺素材 = null，框内回退队色底） */
  avatar: Phaser.GameObjects.Image | null;
  /** 板 + 框 + 角签 + 血格（全 Graphics） */
  plate: Phaser.GameObjects.Graphics;
  tag: Phaser.GameObjects.Text;
  hpText: Phaser.GameObjects.Text;
  /** 上次展示的 HP（变化检测 → 动画）；null = 尚未初始化 */
  displayedHp: number | null;
  /** 动画驱动的当前展示值 */
  shownHp: number;
  tween: Phaser.Tweens.Tween | null;
}

/**
 * HP HUD（Phase 7 反馈；真机反馈轮 concept_UI 化）：
 * - 左上 P1 / 右上 P2（Safe Area 内边距），resize / 旋转 / DPR 变化自动重排
 * - 每帧从 PlayerState 刷新（State 是唯一数据源），
 *   HP 变化时播放过渡动画（血格段数 Tween + 数值闪红）
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
    const container = this.scene.add.container(0, 0).setScrollFactor(0).setDepth(950);
    const avatarKey = playerId === 'P1' ? ART.avatarP1 : ART.avatarP2;
    const avatar =
      this.scene.textures.exists(avatarKey)
        ? this.scene.add.image(0, 0, avatarKey)
        : null;
    const plate = this.scene.add.graphics();
    const tag = this.scene.add
      .text(0, 0, playerId, {
        fontFamily: 'monospace',
        color: '#fff4db',
      })
      .setOrigin(0.5);
    const hpText = this.scene.add
      .text(0, 0, '', {
        fontFamily: 'monospace',
        color: '#e8eef7',
      })
      .setOrigin(0, 0.5);
    container.add([plate, tag, hpText]);
    if (avatar) {
      container.add(avatar);
    }

    return {
      container,
      avatar,
      plate,
      tag,
      hpText,
      displayedHp: null,
      shownHp: GAME_CONFIG.player.maxHp,
      tween: null,
    };
  }

  private reposition(): void {
    const { width, safeArea, uiScale } = this.viewport.current;
    const halfHeight = 20 * uiScale;
    const y = safeArea.top + 24 * uiScale + halfHeight;
    const totalWidth = (PLATE_WIDTH + PLATE_PAD_X) * uiScale;
    this.entries.P1.container.setPosition(safeArea.left + 16 * uiScale, y);
    this.entries.P2.container.setPosition(
      width - safeArea.right - 16 * uiScale - totalWidth,
      y
    );
    for (const entry of Object.values(this.entries)) {
      entry.tag.setFontSize(11 * uiScale);
      entry.hpText.setFontSize(14 * uiScale);
      entry.avatar?.setDisplaySize(AVATAR_SIZE * uiScale, AVATAR_SIZE * uiScale);
      entry.avatar?.setPosition(
        (AVATAR_X + AVATAR_SIZE / 2) * uiScale,
        0
      );
    }
  }

  // ---- 绘制与动画 --------------------------------------------------------

  private drawEntry(entry: HudEntry, player: PlayerState): void {
    const ui = this.viewport.current.uiScale;
    const color = playerColor(player.id);
    const maxHp = player.maxHp;
    const segStep = (SEG_WIDTH + SEG_GAP) * ui;
    const segW = SEG_WIDTH * ui;
    const segH = SEG_HEIGHT * ui;

    entry.plate.clear();
    // 铆钉深色钢板（concept_UI 玩家卡语言）
    const plateW = PLATE_WIDTH * ui;
    const plateH = 40 * ui;
    const radius = 4 * ui;
    entry.plate.fillStyle(0x080d12, 0.94);
    entry.plate.fillRoundedRect(-PLATE_PAD_X * ui, -plateH / 2, plateW, plateH, radius);
    entry.plate.lineStyle(2 * ui, 0xb4b6ad, 0.85);
    entry.plate.strokeRoundedRect(-PLATE_PAD_X * ui, -plateH / 2, plateW, plateH, radius);
    entry.plate.lineStyle(2 * ui, 0xffe19a, 0.5);
    entry.plate.lineBetween(
      -PLATE_PAD_X * ui + 8 * ui,
      -plateH / 2 + 5 * ui,
      plateW - PLATE_PAD_X * ui - 8 * ui,
      -plateH / 2 + 5 * ui
    );
    entry.plate.fillStyle(0x151c22, 1);
    for (const x of [-1, 1]) {
      for (const y of [-1, 1]) {
        entry.plate.fillCircle(
          -PLATE_PAD_X * ui + x * (plateW / 2 - 8 * ui),
          y * (plateH / 2 - 8 * ui),
          2 * ui
        );
      }
    }
    // 队色角签（concept_UI：左上角小色块标队伍）
    entry.plate.fillStyle(color, 1);
    entry.plate.fillRoundedRect(
      -PLATE_PAD_X * ui,
      -plateH / 2,
      18 * ui,
      14 * ui,
      2 * ui
    );

    // 头像框（缺素材 = 队色底占位）
    const av = AVATAR_SIZE * ui;
    const avX = AVATAR_X * ui;
    entry.plate.fillStyle(0x0d1420, 1);
    entry.plate.fillRoundedRect(avX - 2 * ui, -av / 2 - 2 * ui, av + 4 * ui, av + 4 * ui, 3 * ui);
    entry.plate.lineStyle(2 * ui, color, 0.9);
    entry.plate.strokeRoundedRect(avX - 2 * ui, -av / 2 - 2 * ui, av + 4 * ui, av + 4 * ui, 3 * ui);
    if (entry.avatar === null) {
      entry.plate.fillStyle(color, 0.5);
      entry.plate.fillRoundedRect(avX, -av / 2, av, av, 3 * ui);
    }
    entry.tag.setPosition(avX + av / 2, plateH / 2 - 6 * ui);

    // 10 段血格：满格 = 队色（存活）/ 灰（阵亡），当前段随 Tween 部分填充
    const segY = -segH / 2;
    for (let i = 0; i < maxHp; i++) {
      const sx = SEG_X * ui + i * segStep;
      entry.plate.fillStyle(0x0d1420, 0.9);
      entry.plate.fillRoundedRect(sx, segY, segW, segH, 2 * ui);
      const remain = entry.shownHp - i;
      if (remain <= 0) {
        continue;
      }
      const fillW = Math.min(1, remain) * segW;
      entry.plate.fillStyle(player.isAlive ? color : PALETTE.zoneLine, 0.95);
      entry.plate.fillRoundedRect(sx, segY, fillW, segH, 2 * ui);
    }
    entry.plate.lineStyle(1 * ui, 0x56698a, 0.7);
    for (let i = 0; i < maxHp; i++) {
      const sx = SEG_X * ui + i * segStep;
      entry.plate.strokeRoundedRect(sx, segY, segW, segH, 2 * ui);
    }

    entry.hpText.setX(HP_TEXT_X * ui);
    entry.hpText.setText(
      `${Math.max(0, Math.round(entry.shownHp))}/${player.maxHp}`
    );
    entry.hpText.setColor(player.isAlive ? '#e8eef7' : '#63769b');
  }

  /** HP 变化动画：血格段数收缩 + 数值闪红 */
  private animateTo(
    entry: HudEntry,
    player: PlayerState,
    previousHp: number
  ): void {
    entry.tween?.stop();

    const decreasing = player.hp < previousHp;
    if (decreasing) {
      // 受击闪红一拍（血格收缩由 Tween 驱动）
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
