import Phaser from 'phaser';
import { MainMenuScene } from './MainMenuScene';

/**
 * 启动场景。当前无外部资源需要加载，
 * 直接进入 MainMenuScene；后续在此挂载资源 preload。
 */
export class BootScene extends Phaser.Scene {
  static readonly KEY = 'BootScene';

  constructor() {
    super(BootScene.KEY);
  }

  create(): void {
    this.scene.start(MainMenuScene.KEY);
  }
}
