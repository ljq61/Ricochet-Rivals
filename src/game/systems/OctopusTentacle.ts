import Phaser from 'phaser';
import { ART, SHEET_GRID } from '../config/ArtAssets';
import { GAME_CONFIG } from '../config/GameConfig';
import { SfxBus, SFX } from '../audio/SfxBus';
import { COLLISION_CATEGORY } from '../physics/collisionCategories';
import { TurnPhase, type GameState } from '../state/GameState';
import { baseDockGeometry } from './WorldBuilder';
import { isOctopusActive } from '../state/OctopusState';
import type { PlayerId } from '../state/ids';

const OCTOPUS_ANIM_KEY = 'fx-octopus-idle-loop';
const FRAME_COUNT = SHEET_GRID.cols * SHEET_GRID.rows;

export interface LaserVisual {
  tip: { x: number; y: number };
  end: { x: number; y: number } | null;
  /** Canvas angle, measured clockwise from positive X. */
  angle: number | null;
  progress: number;
  target: PlayerId | null;
}

/** State-driven obstacle and laser presentation. HP and damage belong to the resolver. */
export class OctopusTentacle {
  private active = false;
  private body: MatterJS.BodyType | null = null;
  private objects: Phaser.GameObjects.GameObject[] = [];
  private sprite: Phaser.GameObjects.Sprite | null = null;
  private fallback: Phaser.GameObjects.Graphics | null = null;
  private healthBar: Phaser.GameObjects.Graphics | null = null;
  private deathTween: Phaser.Tweens.Tween | null = null;
  private finishDeath: (() => void) | null = null;
  private dissolveProgress = 0;
  private lastShownAttackTurn = 0;
  private laserHit = true;
  private laserTween: Phaser.Tweens.Tween | null = null;
  private finishLaser: ((keepLastFrame?: boolean) => void) | null = null;
  private lingeringFx: Phaser.GameObjects.Graphics | null = null;
  private idlePromise: Promise<void> = Promise.resolve();
  private phase: 'idle' | 'focusing' | 'charging' | 'holding' | 'sweeping' | 'dissolving' = 'idle';
  /** 蓄力/扫射音效每段攻击只触发一次（tween 逐帧推进，相位切换按标志守卫） */
  private chargeSoundPlayed = false;
  private sweepSoundPlayed = false;
  private readonly sfx: SfxBus;
  private visual: LaserVisual = { tip: { x: 0, y: 0 }, end: null, angle: null, progress: 0, target: null };

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly onLaserHit: (target: PlayerId) => void = () => {},
    private readonly onLaserFocus: (x: number, y: number, durationMs: number) => void = () => {},
    private readonly onLaserComplete: () => void = () => {},
  ) {
    this.sfx = new SfxBus(scene);
  }

  get isActive(): boolean { return this.active; }
  get attackPhase(): string { return this.phase; }
  get isAttacking(): boolean { return this.phase !== 'idle'; }
  get deathProgress(): number { return this.dissolveProgress; }
  get laserVisual(): LaserVisual {
    return { ...this.visual, tip: { ...this.visual.tip },
      end: this.visual.end === null ? null : { ...this.visual.end } };
  }

  hasPendingLaserHit(state: GameState): boolean {
    if (!isOctopusActive(state.octopus)) return false;
    const turn = state.octopus.lastAttackTurnId;
    return turn !== null && (turn > this.lastShownAttackTurn || !this.laserHit);
  }

  /** Flight collision must remain stable even if Guest receives the result early. */
  refresh(state: GameState): void {
    if (state.phase === TurnPhase.PROJECTILE) return;
    this.syncObstacle(state);
    const turn = state.octopus.lastAttackTurnId;
    const target = state.octopus.lastAttackTarget;
    if (this.active && turn !== null && target !== null && turn > this.lastShownAttackTurn &&
        [TurnPhase.RESOLVE, TurnPhase.END, TurnPhase.GAME_OVER].includes(state.phase)) {
      this.playLaser(turn, target);
    }
  }

  whenIdle(): Promise<void> { return this.idlePromise; }

  /** Recovery shows the restored state without replaying historical attacks. */
  restore(state: GameState): void {
    this.cancelLaser();
    this.cancelDeath();
    this.lastShownAttackTurn = state.octopus.lastAttackTurnId ?? 0;
    this.syncObstacle(state, false);
  }

  destroy(): void {
    this.cancelLaser();
    this.cancelDeath();
    this.removeObstacle();
  }

  private syncObstacle(state: GameState, animateDeath = true): void {
    if (!isOctopusActive(state.octopus)) {
      if (animateDeath && this.active && state.octopus.hp === 0) this.playDeath();
      else if (this.phase !== 'dissolving') this.removeObstacle();
      return;
    }
    if (this.phase === 'dissolving') this.cancelDeath();
    if (!this.active) this.activate();
    const cfg = GAME_CONFIG.octopus;
    const bar = this.healthBar!;
    bar.clear().fillStyle(0x10172c, 0.9).fillRoundedRect(-117, -14, 234, 28, 10);
    const gap = 3;
    const segmentWidth = (218 - (cfg.maxHp - 1) * gap) / cfg.maxHp;
    for (let i = 0; i < cfg.maxHp; i++) {
      bar.fillStyle(i < state.octopus.hp ? 0xe970cf : 0x4a405d, 1)
        .fillRoundedRect(-109 + i * (segmentWidth + gap), -7, segmentWidth, 14, 2);
    }
  }

  private removeObstacle(): void {
    this.removeCollider();
    for (const object of this.objects) {
      this.scene.tweens.killTweensOf(object);
      object.destroy();
    }
    this.objects = [];
    this.sprite = null;
    this.fallback = null;
    this.healthBar = null;
    this.active = false;
  }

  private removeCollider(): void {
    // Matter's SHUTDOWN listener may already have cleared the scene world.
    const world = this.scene.matter?.world;
    if (this.body !== null && world) world.remove(this.body);
    this.body = null;
  }

  /** Presentation only: collision disappears immediately, ash completes before the next turn. */
  private playDeath(): void {
    this.cancelLaser();
    this.removeCollider();
    this.active = false;
    this.phase = 'dissolving';
    this.dissolveProgress = 0;
    const cfg = GAME_CONFIG.octopus;
    const sprite = this.sprite;
    for (const object of this.objects) this.scene.tweens.killTweensOf(object);
    sprite?.stop();
    this.healthBar?.setAlpha(0);
    const visible = sprite === null ? 1 : Phaser.Math.Clamp(
      (cfg.baseY - sprite.y + cfg.height) / cfg.height, 0, 1);
    const top = (sprite?.y ?? cfg.baseY) - cfg.height;
    const fx = this.scene.add.graphics().setDepth(-4).setName('octopus-dissolve');
    this.objects.push(fx);
    this.sfx.play(SFX.octopusDeath);
    const progress = { value: 0 };
    this.idlePromise = new Promise<void>((resolve) => {
      this.finishDeath = () => {
        this.removeObstacle();
        this.phase = 'idle';
        resolve();
      };
    });
    const draw = (): void => {
      const q = progress.value;
      this.dissolveProgress = q;
      const edge = top + cfg.height * visible * q;
      if (sprite !== null) {
        sprite.setCrop(0, sprite.frame.height * visible * q,
          sprite.frame.width, sprite.frame.height * visible * (1 - q));
        sprite.setTint(0xf6b5ef).setAlpha(1 - q * 0.35);
      } else {
        this.fallback?.clear().lineStyle(cfg.width * cfg.collisionWidthRatio, 0xa766b8, 1 - q)
          .lineBetween(cfg.x, cfg.baseY, cfg.x, edge);
      }
      // Existing wake/label fade away; only the tentacle itself is cropped top to bottom.
      for (const object of this.objects) {
        if (object !== sprite && object !== this.fallback && object !== fx && object !== this.healthBar) {
          (object as Phaser.GameObjects.Graphics).setAlpha(1 - q);
        }
      }
      fx.clear();
      // Broad white-hot fragments, halos and trails stay legible at mobile world scale.
      const fade = Math.min(1, (1 - q) * 8);
      for (let i = 0; i < 84; i++) {
        const drift = (q * 2.3 + i * 0.137) % 1;
        const dx = Math.sin(i * 2.4);
        const x = cfg.x + dx * (cfg.width * 0.24 + drift * 190);
        const y = edge - drift * (180 + (i % 6) * 20) + Math.sin(i * 1.7 + q * 18) * 18;
        const alpha = (1 - drift * 0.75) * fade;
        const size = 6 + (i % 5) * 2;
        fx.fillStyle(0xcb65ff, alpha * 0.25).fillCircle(x, y, size * 3);
        fx.lineStyle(5 + i % 3, 0xf89bff, alpha * 0.8)
          .lineBetween(x, y, x - dx * 28, y + 30 + drift * 28);
        fx.fillStyle(i % 3 === 0 ? 0xffffff : 0xffccf4, alpha).fillCircle(x, y, size);
      }
      // Three glow layers make the uneven dissolution front much brighter than the sprite.
      for (const [width, color, alpha] of [[58, 0xb644ed, 0.35], [22, 0xf58dff, 0.9], [7, 0xffffff, 1]] as const) {
        fx.lineStyle(width, color, alpha * fade);
        for (let i = 0; i < 14; i++) {
          const x = cfg.x + (i / 14 - 0.5) * cfg.width * 0.52;
          const nextX = cfg.x + ((i + 1) / 14 - 0.5) * cfg.width * 0.52;
          fx.lineBetween(x, edge + Math.sin(i * 1.8 + q * 15) * 15,
            nextX, edge + Math.sin((i + 1) * 1.8 + q * 15) * 15);
        }
      }
    };
    draw();
    this.deathTween = this.scene.tweens.add({ targets: progress, value: 1,
      duration: cfg.deathDurationMs, onUpdate: draw, onComplete: () => {
        this.deathTween = null;
        this.finishDeath?.();
        this.finishDeath = null;
      } });
  }

  private cancelDeath(): void {
    this.deathTween?.stop();
    this.deathTween = null;
    this.finishDeath?.();
    this.finishDeath = null;
    this.dissolveProgress = 0;
  }

  private cancelLaser(): void {
    this.lingeringFx?.destroy();
    this.lingeringFx = null;
    this.laserTween?.stop();
    this.laserTween = null;
    this.finishLaser?.();
    this.finishLaser = null;
    this.laserHit = true;
    this.phase = 'idle';
    this.visual.end = null;
    this.onLaserComplete();
  }

  private playLaser(turn: number, target: PlayerId): void {
    this.lastShownAttackTurn = turn;
    this.laserHit = false;
    this.chargeSoundPlayed = false;
    this.sweepSoundPlayed = false;
    this.phase = 'focusing';
    const cfg = GAME_CONFIG.octopus;
    const baseX = baseDockGeometry(target).center;
    const groundY = GAME_CONFIG.world.groundTopY;
    const chargeEnd = cfg.focusDurationMs + cfg.chargeDurationMs;
    const sweepStart = chargeEnd + cfg.holdDurationMs;
    const duration = sweepStart + cfg.sweepDurationMs;
    const fx = this.scene.add.graphics().setDepth(870).setName('octopus-laser');
    const progress = { elapsed: 0 };
    this.idlePromise = new Promise<void>((resolve) => {
      this.finishLaser = (keepLastFrame = false) => {
        if (keepLastFrame) {
          // Render the final ray at the base before cleaning up on the next frame.
          this.lingeringFx = fx;
          this.scene.time.delayedCall(16, () => {
            if (this.lingeringFx === fx) {
              fx.destroy();
              this.lingeringFx = null;
            }
          });
        } else {
          fx.destroy();
        }
        resolve();
      };
    });
    const draw = (): void => {
      const rotation = this.sprite?.rotation ?? 0;
      // Top curl in the source frame, transformed around the tentacle's bottom pivot.
      const tipX = cfg.x + 65 * Math.cos(rotation) + (cfg.height - 40) * Math.sin(rotation);
      const tipY = cfg.baseY + 65 * Math.sin(rotation) - (cfg.height - 40) * Math.cos(rotation);
      const t = progress.elapsed;
      this.visual = { tip: { x: tipX, y: tipY }, end: null, angle: null, progress: 0, target };
      fx.clear();
      if (t < cfg.focusDurationMs) return;
      if (t < sweepStart) {
        // 粒子聚集开始 → 蓄力音效（一次性触发，跨越 hold 段直到扫射）
        if (!this.chargeSoundPlayed) {
          this.chargeSoundPlayed = true;
          this.sfx.play(SFX.laserCharge);
        }
        this.phase = t < chargeEnd ? 'charging' : 'holding';
        const q = Math.min(1, (t - cfg.focusDurationMs) / cfg.chargeDurationMs);
        // Inward particles arrive from all directions; the charged core stays still during the hold.
        for (let i = 0; i < 24 && this.phase === 'charging'; i++) {
          const angle = i * Math.PI * 2 / 24 + (i % 3) * 0.17;
          const travel = Math.min(1, q / (0.65 + (i % 6) * 0.07));
          const radius = (130 + (i % 5) * 15) * (1 - travel);
          const x = tipX + Math.cos(angle) * radius;
          const y = tipY + Math.sin(angle) * radius;
          fx.lineStyle(2, 0xf4b0ff, 0.65).lineBetween(x, y,
            x + Math.cos(angle) * 12, y + Math.sin(angle) * 12);
          fx.fillStyle(0xfbd5ff, 1).fillCircle(x, y, 2 + (i % 3));
        }
        fx.fillStyle(0xb848ef, 0.16 + q * 0.25).fillCircle(tipX, tipY, 18 + q * 38);
        fx.lineStyle(3, 0xf296fa, 0.9).strokeCircle(tipX, tipY, 65 - q * 47);
        fx.fillStyle(0xe890ff, 1).fillCircle(tipX, tipY, 8 + q * 14);
        fx.fillStyle(0xffffff, q).fillCircle(tipX, tipY, 4 + q * 8);
        return;
      }
      this.phase = 'sweeping';
      // 光束出射 → 扫射音效（一次性触发，覆盖整个 800ms 扫射段）
      if (!this.sweepSoundPlayed) {
        this.sweepSoundPlayed = true;
        this.sfx.play(SFX.laserSweep);
      }
      const q = Math.min(1, (t - sweepStart) / cfg.sweepDurationMs);
      // 30° from vertically downward towards the chosen base, then rotate outwards.
      const startAngle = target === 'P1' ? Math.PI * 2 / 3 : Math.PI / 3;
      const targetAngle = Math.atan2(groundY - tipY, baseX - tipX);
      const angle = startAngle + (targetAngle - startAngle) * q;
      const endX = tipX + (groundY - tipY) / Math.tan(angle);
      const endY = groundY;
      this.visual = { tip: { x: tipX, y: tipY }, end: { x: endX, y: endY }, angle, progress: q, target };
      // Ease into following the contact point, so starting the sweep cannot jump the camera.
      this.onLaserFocus(cfg.x + (endX - cfg.x) * q, groundY, 0);
      fx.lineStyle(40, 0xb749ec, 0.2).lineBetween(tipX, tipY, endX, endY);
      fx.lineStyle(15, 0xf480ff, 0.6).lineBetween(tipX, tipY, endX, endY);
      fx.lineStyle(4, 0xffffff, 1).lineBetween(tipX, tipY, endX, endY);
      fx.fillStyle(0xffffff, 1).fillCircle(tipX, tipY, 15);
      fx.fillStyle(0xeb8fff, 0.85).fillCircle(endX, endY, 25);
      if (q >= 1 && !this.laserHit) {
        this.laserHit = true;
        this.sfx.play(SFX.explosion);
        this.onLaserHit(target);
      }
    };
    this.onLaserFocus(cfg.x, cfg.baseY - cfg.height / 2, cfg.focusDurationMs);
    draw();
    this.laserTween = this.scene.tweens.add({ targets: progress, elapsed: duration, duration,
      onUpdate: draw,
      onComplete: () => {
        this.phase = 'idle';
        this.laserTween = null;
        this.onLaserComplete();
        this.finishLaser?.(true);
        this.finishLaser = null;
      },
    });
  }

  private activate(): void {
    this.active = true;
    const cfg = GAME_CONFIG.octopus;
    if (this.scene.textures.exists(ART.octopus)) {
      this.ensureAnim();
      // 自海底向上平移揭露；碰撞体仍即刻生效，保持已有双端确定性。
      const sprite = this.sprite = this.scene.add
        .sprite(cfg.x, cfg.baseY + cfg.height + 100, ART.octopus, 0)
        .setOrigin(0.5, 1)
        .setDisplaySize(cfg.width, cfg.height)
        .setDepth(-6)
        .setName('octopus-visual');
      // Phaser 4 WebGL supports texture cropping, not legacy GeometryMask.
      const cropAtSea = (): void => {
        const visible = Phaser.Math.Clamp((cfg.baseY - sprite.y + cfg.height) / cfg.height, 0, 1);
        sprite.setCrop(0, 0, sprite.frame.width, sprite.frame.height * visible);
      };
      cropAtSea();
      sprite.play({
        key: OCTOPUS_ANIM_KEY,
        startFrame: 0,
      });
      this.scene.tweens.add({
        targets: sprite,
        y: cfg.baseY,
        duration: 1500,
        ease: 'Sine.easeOut',
        onUpdate: cropAtSea,
        onComplete: () => { sprite.setCrop(); },
      });
      this.objects.push(sprite);
    } else {
      // Asset failure still needs a visible obstacle on both peers.
      const fallback = this.fallback = this.scene.add.graphics().setDepth(-6);
      fallback.lineStyle(cfg.width * cfg.collisionWidthRatio, 0x894b9b, 1)
        .lineBetween(cfg.x, cfg.baseY, cfg.x, cfg.baseY - cfg.height);
      fallback.lineStyle(18, 0xd18cc1, 1)
        .lineBetween(cfg.x + 30, cfg.baseY, cfg.x + 30, cfg.baseY - cfg.height + 40);
      this.objects.push(fallback);
    }
    this.healthBar = this.scene.add.graphics().setPosition(cfg.x, cfg.baseY - cfg.height - 40)
      .setDepth(870).setName('octopus-health');
    const label = this.scene.add.text(cfg.x, cfg.baseY - cfg.height - 62, 'KRAKEN', {
      fontFamily: 'sans-serif', fontSize: '24px', color: '#f9c8f6',
      stroke: '#18132c', strokeThickness: 5,
    }).setOrigin(0.5, 1).setDepth(870);
    this.objects.push(this.healthBar, label);
    // 入水处用局部前景水面盖住素材的平直截边；泡沫沿不规则波峰，而非椭圆描边。
    const wakeShadow = this.scene.add.graphics().setPosition(cfg.x, cfg.baseY - 2).setDepth(-7);
    wakeShadow.fillStyle(0x063d6c, 0.55).fillEllipse(0, 0, 230, 38);
    const waterFront = this.scene.add.graphics().setPosition(cfg.x, cfg.baseY - 8).setDepth(-5);
    waterFront.fillStyle(0x125b8d, 0.48).fillEllipse(0, 4, 154, 21);
    waterFront.fillStyle(0x1b75a6, 0.34)
      .fillEllipse(-77, 5, 74, 10).fillEllipse(78, 5, 68, 10);
    // 泡沫由断开的短笔触组成，避免在贴图海面上出现整块几何水色。
    waterFront.lineStyle(2, 0xbce8ef, 0.72);
    waterFront.lineBetween(-106, 0, -78, -4).lineBetween(-68, -3, -40, -8)
      .lineBetween(-30, -7, -7, -12).lineBetween(8, -10, 34, -6)
      .lineBetween(45, -7, 67, -4).lineBetween(80, -3, 105, 1);
    waterFront.fillStyle(0xe7f7f2, 0.65)
      .fillCircle(-82, -13, 3).fillCircle(-52, -18, 2)
      .fillCircle(61, -17, 3).fillCircle(89, -11, 2);
    this.objects.push(wakeShadow, waterFront);
    wakeShadow.setAlpha(0);
    waterFront.setAlpha(0);
    this.scene.tweens.add({ targets: [wakeShadow, waterFront], alpha: 1,
      duration: 500, delay: 100, ease: 'Sine.easeOut' });
    this.scene.tweens.add({ targets: waterFront, scaleX: { from: 0.92, to: 1.04 },
      scaleY: { from: 0.9, to: 1.05 }, duration: 1800, delay: 600,
      yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    // 待机：16 帧细微卷曲叠加慢摆，下部主体保持稳定
    // 程序补 —— 底枢 ±1.4° 慢摆（origin(0.5,1) = 底部锚定，顶部 ±~19px）
    if (this.sprite !== null) this.scene.tweens.add({
      targets: this.sprite,
      rotation: { from: -0.025, to: 0.025 },
      duration: 2600,
      delay: 1500,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
    // 静态阻挡体：占显示尺寸比例收窄（"一定程度"阻挡：贴边擦过、
    // 擦过最高尖端可过）；中央爆炸距双方基地 >2000px = 零伤害
    const bodyWidth = cfg.width * cfg.collisionWidthRatio;
    const bodyHeight = cfg.height * cfg.collisionHeightRatio;
    this.body = this.scene.matter.add.rectangle(
      cfg.x,
      cfg.baseY - bodyHeight / 2,
      bodyWidth,
      bodyHeight,
      {
        isStatic: true,
        label: 'octopus-tentacle',
        collisionFilter: {
          category: COLLISION_CATEGORY.OBSTACLE,
          mask: COLLISION_CATEGORY.PROJECTILE,
        },
      }
    );
  }

  private ensureAnim(): void {
    if (this.scene.anims.exists(OCTOPUS_ANIM_KEY)) {
      return;
    }
    this.scene.anims.create({
      key: OCTOPUS_ANIM_KEY,
      frames: this.scene.anims.generateFrameNumbers(ART.octopus, {
        start: 0,
        end: FRAME_COUNT - 1,
      }),
      frameRate: 8,
      repeat: -1,
    });
  }
}
