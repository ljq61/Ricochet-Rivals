import Phaser from 'phaser';
import { ART } from '../config/ArtAssets';
import { GAME_CONFIG } from '../config/GameConfig';
import { hpToBaseDamageTier } from './baseDamageTier';
import { baseDockGeometry } from './WorldBuilder';
import type { PlayerId } from '../state/ids';
import type { PlayerState } from '../state/PlayerState';

/**
 * 基地受损表现（Phase 17 juice）：HP 越低烟雾/火势越重——
 * 轻烟 → 浓烟 → 烟+小火 → 大火大烟（档位阈值见 GameConfig.baseDamageFx）。
 *
 * 场景级反馈系统（同 PlayerHud 模式）：每帧从 PlayerState 刷新，
 * 幂等换档（档位不变时零开销；换档时按新档重建烟发射器/火精灵，
 * 每局至多 8 次）。火焰 = 大小火各 8 帧循环 sheet 的逐帧动画精灵
 * （错帧 + 随机翻转移除同拍感；sheet 缺失回退 fx-spark 粒子火苗）。
 * 纯视觉：不改任何 GameState，不感知网络；粒子/精灵由 Phaser 随场景
 * SHUTDOWN 自动销毁（同 ProjectileEffects 约定）。
 */

/** 单团火焰布点：offset = 距基地中心横向比例；heightRatio = 高度占比 */
interface FlameSpec {
  readonly offset: number;
  readonly heightRatio: number;
  readonly rise: number;
  readonly size: 'small' | 'large';
}

/** 每档发射调参（纯视觉；索引 = 档位 0~4） */
interface TierParams {
  /** 冒烟间隔（ms，0 = 不冒烟） */
  readonly smokeEveryMs: number;
  readonly smokeScaleStart: number;
  readonly smokeScaleEnd: number;
  readonly smokeAlpha: number;
  /** 火焰布点（null = 该档无火） */
  readonly flames: ReadonlyArray<FlameSpec> | null;
}

const TIER_PARAMS: readonly TierParams[] = [
  { smokeEveryMs: 0, smokeScaleStart: 0, smokeScaleEnd: 0, smokeAlpha: 0, flames: null },
  { smokeEveryMs: 950, smokeScaleStart: 0.03, smokeScaleEnd: 0.1, smokeAlpha: 0.34, flames: null },
  { smokeEveryMs: 520, smokeScaleStart: 0.04, smokeScaleEnd: 0.14, smokeAlpha: 0.46, flames: null },
  {
    smokeEveryMs: 360, smokeScaleStart: 0.05, smokeScaleEnd: 0.16, smokeAlpha: 0.5,
    flames: [
      { offset: -0.21, rise: 0.31, heightRatio: 0.09, size: 'small' },
      { offset: 0.11, rise: 0.38, heightRatio: 0.08, size: 'small' },
      { offset: 0.22, rise: 0.14, heightRatio: 0.07, size: 'small' },
    ],
  },
  {
    smokeEveryMs: 220, smokeScaleStart: 0.06, smokeScaleEnd: 0.2, smokeAlpha: 0.58,
    flames: [
      { offset: -0.21, rise: 0.31, heightRatio: 0.15, size: 'large' },
      { offset: 0.11, rise: 0.38, heightRatio: 0.13, size: 'large' },
      { offset: 0.22, rise: 0.14, heightRatio: 0.12, size: 'large' },
      { offset: -0.27, rise: 0.1, heightRatio: 0.08, size: 'small' },
      { offset: -0.02, rise: 0.07, heightRatio: 0.09, size: 'small' },
    ],
  },
];

/** 基地火焰动画（大小火各 8 帧循环；anims 全局注册，场景重启不重复建） */
const FIRE_ANIM_KEY = 'fx-base-fire-loop';
const LOOP_FRAME_COUNT = 8;

type Emitter = Phaser.GameObjects.Particles.ParticleEmitter;

export class BaseDamageEffects {
  private readonly tiers: Record<PlayerId, number> = { P1: 0, P2: 0 };
  private readonly smoke: Record<PlayerId, Emitter | null> = { P1: null, P2: null };
  /** 回退路径：火焰 sheet 缺失时的 fx-spark 粒子火苗 */
  private readonly fire: Record<PlayerId, Emitter | null> = { P1: null, P2: null };
  private readonly fireSprites: Record<PlayerId, Phaser.GameObjects.Sprite[]> = {
    P1: [],
    P2: [],
  };

  constructor(private readonly scene: Phaser.Scene) {
    // 火苗回退纹理（与 ProjectileEffects 同款守卫，先建先用、幂等）
    if (!scene.textures.exists('fx-spark')) {
      const g = scene.make.graphics({ x: 0, y: 0 });
      g.fillStyle(0xffffff).fillRect(2, 0, 4, 8).fillRect(0, 2, 8, 4);
      g.generateTexture('fx-spark', 8, 8);
      g.destroy();
    }
  }

