import type Phaser from 'phaser';
import { ART } from '../config/ArtAssets';
import { GAME_CONFIG } from '../config/GameConfig';
import { SFX, SfxBus } from '../audio/SfxBus';
import type { AirstrikeContext } from '../state/AirstrikeState';
import { ProjectileEffects } from './ProjectileEffects';

type AirstrikeStage = 'idle' | 'flying' | 'dropping' | 'holding';

/** Cosmetic flight only. The scene owns authority, damage and camera restoration. */
export class AirstrikeView {
  private stage: AirstrikeStage = 'idle';
  private context: AirstrikeContext | null = null;
  private plane: Phaser.GameObjects.Image | null = null;
  private bomb: Phaser.GameObjects.Image | null = null;
  private readonly tweens = new Set<Phaser.Tweens.Tween>();
  private holdTimer: Phaser.Time.TimerEvent | null = null;
  private generation = 0;
  private readonly sfx: SfxBus;
  private stopEngine: (() => void) | null = null;
  private stopDrop: (() => void) | null = null;

  constructor(private readonly scene: Phaser.Scene) { this.sfx = new SfxBus(scene); }

  get isPlaying(): boolean { return this.stage !== 'idle'; }

  get followTarget(): { x: number; y: number } | null {
    const sprite = this.stage === 'flying' ? this.plane : this.bomb;
    return sprite ? { x: sprite.x, y: sprite.y } : null;
  }

  get debugState() {
    return {
      stage: this.stage,
      ownerId: this.context?.ownerId ?? null,
      itemId: this.context?.itemId ?? null,
      turnId: this.context?.turnId ?? null,
      plane: this.plane ? { x: this.plane.x, y: this.plane.y, flipX: this.plane.flipX } : null,
      bomb: this.bomb ? { x: this.bomb.x, y: this.bomb.y } : null,
    };
  }

  play(context: AirstrikeContext,
    onImpact: (context: AirstrikeContext) => void,
    onComplete: (context: AirstrikeContext) => void): void {
    this.cancel();
    const generation = this.generation;
    // Freeze presentation too: callers may replace the authoritative pending context.
    const flight = { ...context, target: { ...context.target } };
    this.context = flight;
    this.stage = 'flying';
    this.stopEngine = this.sfx.loop(SFX.airstrikeEngine);
    const direction = flight.ownerId === 'P1' ? 1 : -1;
    const startX = direction === 1 ? -200 : GAME_CONFIG.world.width + 200;
    const altitude = GAME_CONFIG.items.airstrikeAltitudeY;
    const plane = this.scene.add.image(startX, altitude, ART.airstrikePlane, 'plane')
      .setOrigin(0.5).setDepth(60).setFlipX(direction === -1);
    plane.setScale(430 / Math.max(1, plane.width));
    this.plane = plane;
    const alive = () => generation === this.generation && this.context === flight;
    this.tweens.add(this.scene.tweens.add({ targets: plane, x: flight.target.x,
      duration: GAME_CONFIG.items.airstrikeFlightMs, ease: 'Linear', onComplete: () => {
        if (!alive() || this.stage !== 'flying') return;
        this.stage = 'dropping';
        this.stopDrop = this.sfx.playOwned(SFX.airstrikeDrop);
        const remainingMs = GAME_CONFIG.items.airstrikeDropMs + GAME_CONFIG.items.airstrikeImpactHoldMs;
        const speed = (flight.target.x - startX) / GAME_CONFIG.items.airstrikeFlightMs;
        // Keep the same velocity after release; do not park the plane over the base.
        this.tweens.add(this.scene.tweens.add({ targets: plane,
          x: flight.target.x + speed * remainingMs, duration: remainingMs, ease: 'Linear' }));
        const bomb = this.scene.add.image(flight.target.x, altitude + 35, ART.airstrikeAtlas, 'bomb')
          .setOrigin(0.5).setDepth(61);
        bomb.setScale(85 / Math.max(1, bomb.height));
        this.bomb = bomb;
        this.tweens.add(this.scene.tweens.add({ targets: bomb, y: flight.target.y,
          duration: GAME_CONFIG.items.airstrikeDropMs, ease: 'Quad.easeIn', onComplete: () => {
            if (!alive() || this.stage !== 'dropping') return;
            this.stage = 'holding';
            this.stopDrop?.();
            this.stopDrop = null;
            bomb.setVisible(false);
            new ProjectileEffects(this.scene).impact(flight.target.x, flight.target.y);
            this.sfx.play(SFX.explosion);
            this.scene.cameras.main.shake(180, 0.004);
            onImpact(flight);
            // An authority callback may restore a snapshot or shut down the scene.
            if (!alive()) return;
            this.holdTimer = this.scene.time.delayedCall(GAME_CONFIG.items.airstrikeImpactHoldMs, () => {
              if (!alive() || this.stage !== 'holding') return;
              this.cancel();
              onComplete(flight);
            });
          } }));
      } }));
  }

  cancel(): void {
    this.generation += 1;
    this.stopEngine?.();
    this.stopDrop?.();
    this.stopEngine = this.stopDrop = null;
    this.holdTimer?.remove(false);
    this.holdTimer = null;
    for (const tween of this.tweens) tween.remove();
    this.tweens.clear();
    this.plane?.destroy();
    this.bomb?.destroy();
    this.plane = this.bomb = null;
    this.context = null;
    this.stage = 'idle';
  }

  destroy(): void { this.cancel(); }
}
