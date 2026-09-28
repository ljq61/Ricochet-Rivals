import Phaser from 'phaser';
import { GAME_CONFIG } from '../config/GameConfig';
import { PALETTE, playerColor } from '../config/Palette';
import type { PlayerId } from '../state/ids';

/**
 * 静态占位世界构建器（Phase 1/2）。
 * 地面、双方基地、出生点标记、中场与刻度。
 * 玩家本体由 Player 实体绘制；没有正式美术资源前，
 * 全部使用 Graphics 画清晰简洁的 placeholder。
 */

const ALPHA = {
  band: 0.025,
  midfield: 0.15,
  zoneLine: 0.35,
  basePlatform: 0.55,
} as const;

export class WorldBuilder {
  constructor(private readonly scene: Phaser.Scene) {}

  build(): void {
    this.buildBands();
    this.buildGround();
    this.buildMidfield();
    this.buildDistanceTicks();
    this.buildBase('P1');
    this.buildBase('P2');
  }

  /** 500px 间隔的淡色竖向刻度线，给超宽地图提供拖动反馈 */
  private buildDistanceTicks(): void {
    const g = this.scene.add.graphics();
    const top = GAME_CONFIG.world.groundTopY;
    for (let x = 500; x < GAME_CONFIG.world.width; x += 500) {
      if (x === GAME_CONFIG.world.width / 2) {
        continue; // 中场线单独画
      }
      g.lineStyle(2, PALETTE.zoneLine, ALPHA.zoneLine * 0.6);
      g.lineBetween(x, top - 26, x, top);
      this.addTickLabel(x, `${x}`);
    }
  }

  private buildBands(): void {
    const g = this.scene.add.graphics();
    const { width, height } = GAME_CONFIG.world;
    g.fillStyle(PALETTE.band, ALPHA.band);
    // 每 250px 交替淡色竖带，让横向拖动有速度感
    for (let x = 0; x < width; x += 500) {
      g.fillRect(x, 0, 250, height);
    }
  }

  private buildGround(): void {
    const g = this.scene.add.graphics();
    const { width, height, groundTopY } = GAME_CONFIG.world;
    g.fillStyle(PALETTE.groundFill, 1);
    g.fillRect(0, groundTopY, width, height - groundTopY);
    g.fillStyle(PALETTE.groundTop, 1);
    g.fillRect(0, groundTopY, width, 6);
  }

  private buildMidfield(): void {
    const g = this.scene.add.graphics();
    const x = GAME_CONFIG.world.width / 2;
    const top = GAME_CONFIG.world.groundTopY;
    g.lineStyle(2, PALETTE.midfield, ALPHA.midfield);
    g.lineBetween(x, 0, x, top);
  }

  /** 基地占位：阵地平台 + 移动边界虚线 + 出生点旗杆 */
  private buildBase(playerId: PlayerId): void {
    const g = this.scene.add.graphics();
    const isLeft = playerId === 'P1';
    const bounds = isLeft
      ? GAME_CONFIG.player.leftBounds
      : GAME_CONFIG.player.rightBounds;
    const color = playerColor(playerId);
    const top = GAME_CONFIG.world.groundTopY;

    // 阵地平台
    g.fillStyle(color, ALPHA.basePlatform);
    g.fillRect(bounds.minX, top - 10, bounds.maxX - bounds.minX, 10);
    g.lineStyle(2, color, 0.9);
    g.strokeRect(bounds.minX, top - 10, bounds.maxX - bounds.minX, 10);

    // 移动边界虚线（MovementSystem 边界的可视化提示）
    this.dashedVerticalLine(g, bounds.minX, top - 320, top, color, 0.35);
    this.dashedVerticalLine(g, bounds.maxX, top - 320, top, color, 0.35);

    // 出生点旗杆
    const spawnX = GAME_CONFIG.player.spawn[playerId];
    g.lineStyle(3, 0xcccccc, 0.8);
    g.lineBetween(spawnX, top - 10, spawnX, top - 130);
    g.fillStyle(color, 0.95);
    g.fillTriangle(
      spawnX,
      top - 130,
      spawnX + 42,
      top - 118,
      spawnX,
      top - 106
    );
  }

  private addTickLabel(x: number, label: string): void {
    this.scene.add
      .text(x, GAME_CONFIG.world.groundTopY + 34, label, {
        fontFamily: 'monospace',
        fontSize: '18px',
        color: PALETTE.tickLabel,
      })
      .setOrigin(0.5)
      .setAlpha(0.55);
  }

  private dashedVerticalLine(
    g: Phaser.GameObjects.Graphics,
    x: number,
    fromY: number,
    toY: number,
    color: number,
    alpha: number
  ): void {
    const dash = 14;
    const gap = 10;
    g.lineStyle(2, color, alpha);
    for (let y = fromY; y < toY; y += dash + gap) {
      g.lineBetween(x, y, x, Math.min(y + dash, toY));
    }
  }
}
