import Phaser from 'phaser';
import type { DamageResult } from '../state/DamageResult';
import type { PlayerState } from '../state/PlayerState';
import type { PlayerId } from '../state/ids';
import type { ViewportService } from '../platform/ViewportService';

/** 屏幕手感常量（CSS px，运行时 ×uiScale） */
const FONT_SIZE = 30;
const RISE_DISTANCE = 70;
const LIFETIME_MS = 950;
const OVER_HEAD_OFFSET_Y = -130;

/**
 * 伤害数字（Phase 7 反馈）：受击玩家头顶浮出 "-N"，
 * 上升并淡出（世界坐标锚定 —— IMPACT 相机停留时正好可见）。
 *
 * 渲染层只读 DamageResult + PlayerState；
 * 每个数字自带 Tween 自清理，无持久资源。
 * 真机修复：字号 / 位移经 uiScale（= DPR）换算（游戏坐标 = 物理像素）。
 */
export class DamageNumbers {
  constructor(
    private readonly scene: Phaser.Scene,
    private readonly viewport: ViewportService
  ) {}

  /** 播放一次爆炸的受击数字（damage > 0 的玩家各一条） */
  show(result: DamageResult, players: Record<PlayerId, PlayerState>): void {
    const ui = this.viewport.current.uiScale;
    for (const entry of result.players) {
      if (entry.damage <= 0) {
        continue;
      }
      const player = players[entry.playerId];
      const text = this.scene.add
        .text(
          player.x,
          player.y + OVER_HEAD_OFFSET_Y * ui,
          `-${entry.damage}`,
          {
            fontFamily: 'monospace',
            fontSize: `${FONT_SIZE * ui}px`,
            color: entry.damage >= 2 ? '#ff5063' : '#ffd24a',
            stroke: '#0d1420',
            strokeThickness: 5 * ui,
          }
        )
        .setOrigin(0.5)
        .setDepth(880);

      this.scene.tweens.add({
        targets: text,
        y: text.y - RISE_DISTANCE * ui,
        alpha: 0,
        duration: LIFETIME_MS,
        ease: 'Sine.easeOut',
        onComplete: () => text.destroy(),
      });
    }
  }
}
