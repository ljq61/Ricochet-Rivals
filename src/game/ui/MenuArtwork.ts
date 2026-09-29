import Phaser from 'phaser';
import { ART } from '../config/ArtAssets';

/** Decorative menu composition; it owns no input zones or gameplay state. */
export class MenuArtwork {
  private readonly background: Phaser.GameObjects.Image | null;
  private readonly blue: Phaser.GameObjects.Image | null;
  private readonly red: Phaser.GameObjects.Image | null;
  private readonly frame: Phaser.GameObjects.Graphics;
  private readonly subtitle: Phaser.GameObjects.Text;

  constructor(scene: Phaser.Scene) {
    const image = (key: string) => scene.textures.exists(key)
      ? scene.add.image(0, 0, key) : null;
    this.background = image(ART.harbor);
    this.blue = image(ART.P1);
    this.red = image(ART.P2);
    this.red?.setFlipX(true);
    this.frame = scene.add.graphics();
    this.subtitle = scene.add.text(0, 0, 'HARBOR SKIRMISH  /  01', {
      fontFamily: 'monospace', fontStyle: 'bold', color: '#ffe19a',
    }).setOrigin(0.5);
  }

  layout(width: number, height: number, ui: number): void {
    if (this.background) {
      this.background.setPosition(width / 2, height / 2);
      this.background.setScale(Math.max(width / this.background.width, height / this.background.height));
    }
    const short = height / ui < 540;
    for (const [i, sprite] of [this.blue, this.red].entries()) {
      if (!sprite) continue;
      const size = Math.min(height * 0.58, width * 0.3);
      sprite.setDisplaySize(size, size).setPosition(width * (i === 0 ? 0.18 : 0.82), height * 0.69);
      sprite.setVisible(width / ui >= 760);
    }
    this.frame.clear();
    this.frame.fillStyle(0x080d12, 0.66);
    this.frame.fillRect(0, 0, width, short ? 76 * ui : 142 * ui);
    this.frame.fillStyle(0x151c22, 0.88);
    this.frame.fillRect(0, height - 102 * ui, width, 102 * ui);
    this.frame.lineStyle(2 * ui, 0xc39a54, 0.9);
    this.frame.lineBetween(0, height - 102 * ui, width, height - 102 * ui);
    this.subtitle.setFontSize(12 * ui).setPosition(width / 2, short ? 68 * ui : 116 * ui);
  }
}
