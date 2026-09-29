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
 * 且始终保持原图宽高比。最小高度常量在 GameConfig.world
 * （与相机垂直 clamp 上界同源）。
 */

/**
 * 基地甲板几何（世界坐标）：阵地 bounds 居中 + 两侧外伸。
 * WorldBuilder 铺图与 BaseDamageEffects 烟/火发射点同源取此函数。
 */
export function baseDockGeometry(id: PlayerId): { center: number; dockWidth: number } {
  const bounds = id === 'P1'
    ? GAME_CONFIG.player.leftBounds
    : GAME_CONFIG.player.rightBounds;
  return {
    center: (bounds.minX + bounds.maxX) / 2,
    dockWidth: bounds.maxX - bounds.minX + GAME_CONFIG.world.platformOverhang * 2,
  };
}

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
    // 相机顶界 clamp（followClampedCenterY）后正常不可达；
    // 留作放宽 clamp 时的兜底天空（不露空画布）。
    this.scene.add.rectangle(width / 2, -4000, width, 8000, 0x67adee).setDepth(-110);
    const source = this.scene.textures.get(ART.harbor).getSourceImage();
    const backgroundHeight = Math.max(
      GAME_CONFIG.world.backgroundMinHeight,
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
    // Independent docks: leave the harbor open between the two bases.
    for (const id of ['P1', 'P2'] as const) {
      const left = id === 'P1';
      const { center, dockWidth } = baseDockGeometry(id);
      const baseKey = left ? ART.baseP1 : ART.baseP2;
      if (this.scene.textures.exists(baseKey)) {
        // Measured source deck heights differ: blue 88%, red 76.5%.
        this.scene.add.image(center, top + 6, baseKey)
          .setDisplaySize(dockWidth, dockWidth).setOrigin(0.5, left ? 0.88 : 0.765).setDepth(-20);
      }
      if (this.scene.textures.exists(ART.platform)) {
        this.scene.add.image(center, top, ART.platform, 'deck')
          .setOrigin(0.5, 0).setDisplaySize(dockWidth, dockWidth * 241 / 2128).setDepth(-10);
      } else {
        const deck = this.scene.add.graphics().setDepth(-10);
        deck.fillStyle(0x947145).fillRect(center - dockWidth / 2, top, dockWidth, 24);
      }
    }
    this.buildForegroundWater();
  }

  /**
   * 静态前景水面（真机反馈：基地/码头支腿底边"齐根切断"无近景水面
   * 衔接，有腾空感）——与场景底图同宽的水面条带镜向相邻循环铺满
   * （同远景板模式，镜向天然无缝），压住基地入水线以下的浮空部分。
   * 水面线在走道面以下，不遮挡角色站位；素材缺失保持原样（纯增饰）。
   */
  private buildForegroundWater(): void {
    if (!this.scene.textures.exists(ART.foregroundWater)) {
      return;
    }
    const { width } = GAME_CONFIG.world;
    const waterTopY = GAME_CONFIG.world.groundTopY + 25;
    // 条带按源比例等比显示：高度 ~100 世界 px 定 tile 宽，镜向循环铺满全场景宽；
    // 素材顶区已泛洪抠除为透明天（泡沫剪影自然起伏，后景透出远景海面），
    // 泡沫线以下水体不透明 —— 足以盖住基地支腿"齐根切断"的浮空部分
    const source = this.scene.textures.get(ART.foregroundWater).getSourceImage();
    const targetHeight = 100;
    const tileWidth = targetHeight * source.width / source.height;
    const tileCount = Math.ceil(width / tileWidth);
    for (let i = 0; i < tileCount; i++) {
      this.scene.add.image(i * tileWidth, waterTopY, ART.foregroundWater)
        .setOrigin(0, 0)
        .setDisplaySize(tileWidth, targetHeight)
        .setFlipX(i % 2 === 1)
        .setDepth(-5);
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
