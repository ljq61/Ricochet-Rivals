import Phaser from 'phaser';
import { MainMenuScene } from './MainMenuScene';
import { ART, ART_FILES, AIM_POSE_FILES } from '../config/ArtAssets';
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
      this.textures.get(ART.platform).add('deck', 0, 25, 263, 2128, 241);
    }
    this.scene.start(MainMenuScene.KEY);
  }
}
