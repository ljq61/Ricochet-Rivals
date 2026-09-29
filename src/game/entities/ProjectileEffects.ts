import Phaser from 'phaser';
import { ART } from '../config/ArtAssets';
import { GAME_CONFIG } from '../config/GameConfig';

/** Scene-owned cosmetic particles; never pause Matter, networking or the turn clock. */
export class ProjectileEffects {
  private readonly flame: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly smoke: Phaser.GameObjects.Particles.ParticleEmitter;
  private finished = false;
  private elapsed = 0;

  constructor(private readonly scene: Phaser.Scene) {
    if (!scene.textures.exists('fx-spark')) {
      const g = scene.make.graphics({ x: 0, y: 0 });
      g.fillStyle(0xffffff).fillRect(2, 0, 4, 8).fillRect(0, 2, 8, 4);
      g.generateTexture('fx-spark', 8, 8);
      g.destroy();
    }
    this.flame = scene.add.particles(0, 0, 'fx-spark', {
      emitting: false, maxParticles: 80, lifespan: { min: 120, max: 240 },
      speed: { min: 12, max: 50 }, scale: { start: 2.4, end: 0.2 },
      alpha: { start: 1, end: 0 }, color: [0xfff8cc, 0xffd14a, 0xff792b, 0xa83924],
      blendMode: Phaser.BlendModes.NORMAL,
    }).setDepth(498);
    this.smoke = scene.add.particles(0, 0, scene.textures.exists(ART.smoke) ? ART.smoke : 'fx-spark', {
      emitting: false, maxParticles: 50, lifespan: { min: 380, max: 650 },
      speedX: { min: -15, max: 15 }, speedY: { min: -35, max: -12 },
      scale: { start: 0.014, end: 0.046 }, alpha: { start: 0.48, end: 0 },
      rotate: { min: 0, max: 360 },
    }).setDepth(495);
  }

  update(x: number, y: number, vx: number, vy: number, deltaMs: number): void {
    if (this.finished) return;
    this.elapsed += deltaMs;
    const length = Math.hypot(vx, vy) || 1;
    const nx = vx / length;
    const ny = vy / length;
    // Dense fire stays at the nozzle, older embers and smoke remain in world space.
    if (this.elapsed >= 16) {
      this.elapsed %= 16;
      this.flame.emitParticleAt(x - nx * 26, y - ny * 26, 2);
      this.flame.emitParticleAt(x - nx * 42, y - ny * 42, 1);
      this.smoke.emitParticleAt(x - nx * 38, y - ny * 38, 1);
    }
  }

  finish(): void {
    if (this.finished) return;
    this.finished = true;
    if (!this.scene.sys.isActive()) {
      if (this.flame.scene) this.flame.destroy();
      if (this.smoke.scene) this.smoke.destroy();
      return;
    }
    // Phaser owns timers and emitters, including shutdown during scene transitions.
    this.scene.time.delayedCall(700, () => {
      this.flame.destroy();
      this.smoke.destroy();
    });
  }

  impact(x: number, y: number): void {
    this.finish();
    const scene = this.scene;
    const radius = GAME_CONFIG.explosion.radius;
    const flash = scene.add.circle(x, y, 50, 0xfff6cc).setDepth(515);
    scene.tweens.add({ targets: flash, scale: 2.4, alpha: 0, duration: 140,
      onComplete: () => flash.destroy() });
    const ring = scene.add.circle(x, y, radius, 0xffd982, 0)
      .setStrokeStyle(5, 0xffdd93, 0.85).setScale(0.2).setDepth(509);
    scene.tweens.add({ targets: ring, scale: 1.25, alpha: 0, duration: 380,
      ease: 'Cubic.easeOut', onComplete: () => ring.destroy() });
    if (scene.textures.exists(ART.explosion)) {
      const burst = scene.add.image(x, y, ART.explosion).setDepth(510);
      const targetScale = radius * 3 / burst.width;
      burst.setScale(targetScale * 0.35);
      scene.tweens.add({ targets: burst, scale: targetScale, duration: 95, ease: 'Back.easeOut' });
      scene.tweens.add({ targets: burst, scale: targetScale * 1.18, alpha: 0,
        delay: 130, duration: 390, onComplete: () => burst.destroy() });
    }
    const sparks = scene.add.particles(x, y, 'fx-spark', {
      emitting: false, maxParticles: 28, lifespan: { min: 350, max: 820 },
      speed: { min: 100, max: 420 }, angle: { min: 185, max: 355 }, gravityY: 650,
      scale: { start: 1.3, end: 0 }, color: [0xfff4bd, 0xffb52e, 0xd85221],
      alpha: { start: 1, end: 0 }, rotate: { min: 0, max: 360 },
    }).setDepth(512);
    sparks.explode(28);
    const dust = scene.add.particles(x, y, scene.textures.exists(ART.smoke) ? ART.smoke : 'fx-spark', {
      emitting: false, maxParticles: 9, lifespan: { min: 650, max: 1100 },
      speed: { min: 45, max: 130 }, angle: { min: 195, max: 345 },
      scale: { start: 0.035, end: 0.12 }, alpha: { start: 0.75, end: 0 },
      rotate: { min: 0, max: 360 }, gravityY: -40,
    }).setDepth(507);
    dust.explode(9);
    scene.time.delayedCall(1200, () => { sparks.destroy(); dust.destroy(); });
  }
}
