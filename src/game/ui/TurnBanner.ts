import Phaser from 'phaser';
import { playerColor, toCssColor } from '../config/Palette';
import type { ViewportService } from '../platform/ViewportService';
import type { PlayerId } from '../state/ids';

/** 屏幕手感常量（CSS px / ms，运行时 ×uiScale） */
const TURN_FONT_SIZE = 26;
const WINNER_FONT_SIZE = 34;
const PILL_HEIGHT = 52;
const PILL_PADDING_X = 28;
const TOP_MARGIN = 56;
const TURN_FADE_MS = 200;
const TURN_HOLD_MS = 1100;
const WINNER_FADE_MS = 450;

/**
 * 回合横幅 + 胜负画面（Phase 9：本地双人 Review Gate）。
 *
 * 热座对局的"轮到谁"必须对真人可见（此前只有 DebugOverlay）：
 * - showTurn：新回合 ACTION 开始时短暂展示「P1 · 第 N 回合」，
 *   玩家着色，淡入 → 停留 → 淡出，纯视觉不阻塞任何输入
 * - showGameOver：游戏结束时持久展示胜负（winnerId=null 为
 *   同归于尽平局），直到刷新页面重开
 *
 * 渲染层只读 GameState 派生数据（playerId / turnId / winnerId），
 * 不写任何状态；尺寸 / 字号经 uiScale（= DPR）换算，
 * 随 ViewportService 变化重定位（resize / 旋转 / DPR）。
 */
export class TurnBanner {
  private readonly scene: Phaser.Scene;
  private readonly viewport: ViewportService;
  private readonly container: Phaser.GameObjects.Container;
  private readonly bg: Phaser.GameObjects.Graphics;
  private readonly label: Phaser.GameObjects.Text;
  private turnTween: Phaser.Tweens.Tween | null = null;
  private winnerPulse: Phaser.Tweens.Tween | null = null;
  private winnerActive = false;
  private readonly unsubscribeViewport: () => void;

  /** 最近一次展示的横幅文本（fade 后保留 —— E2E 断言用） */
  private lastText = '';

  constructor(scene: Phaser.Scene, viewport: ViewportService) {
    this.scene = scene;
    this.viewport = viewport;

    this.bg = scene.add.graphics();
    this.label = scene.add
      .text(0, 0, '', {
        fontFamily: 'monospace',
        color: '#e8eef7',
      })
      .setOrigin(0.5);

    this.container = scene.add
      .container(0, 0, [this.bg, this.label])
      .setScrollFactor(0)
      .setDepth(960)
      .setAlpha(0)
      .setVisible(false);

    this.unsubscribeViewport = viewport.onChange(() => {
      if (this.winnerActive) {
        this.drawWinnerPill();
      }
      this.reposition();
    });
    this.reposition();
  }

  get visible(): boolean {
    return this.container.visible;
  }

  get text(): string {
    return this.label.text;
  }

  get lastBannerText(): string {
    return this.lastText;
  }

  /**
   * 新回合开始：短暂展示「P1 · 第 N 回合」（不阻塞输入）。
   * label（Phase 14 联机）：覆盖默认文本 —— 本地视角展示
   * YOUR TURN / OPPONENT'S TURN；离线不传 = 原行为不变。
   */
  showTurn(playerId: PlayerId, turnId: number, label?: string): void {
    if (this.winnerActive) {
      return;
    }
    const color = playerColor(playerId);
    this.label.setText(label ?? `${playerId} · 第 ${turnId} 回合`);
    this.label.setFontSize(TURN_FONT_SIZE * this.viewport.current.uiScale);
    this.label.setColor(toCssColor(color));
    this.drawPill(color, 0.85);
    this.playTurnFade();
  }

