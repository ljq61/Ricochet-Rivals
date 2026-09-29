import Phaser from 'phaser';
import { ART, PLAYER_ART_BOUNDS } from '../config/ArtAssets';
import type { PlayerId } from '../state/ids';

/**
 * Decorative menu composition; it owns no input zones or gameplay state.
 * 真机反馈轮：上下两条压暗 UI 框 + 副标题装饰已按用户反馈移除 ——
 * 只保留海港背景与蓝红角色构图。
 */
export class MenuArtwork {
  private readonly background: Phaser.GameObjects.Image | null;
  private readonly blue: Phaser.GameObjects.Image | null;
  private readonly red: Phaser.GameObjects.Image | null;
  private readonly docks: (Phaser.GameObjects.Image | null)[];

  constructor(private readonly scene: Phaser.Scene, private readonly muted = false) {
    const image = (key: string) => scene.textures.exists(key)
      ? scene.add.image(0, 0, key) : null;
    this.background = image(ART.harbor);
    if (muted) this.background?.setTint(0x56616c);
    this.docks = [0, 1].map(() => scene.textures.exists(ART.platform)
      ? scene.add.image(0, 0, ART.platform, 'deck').setOrigin(0.5, 0) : null);
    this.blue = image(ART.P1);
    this.red = image(ART.P2);
    this.red?.setFlipX(true);
  }

  showResult(winner: PlayerId | null): void {
    for (const [id, sprite] of [['P1', this.blue], ['P2', this.red]] as const) {
      if (!sprite) continue;
      if (winner === id) {
        this.scene.tweens.add({ targets: sprite, angle: { from: -2, to: 2 },
          duration: 420, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      } else {
        sprite.setTint(0x7c8492).setAlpha(0.75).setAngle(id === 'P1' ? -10 : 10);
      }
    }
  }

  layout(width: number, height: number, ui: number): void {
    if (this.background) {
      this.background.setPosition(width / 2, height / 2);
      this.background.setScale(Math.max(width / this.background.width, height / this.background.height));
    }
    for (const [i, sprite] of [this.blue, this.red].entries()) {
      if (!sprite) continue;
      const visible = !this.muted && width / ui >= 760;
      const bounds = PLAYER_ART_BOUNDS[i === 0 ? 'P1' : 'P2'];
      const size = Math.min(height * 0.52, width * 0.25);
      const x = width * (i === 0 ? 0.18 : 0.82);
      const feetY = Math.min(height * 0.88, height - 92 * ui);
      sprite.setScale(size / (bounds.bottom - bounds.top))
        .setOrigin(0.5, bounds.bottom / bounds.sourceHeight)
        .setPosition(x, feetY).setVisible(visible);
      const dockW = width * 0.33;
      this.docks[i]?.setPosition(x, feetY).setDisplaySize(dockW, dockW * 241 / 2128).setVisible(visible);
    }
  }
}
