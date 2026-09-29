import Phaser from 'phaser';
import { MainMenuScene } from './MainMenuScene';
import { ART_FILES } from '../config/ArtAssets';

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
  }

  create(): void {
    this.scene.start(MainMenuScene.KEY);
  }
}
