import Phaser from 'phaser';
import { MainMenuScene } from './MainMenuScene';
import { ART, ART_FILES, AIM_POSE_FILES, SHEET_GRID, DOCK_ART_FRAME } from '../config/ArtAssets';
import { SFX_FILES } from '../audio/SfxBus';

/**
 * Load first-look art once. Consumers retain playable fallback visuals.
 */
export class BootScene extends Phaser.Scene {
  static readonly KEY = 'BootScene';

  constructor() {
    super(BootScene.KEY);
  }

  preload(): void {
    const label = this.add.text(32, 32, 'LOADING HARBOR…', {
      fontFamily: 'monospace', fontSize: '22px', color: '#ffe19a',
    });
    this.load.on('progress', (progress: number) => {
      label.setText(`LOADING HARBOR… ${Math.round(progress * 100)}%`);
    });
    for (const [key, file] of ART_FILES) {
      this.load.image(key, `assets/art/${file}`);
    }
    // Phase 17 修复轮：瞄准抬枪序列（15–75°，蓝红各 5 张）
    for (const [key, file] of AIM_POSE_FILES) {
      this.load.image(key, `assets/art/${file}`);
    }
    // Phase 17 Juice：音效（缺失时 SfxBus 静默跳过，同美术回退原则）
    for (const [key, file] of SFX_FILES) {
      this.load.audio(key, `assets/sfx/${file}`);
    }
  }

  create(): void {
    // Runtime frames preserve the generated originals and remove transparent padding.
    const controls = this.textures.get(ART.aimControls);
    if (this.textures.exists(ART.aimControls)) {
      controls.add('ready', 0, 44, 44, 790, 790);
      controls.add('cancel', 0, 940, 44, 790, 790);
    }
    if (this.textures.exists(ART.platform)) {
      const frame = DOCK_ART_FRAME;
      this.textures.get(ART.platform).add('deck', 0, frame.x, frame.y, frame.width, frame.height);
    }
    // Phase 17 Juice：序列 sheet 运行时切帧（4×4 → 编号 0…15，逐帧循环动画）
    const frameCount = SHEET_GRID.cols * SHEET_GRID.rows;
    for (const key of [ART.baseFire, ART.octopus]) {
      if (!this.textures.exists(key)) continue;
      const texture = this.textures.get(key);
      const source = texture.getSourceImage();
      const frameWidth = Math.floor(source.width / SHEET_GRID.cols);
      const frameHeight = Math.floor(source.height / SHEET_GRID.rows);
      for (let i = 0; i < frameCount; i++) {
        texture.add(
          i,
          0,
          (i % SHEET_GRID.cols) * frameWidth,
          Math.floor(i / SHEET_GRID.cols) * frameHeight,
          frameWidth,
          frameHeight
        );
      }
    }
    for (const key of [ART.walkP1, ART.walkP2]) {
      if (!this.textures.exists(key)) continue;
      const texture = this.textures.get(key);
      const source = texture.getSourceImage();
      const w = Math.floor(source.width / 4), h = Math.floor(source.height / 2);
      for (let i = 0; i < 8; i++) texture.add(i, 0, (i % 4) * w, Math.floor(i / 4) * h, w, h);
    }
    this.scene.start(MainMenuScene.KEY);
  }
}