  /** 每帧幂等刷新（State 是唯一数据源；换档时才重建发射器/精灵） */
  refresh(players: Record<PlayerId, PlayerState>): void {
    for (const id of ['P1', 'P2'] as const) {
      this.setTier(id, hpToBaseDamageTier(players[id].hp));
    }
  }

  /** 当前档位（debug / E2E 观测口） */
  tierOf(id: PlayerId): number {
    return this.tiers[id];
  }

  private setTier(id: PlayerId, tier: number): void {
    if (this.tiers[id] === tier) {
      return;
    }
    this.tiers[id] = tier;
    this.smoke[id]?.destroy();
    this.fire[id]?.destroy();
    this.smoke[id] = null;
    this.fire[id] = null;
    for (const sprite of this.fireSprites[id]) {
      sprite.destroy();
    }
    this.fireSprites[id] = [];
    const params = TIER_PARAMS[tier];
    if (!params || params.smokeEveryMs <= 0) {
      return;
    }

    const { center, dockWidth } = baseDockGeometry(id);
    const deckTopY = GAME_CONFIG.world.groundTopY;
    const smokeTexture = this.scene.textures.exists(ART.smoke) ? ART.smoke : 'fx-spark';
    // 烟从基地结构上部升腾（横向铺开、慢速上飘、渐大渐淡）
    this.smoke[id] = this.scene.add.particles(0, 0, smokeTexture, {
      emitting: true,
      frequency: params.smokeEveryMs,
      quantity: 1,
      x: { min: center - dockWidth * 0.24, max: center + dockWidth * 0.24 },
      y: { min: deckTopY - dockWidth * 0.38, max: deckTopY - dockWidth * 0.1 },
      lifespan: { min: 1700, max: 2900 },
      speedX: { min: -16, max: 16 },
      speedY: { min: -58, max: -26 },
      scale: { start: params.smokeScaleStart, end: params.smokeScaleEnd },
      alpha: { start: params.smokeAlpha, end: 0 },
      rotate: { min: 0, max: 360 },
    }).setDepth(-16);

    if (params.flames) {
      if (this.ensureFireAnim()) {
        this.spawnFlames(id, center, dockWidth, params.flames);
      } else {
        this.spawnLegacyFireEmitter(id, center, dockWidth);
      }
    }
  }

  /** 注册（一次）并确认火焰 sheet 可用 */
  private ensureFireAnim(): boolean {
    if (!this.scene.textures.exists(ART.baseFire)) {
      return false;
    }
    for (const size of ['small', 'large'] as const) {
      const key = `${FIRE_ANIM_KEY}-${size}`;
      if (this.scene.anims.exists(key)) continue;
      const start = size === 'small' ? 0 : 8;
      this.scene.anims.create({
        key,
        frames: this.scene.anims.generateFrameNumbers(ART.baseFire, { start, end: start + 7 }),
        frameRate: size === 'small' ? 12 : 10,
        repeat: -1,
      });
    }
    return true;
  }

  /** 火焰 sheet 精灵：贴结构中上部窜动（错帧 + 随机翻转移除同拍感） */
  private spawnFlames(
    id: PlayerId,
    center: number,
    dockWidth: number,
    flames: ReadonlyArray<FlameSpec>
  ): void {
    const deckTopY = GAME_CONFIG.world.groundTopY;
    this.fireSprites[id] = flames.map((flame, index) => {
      const height = dockWidth * flame.heightRatio;
      const sprite = this.scene.add
        .sprite(
          center + flame.offset * dockWidth,
          deckTopY - dockWidth * flame.rise,
          ART.baseFire, flame.size === 'small' ? 0 : 8
        )
        .setOrigin(0.5, flame.size === 'small' ? 0.9 : 0.94)
        .setDisplaySize(height, height)
        .setDepth(-15);
      if (index % 3 === 1) {
        sprite.setFlipX(true);
      }
      sprite.play({
        key: `${FIRE_ANIM_KEY}-${flame.size}`,
        startFrame: (index * 3) % LOOP_FRAME_COUNT,
      });
      sprite.anims.timeScale = 0.9 + (index % 3) * 0.12;
      return sprite;
    });
  }

  /** 火焰 sheet 缺失时的回退：fx-spark 粒子火苗（旧版观感） */
  private spawnLegacyFireEmitter(id: PlayerId, center: number, dockWidth: number): void {
    const deckTopY = GAME_CONFIG.world.groundTopY;
    this.fire[id] = this.scene.add.particles(0, 0, 'fx-spark', {
      emitting: true,
      frequency: 200,
      quantity: 2,
      x: { min: center - dockWidth * 0.22, max: center + dockWidth * 0.22 },
      y: deckTopY - dockWidth * 0.35,
      lifespan: { min: 170, max: 400 },
      speedX: { min: -22, max: 22 },
      speedY: { min: -120, max: -45 },
      scale: { start: 1.8, end: 0.15 },
      alpha: { start: 0.95, end: 0 },
      color: [0xfff8cc, 0xffd14a, 0xff792b, 0xa83924],
    }).setDepth(-15);
  }
}
