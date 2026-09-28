import Phaser from 'phaser';
import { PALETTE, playerColor, toCssColor } from '../config/Palette';
import type { PlayerState } from '../state/PlayerState';

/**
 * 玩家视觉实体（渲染层）。
 *
 * - 不持有任何规则逻辑；位置完全由 PlayerState 驱动（每帧同步）
 * - 占位走动动画：移动时上下轻微起伏
 * - 朝向随移动方向翻转，初始朝向战场中央
 *
 * State 不持有 Phaser 对象；该实体通过引用的 PlayerState 数据渲染，
 * 符合「渲染层读取 State」的分层规则。
 */
export class Player {
  private readonly scene: Phaser.Scene;
  private readonly container: Phaser.GameObjects.Container;
  private readonly barrel: Phaser.GameObjects.Graphics;

  private facing: 1 | -1;
  private lastX: number;
  private bobPhase = 0;
  private hitTween: Phaser.Tweens.Tween | null = null;

  constructor(scene: Phaser.Scene, playerState: PlayerState) {
    this.scene = scene;
    this.facing = playerState.side === 'left' ? 1 : -1;
    this.lastX = playerState.x;

    const color = playerColor(playerState.id);

    // 身体 + 头（静态，绘制一次）
    const body = scene.add.graphics();
    body.fillStyle(color, 1);
    body.fillRect(-14, -52, 28, 52);
    body.fillStyle(PALETTE.head, 1);
    body.fillCircle(0, -64, 12);

    // 炮管（随朝向重绘）
    this.barrel = scene.add.graphics();

    const label = scene.add
      .text(0, -100, playerState.id, {
        fontFamily: 'monospace',
        fontSize: '22px',
        color: toCssColor(color),
      })
      .setOrigin(0.5);

    this.container = scene.add.container(playerState.x, playerState.y, [
      body,
      this.barrel,
      label,
    ]);

    this.redrawBarrel();
  }

  /** 每帧从 PlayerState 同步视觉（含占位走动动画） */
  update(playerState: PlayerState, deltaMs: number): void {
    const deltaX = playerState.x - this.lastX;
    this.lastX = playerState.x;

    const moving = Math.abs(deltaX) > 0.001;
    if (moving) {
      this.facing = deltaX > 0 ? 1 : -1;
      this.redrawBarrel();
    }

    let bob = 0;
    if (moving) {
      this.bobPhase += (deltaMs / 1000) * 24;
      bob = Math.sin(this.bobPhase) * 3;
    } else {
      this.bobPhase = 0;
    }

    this.container.setPosition(playerState.x, playerState.y + bob);
  }

  /**
   * 受击反馈（Phase 7）：整体闪烁数次。
   * 纯视觉（渲染层自行管理 Tween），不读取 / 不修改 PlayerState；
   * 重复触发时重启，避免动画叠加。
   */
  playHitReaction(): void {
    this.hitTween?.stop();
    this.container.setAlpha(1);
    this.hitTween = this.scene.tweens.add({
      targets: this.container,
      alpha: { from: 1, to: 0.15 },
      duration: 110,
      yoyo: true,
      repeat: 3,
      onComplete: () => {
        this.container.setAlpha(1);
        this.hitTween = null;
      },
    });
  }

  private redrawBarrel(): void {
    this.barrel.clear();
    this.barrel.lineStyle(6, PALETTE.barrel, 1);
    this.barrel.lineBetween(0, -40, this.facing * 30, -40);
  }
}
