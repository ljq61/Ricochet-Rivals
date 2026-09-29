import Phaser from 'phaser';
import { GAME_CONFIG } from '../config/GameConfig';
import { PALETTE, playerColor } from '../config/Palette';
import type { PlayerId } from '../state/ids';
import { ART } from '../config/ArtAssets';

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

/**
 * 背景每片至少放大到约 1.67 倍世界高度：底边仍贴地，顶部额外留出
 * 720 世界像素给炮弹上升段。按当前 5000px 世界宽度会铺两片，
 * 且始终保持原图宽高比。
 */
const HARBOR_BACKGROUND_MIN_HEIGHT = 1800;

export class WorldBuilder {
  constructor(private readonly scene: Phaser.Scene) {}

  build(): void {
    if (this.scene.textures.exists(ART.harbor)) {
      this.buildHarbor();
      return;
    }
    this.buildBands();
    this.buildGround();
    this.buildMidfield();
    this.buildDistanceTicks();
    this.buildBase('P1');
    this.buildBase('P2');
  }

  /**
   * 等比放大的相邻镜像背景，底边对齐世界底部，避免炮弹跟随到世界
   * 顶部以上时露出空画布。当前 5000px 世界宽度只需要两片。
   */
  private buildHarbor(): void {
    const { width, height, groundTopY: top } = GAME_CONFIG.world;
    const source = this.scene.textures.get(ART.harbor).getSourceImage();
    const backgroundHeight = Math.max(
      HARBOR_BACKGROUND_MIN_HEIGHT,
      (width / 2) * source.height / source.width,
    );
    const plateWidth = backgroundHeight * source.width / source.height;
    const plateCount = Math.ceil(width / plateWidth);
    for (let i = 0; i < plateCount; i++) {
      this.scene.add.image(i * plateWidth, height, ART.harbor)
        .setOrigin(0, 1)
        .setDisplaySize(plateWidth, backgroundHeight)
        .setFlipX(i % 2 === 1)
        .setDepth(-100);
    }
    const g = this.scene.add.graphics().setDepth(-10);
    g.fillStyle(0x151c22);
    g.fillRect(0, top, width, height - top);
    for (let x = 0; x < width; x += 120) {
      g.fillStyle(0x38434b);
      g.fillRect(x + 3, top + 14, 114, 34);
      g.lineStyle(3, 0x0a1119);
      g.strokeRect(x + 3, top + 14, 114, 34);
      g.lineStyle(8, 0x53616b);
      g.lineBetween(x + 10, top + 53, x + 105, height);
      g.fillStyle(0xd5b879);
      g.fillCircle(x + 12, top + 24, 3);
      g.fillCircle(x + 105, top + 24, 3);
    }
    g.fillStyle(0xb49a65);
    g.fillRect(0, top, width, 10);
    g.fillStyle(0xffdfa0);
    g.fillRect(0, top, width, 3);
    for (const id of ['P1', 'P2'] as const) {
      const left = id === 'P1';
      const bounds = left ? GAME_CONFIG.player.leftBounds : GAME_CONFIG.player.rightBounds;
      const color = playerColor(id);
      const flagX = left ? bounds.minX + 40 : bounds.maxX - 40;
      // 真机反馈轮（Phase 17）：concept01 §05 基地（底部平整甲板=走线，
      // 双方独立成体 —— 中间天然断开为开阔码头）；素材缺失回退塔楼+旗杆占位。
      // 甲板锚点 per-side —— 宁沉勿浮：素材甲板层实测不在画布底（蓝 ~92% 高），
      // 锚点压到甲板层全部没入地面 Graphics 以下 → 木排末端切面不可见，
      // 塔楼轮廓自然接地（浮起 = 甲板悬空 + 直切边穿帮）
      const baseKey = left ? ART.baseP1 : ART.baseP2;
      const baseOriginY = 0.9;
      if (this.scene.textures.exists(baseKey)) {
        this.scene.add.image(left ? 380 : width - 380, top, baseKey)
          .setDisplaySize(760, 760).setOrigin(0.5, baseOriginY).setDepth(-20);
      } else if (this.scene.textures.exists(ART.tower)) {
        this.scene.add.image(left ? 140 : width - 140, top, ART.tower)
          .setDisplaySize(520, 520).setOrigin(0.5, 0.966)
          .setFlipX(!left).setDepth(-20);
      } else {
        g.lineStyle(5, 0x151c22);
        g.lineBetween(flagX, top, flagX, top - 220);
        g.fillStyle(color);
        g.fillRect(flagX, top - 220, 76, 48);
        g.lineStyle(3, 0xffdfa0);
        g.strokeRect(flagX, top - 220, 76, 48);
      }
      // 走线高亮（角色实际站立的横条）+ 移动边界 + 阵营标识 —— 功能层保留
      g.fillStyle(color);
      g.fillRect(bounds.minX, top + 5, bounds.maxX - bounds.minX, 5);
      g.lineStyle(3, color, 0.8);
      for (const x of [bounds.minX, bounds.maxX]) {
        g.lineBetween(x, top - 25, x, top);
      }
      this.scene.add.text(left ? bounds.minX + 44 : bounds.maxX - 44, top - 40, id, {
        fontFamily: 'monospace', fontSize: '24px', fontStyle: 'bold', color: '#ffffff',
        stroke: '#151c22', strokeThickness: 4,
      }).setOrigin(0.5).setDepth(-9);
    }
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
