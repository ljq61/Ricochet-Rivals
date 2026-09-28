import Phaser from 'phaser';
import { GAME_CONFIG } from './GameConfig';
import { PALETTE } from './Palette';
import { BootScene } from '../scenes/BootScene';
import { MainMenuScene } from '../scenes/MainMenuScene';
import { BattleScene } from '../scenes/BattleScene';
import { ResultScene } from '../scenes/ResultScene';
import { OnlineConnectionScene } from '../scenes/OnlineConnectionScene';

/**
 * Phaser Game 实例配置。
 *
 * Scale 模式（真机修复后）：**NONE** + 手动驱动 ——
 * Phaser RESIZE 模式把画布位图设为 CSS 像素，高 DPR 手机（iPhone 3x）
 * 上位图被浏览器拉伸 3 倍导致发糊（引擎全库不使用 devicePixelRatio，
 * 源码验证）。NONE 模式下由 ViewportService 统一驱动：
 * scale.resize(CSS×dpr) 位图 = 物理分辨率（清晰），
 * scale.zoom = 1/dpr 把 CSS 显示尺寸缩回。
 * Matter Physics：重力等参数统一来自 GameConfig。
 */
export function createPhaserGameConfig(
  parent: HTMLElement
): Phaser.Types.Core.GameConfig {
  return {
    type: Phaser.AUTO,
    parent,
    backgroundColor: PALETTE.sky,
    scale: {
      mode: Phaser.Scale.NONE,
      // 占位尺寸：ViewportService 在 BattleScene.create 时按
      // 可见视口 × DPR 调整为真实物理分辨率
      width: 1280,
      height: 720,
      zoom: 1 / (window.devicePixelRatio || 1),
    },
    physics: {
      default: 'matter',
      matter: {
        // 单位适配（Physics Adapter 层）：
        // GameConfig 统一用 px/s²（1000）；Matter gravity 1 ≈ 1000 px/s²
        gravity: {
          x: GAME_CONFIG.physics.gravityX / 1000,
          y: GAME_CONFIG.physics.gravityY / 1000,
        },
        debug: false,
      },
    },
    scene: [
      BootScene,
      MainMenuScene,
      BattleScene,
      ResultScene,
      OnlineConnectionScene,
    ],
  };
}
