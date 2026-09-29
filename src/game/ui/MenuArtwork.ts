import Phaser from 'phaser';
import { ART } from '../config/ArtAssets';

/**
 * Decorative menu composition; it owns no input zones or gameplay state.
 * 真机反馈轮：上下两条压暗 UI 框 + 副标题装饰已按用户反馈移除 ——
 * 只保留海港背景与蓝红角色构图。
 */
export class MenuArtwork {
  private readonly background: Phaser.GameObjects.Image | null;
  private readonly blue: Phaser.GameObjects.Image | null;
  private readonly red: Phaser.GameObjects.Image | null;

  constructor(scene: Phaser.Scene) {
    const image = (key: string) => scene.textures.exists(key)
      ? scene.add.image(0, 0, key) : null;
    this.background = image(ART.harbor);
    this.blue = image(ART.P1);
    this.red = image(ART.P2);
    this.red?.setFlipX(true);
  }

  layout(width: number, height: number, ui: number): void {
    if (this.background) {
      this.background.setPosition(width / 2, height / 2);
      this.background.setScale(Math.max(width / this.background.width, height / this.background.height));
    }
    for (const [i, sprite] of [this.blue, this.red].entries()) {
      if (!sprite) continue;
      const size = Math.min(height * 0.58, width * 0.3);
      sprite.setDisplaySize(size, size).setPosition(width * (i === 0 ? 0.18 : 0.82), height * 0.69);
      sprite.setVisible(width / ui >= 760);
    }
  }
}
