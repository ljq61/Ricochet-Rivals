import Phaser from 'phaser';
import { ART, SHEET_GRID } from '../config/ArtAssets';
import { GAME_CONFIG } from '../config/GameConfig';
import { COLLISION_CATEGORY } from '../physics/collisionCategories';
import { TurnPhase, type GameState } from '../state/GameState';
import { isOctopusActive } from '../state/OctopusState';
import type { PlayerId } from '../state/ids';

const OCTOPUS_ANIM_KEY = 'fx-octopus-idle-loop';
const FRAME_COUNT = SHEET_GRID.cols * SHEET_GRID.rows;

/** State-driven obstacle and laser presentation. HP and damage belong to the resolver. */
export class OctopusTentacle {
  private active = false;
  private body: MatterJS.BodyType | null = null;
  private objects: Phaser.GameObjects.GameObject[] = [];
  private sprite: Phaser.GameObjects.Sprite | null = null;
  private healthBar: Phaser.GameObjects.Graphics | null = null;
  private lastShownAttackTurn = 0;
  private laserHit = true;
  private laserTween: Phaser.Tweens.Tween | null = null;
  private finishLaser: (() => void) | null = null;
  private idlePromise: Promise<void> = Promise.resolve();
  private phase: 'idle' | 'charging' | 'sweeping' = 'idle';

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly onLaserHit: (target: PlayerId) => void = () => {},
    private readonly onLaserFocus: (x: number, y: number) => void = () => {},
  ) {}

  get isActive(): boolean { return this.active; }
  get attackPhase(): string { return this.phase; }
  get isAttacking(): boolean { return this.phase !== 'idle'; }

  hasPendingLaserHit(state: GameState): boolean {
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
      this.playLaser(turn, target, state);
    }
  }

  whenIdle(): Promise<void> { return this.idlePromise; }

  /** Recovery shows the restored state without replaying historical attacks. */
  restore(state: GameState): void {
    this.cancelLaser();
    this.lastShownAttackTurn = state.octopus.lastAttackTurnId ?? 0;
    this.syncObstacle(state);
  }

  destroy(): void {
    this.cancelLaser();
    this.removeObstacle();
  }

  private syncObstacle(state: GameState): void {
    if (!isOctopusActive(state.octopus)) {
      this.removeObstacle();
      return;
    }
    if (!this.active) this.activate();
    const cfg = GAME_CONFIG.octopus;
    const bar = this.healthBar!;
    bar.clear().fillStyle(0x10172c, 0.9).fillRoundedRect(-117, -14, 234, 28, 10);
    for (let i = 0; i < cfg.maxHp; i++) {
      bar.fillStyle(i < state.octopus.hp ? 0xe970cf : 0x4a405d, 1)
        .fillRoundedRect(-109 + i * 22, -7, 19, 14, 3);
    }
  }

  private removeObstacle(): void {
    // Matter's SHUTDOWN listener may already have cleared the scene world.
    const world = this.scene.matter?.world;
    if (this.body !== null && world) world.remove(this.body);
    this.body = null;
    for (const object of this.objects) {
      this.scene.tweens.killTweensOf(object);
      object.destroy();
    }
    this.objects = [];
    this.sprite = null;
    this.healthBar = null;
    this.active = false;
  }

  private cancelLaser(): void {
    this.laserTween?.stop();
    this.laserTween = null;
    this.finishLaser?.();
    this.finishLaser = null;
    this.laserHit = true;
    this.phase = 'idle';
  }

  private playLaser(turn: number, target: PlayerId, state: GameState): void {
    this.lastShownAttackTurn = turn;
    this.laserHit = false;
    this.phase = 'charging';
    const cfg = GAME_CONFIG.octopus;
    const targetX = state.players[target].x;
    const targetY = state.players[target].y - 65;
    const fx = this.scene.add.graphics().setDepth(870).setName('octopus-laser');
    const progress = { elapsed: 0 };
    this.idlePromise = new Promise<void>((resolve) => {
      this.finishLaser = () => { fx.destroy(); resolve(); };
    });
    const draw = (): void => {
      const rotation = this.sprite?.rotation ?? 0;
      const tipX = cfg.x + 65 + Math.sin(rotation) * cfg.height;
      const tipY = cfg.baseY - Math.cos(rotation) * cfg.height + 40;
      const t = progress.elapsed;
      fx.clear();
      if (t < cfg.chargeDurationMs) {
        const q = t / cfg.chargeDurationMs;
        fx.fillStyle(0xb848ef, 0.16 + q * 0.25).fillCircle(tipX, tipY, 18 + q * 44);
        fx.lineStyle(3, 0xf296fa, 0.9).strokeCircle(tipX, tipY, 65 - q * 47);
        fx.fillStyle(0xe890ff, 1).fillCircle(tipX, tipY, 8 + q * 14);
        fx.fillStyle(0xffffff, q).fillCircle(tipX, tipY, 4 + q * 8);
        for (let i = 0; i < 6; i++) {
          const angle = i * Math.PI / 3 + q * 2;
          const radius = 100 * (1 - q) + 20;
          fx.fillCircle(tipX + Math.cos(angle) * radius, tipY + Math.sin(angle) * radius, 3);
        }
      } else {
        if (this.phase === 'charging') {
          this.phase = 'sweeping';
          this.onLaserFocus(targetX, targetY);
        }
        const q = Math.min(1, (t - cfg.chargeDurationMs) / cfg.sweepDurationMs);
        const endX = targetX + (q - 0.5) * 400;
        const endY = targetY + (q - 0.5) * 80;
        const alpha = Math.min(1, (1 - q) * 6);
        fx.lineStyle(40, 0xb749ec, 0.2 * alpha).lineBetween(tipX, tipY, endX, endY);
        fx.lineStyle(15, 0xf480ff, 0.6 * alpha).lineBetween(tipX, tipY, endX, endY);
        fx.lineStyle(4, 0xffffff, alpha).lineBetween(tipX, tipY, endX, endY);
        fx.fillStyle(0xffffff, alpha).fillCircle(tipX, tipY, 15);
        fx.fillStyle(0xeb8fff, alpha).fillCircle(endX, endY, 25);
        if (q >= 0.5 && !this.laserHit) {
          this.laserHit = true;
          this.onLaserHit(target);
        }
      }
    };
    this.onLaserFocus(cfg.x, cfg.baseY - cfg.height / 2);
    draw();
    this.laserTween = this.scene.tweens.add({ targets: progress,
      elapsed: cfg.chargeDurationMs + cfg.sweepDurationMs,
      duration: cfg.chargeDurationMs + cfg.sweepDurationMs,
      onUpdate: draw,
      onComplete: () => {
        this.phase = 'idle';
        this.laserTween = null;
        this.finishLaser?.();
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
      const fallback = this.scene.add.graphics().setDepth(-6);
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
