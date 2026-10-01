import Phaser from 'phaser';
import { MainMenuScene } from './MainMenuScene';
import { ART, ART_FILES, AIM_POSE_FILES, SHEET_GRID, WALK_ART, DOCK_ART_FRAME, CONTROL_ART_FRAMES } from '../config/ArtAssets';
import { SFX_FILES } from '../audio/SfxBus';
import { updateStartupLoading } from '../ui/StartupLoadingScreen';

/**
 * Load first-look art once. Consumers retain playable fallback visuals.
 */
export class BootScene extends Phaser.Scene {
  static readonly KEY = 'BootScene';

  constructor() {
    super(BootScene.KEY);
  }

  preload(): void {
    updateStartupLoading(0);
    this.load.on('progress', updateStartupLoading);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.load.off('progress', updateStartupLoading);
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
    for (const [key, frame] of Object.entries(CONTROL_ART_FRAMES)) {
      if (this.textures.exists(key)) {
        this.textures.get(key).add('button', 0, frame.x, frame.y, frame.width, frame.height);
      }
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
    for (const walk of Object.values(WALK_ART)) {
      if (!this.textures.exists(walk.key)) continue;
      const texture = this.textures.get(walk.key);
      const source = texture.getSourceImage();
      const w = Math.floor(source.width / walk.cols), h = Math.floor(source.height / walk.rows);
      for (let i = 0; i < walk.cols * walk.rows; i++) {
        const row = Math.floor(i / walk.cols);
        // Generated atlases may have uneven row gutters; keep each whole pose intact.
        const bounds = 'rowBounds' in walk
          ? (walk.rowBounds as readonly { top: number; bottom: number }[])[row]
          : null;
        const top = bounds?.top ?? row * h;
        const height = bounds ? bounds.bottom - bounds.top : h;
        texture.add(i, 0, (i % walk.cols) * w, top, w, height);
      }
    }
    this.scene.start(MainMenuScene.KEY);
  }
}