  /**
   * Phase 14 联机：轻量瞬时消息（COMMAND_REJECTED 提示 /
   * OPPONENT DISCONNECTED 等），同 showTurn 的淡入-停留-淡出节奏。
   */
  showMessage(text: string, accent: number): void {
    if (this.winnerActive) {
      return;
    }
    this.label.setText(text);
    this.label.setFontSize(TURN_FONT_SIZE * this.viewport.current.uiScale);
    this.label.setColor('#e8eef7');
    this.drawPill(accent, 0.85);
    this.playTurnFade();
  }

  /** 回合横幅的统一淡入 → 停留 → 淡出动画（showTurn / showMessage 共用） */
  private playTurnFade(): void {
    this.container.setVisible(true);
    this.turnTween?.stop();
    this.turnTween = this.scene.tweens.add({
      targets: this.container,
      alpha: { from: 0, to: 1 },
      duration: TURN_FADE_MS,
      yoyo: true,
      hold: TURN_HOLD_MS,
      ease: 'Sine.easeInOut',
      onYoyo: () => {
        this.lastText = this.label.text;
      },
      onComplete: () => {
        this.container.setVisible(false);
        this.container.setAlpha(0);
        this.turnTween = null;
      },
    });
    this.lastText = this.label.text;
  }

  /** 游戏结束：持久展示胜负（null = 同归于尽平局） */
  showGameOver(winnerId: PlayerId | null): void {
    this.turnTween?.stop();
    this.turnTween = null;
    this.winnerPulse?.stop();
    this.winnerPulse = null;
    this.winnerActive = true;

    const ui = this.viewport.current.uiScale;
    if (winnerId === null) {
      this.label.setText('平局 · 同归于尽');
      this.label.setColor('#ffd24a');
      this.drawPill(0xffd24a, 0.9);
    } else {
      this.label.setText(`${winnerId} 获胜！`);
      this.label.setColor(toCssColor(playerColor(winnerId)));
      this.drawPill(playerColor(winnerId), 0.9);
    }
    this.label.setFontSize(WINNER_FONT_SIZE * ui);
    this.reposition();

    this.container.setVisible(true);
    this.lastText = this.label.text;
    this.container.setAlpha(0);
    this.scene.tweens.add({
      targets: this.container,
      alpha: 1,
      duration: WINNER_FADE_MS,
      ease: 'Sine.easeOut',
    });
    // 胜负横幅轻微呼吸，区别于瞬时回合横幅
    this.winnerPulse = this.scene.tweens.add({
      targets: this.label,
      scale: { from: 1, to: 1.08 },
      duration: 900,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  destroy(): void {
    this.unsubscribeViewport();
    this.turnTween?.stop();
    this.winnerPulse?.stop();
    this.container.destroy();
  }

  // ---- 绘制与布局 --------------------------------------------------------

  /** 半透明药丸底（当前文本宽度自适应） */
  private drawPill(accent: number, fillAlpha: number): void {
    const ui = this.viewport.current.uiScale;
    const textWidth = this.label.width;
    const w = textWidth + PILL_PADDING_X * 2 * ui;
    const h = PILL_HEIGHT * ui;
    const radius = h / 2;

    this.bg.clear();
    this.bg.fillStyle(0x0d1420, fillAlpha);
    this.bg.fillRoundedRect(-w / 2, -h / 2, w, h, radius);
    this.bg.lineStyle(2 * ui, accent, 0.95);
    this.bg.strokeRoundedRect(-w / 2, -h / 2, w, h, radius);
  }

  /** 胜负横幅：文本可能变长，重画底 */
  private drawWinnerPill(): void {
    if (this.label.text.length === 0) {
      return;
    }
    const accent = this.label.text.includes('平局')
      ? 0xffd24a
      : this.label.text.startsWith('P1')
        ? playerColor('P1')
        : playerColor('P2');
    this.drawPill(accent, 0.9);
  }

  /** 顶部居中（Safe Area 内），随视口变化重算 */
  private reposition(): void {
    const { width, safeArea, uiScale } = this.viewport.current;
    const y = safeArea.top + TOP_MARGIN * uiScale + (PILL_HEIGHT * uiScale) / 2;
    this.container.setPosition(width / 2, y);
  }
}
