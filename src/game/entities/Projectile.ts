import Phaser from 'phaser';
import { ProjectileEffects } from './ProjectileEffects';
import { GAME_CONFIG } from '../config/GameConfig';
import { ART } from '../config/ArtAssets';
import { playerColor } from '../config/Palette';
import type { FireCommand } from '../commands/GameCommand';
import { COLLISION_CATEGORY } from '../physics/collisionCategories';
import { MatterLib } from '../physics/matterRuntime';
import { createFlightState, type FlightState } from '../physics/flightSimulation';
import type { ShotContext } from '../state/ItemState';
import type { TurnId } from '../state/ids';
import { SfxBus, SFX } from '../audio/SfxBus';

const PROJECTILE_LABEL_PREFIX = 'projectile:';
/**
 * 素材显示尺寸：画布 1254px、炮弹内容仅 456px 宽（scripts/measure-art.mjs
 * 实测）→ 165 显示尺寸使可见炮弹约 60 世界 px（≈2× 碰撞直径 32，Q 版
 * 角色比例下可读；修复轮前为 64 → 可见仅 ~23px，比命中判定还小）。
 */
const PROJECTILE_ART_SIZE = 165;

/**
 * 投射物（Phase 5，V0.1 仅 NORMAL）。
 *
 * 组成：
 * - state：ProjectileState（纯数据，契约结构，velocity 单位 px/s）
 * - body：Matter 静态 sensor 代理；推进和连续碰撞由纯固定步适配器负责
 * - visual：像素美术资源，缺失时回退 Graphics 占位视觉
 *
 * 状态机（CODELY.md §14）：
 *   spawn → flying →（碰撞/超时）→ impact → exploding → destroyed
 * 出界：由 ProjectileSystem 判定并直接 destroy（无爆炸）。
 *
 * 引信：出生点在炮手碰撞体内，飞离发射点 armDistance 后
 * 才激活与玩家的碰撞（激活后永久保持，回落砸中发射者同样爆炸）。
 */
export class Projectile {
  readonly state: FlightState;
  readonly shot: ShotContext;
  /** 发射该炮弹的回合（FIRE 命令携带，Phase 7 爆炸事件需要） */
  readonly turnId: TurnId;

  private readonly scene: Phaser.Scene;
  private readonly effects: ProjectileEffects;
  private readonly body: MatterJS.BodyType;
  private readonly visual: Phaser.GameObjects.Image | Phaser.GameObjects.Graphics;
  private readonly usesProjectileArt: boolean;

  private explodeElapsedMs = 0;
  private stopHomingSound: (() => void) | null = null;

  constructor(scene: Phaser.Scene, id: string, command: FireCommand, shot?: ShotContext) {
    this.scene = scene;
    this.effects = new ProjectileEffects(scene);
    this.turnId = command.turnId;

    this.state = createFlightState(command, id);
    this.shot = shot ?? { ownerId: command.playerId, turnId: command.turnId, homingActivated: false };

    const radius = GAME_CONFIG.projectile.radius;
    const color = playerColor(command.playerId);

    // 视觉：优先使用 Phase 17 像素榴弹，资源缺失时保留原占位表现。
    this.usesProjectileArt = scene.textures.exists(ART.projectile);
    if (this.usesProjectileArt) {
      this.visual = scene.add.image(command.startX, command.startY, ART.projectile)
        .setOrigin(0.5)
        .setDisplaySize(PROJECTILE_ART_SIZE, PROJECTILE_ART_SIZE)
        .setDepth(500);
    } else {
      const fallback = scene.add.graphics().setDepth(500);
      fallback.fillStyle(color, 1);
      fallback.fillCircle(0, 0, radius);
      fallback.lineStyle(2, 0xffffff, 0.9);
      fallback.strokeCircle(0, 0, radius);
      fallback.setPosition(command.startX, command.startY);
      this.visual = fallback;
    }

    // Passive Matter proxy: the fixed-step adapter owns movement, fuse and sweeps.
    this.body = scene.matter.add.circle(command.startX, command.startY, radius, {
      label: `${PROJECTILE_LABEL_PREFIX}${id}`,
      isStatic: true,
      isSensor: true,
      frictionAir: 0,
      friction: 0,
      restitution: 0,
      collisionFilter: {
        category: COLLISION_CATEGORY.PROJECTILE,
        mask: 0,
      },
    });

    this.state.status = 'flying';
  }

  /** 每帧同步（仅 FLYING 推进；EXPLODING 播放占位爆炸动画） */
  tick(deltaMs: number): void {
    if (this.state.status === 'flying') {
      // Pure fixed-step simulation has already updated the state. Matter body is
      // a passive debug proxy and cannot integrate or create a second collision.
      MatterLib.Body.setPosition(this.body, { x: this.state.x, y: this.state.y });
      this.visual.setPosition(this.state.x, this.state.y);
      this.effects.update(this.state.x, this.state.y, this.state.velocityX, this.state.velocityY, deltaMs);
      if (this.usesProjectileArt) {
        // 资源喷嘴端默认朝右：弹头（圆端）朝飞行方向 → 速度角 +180°，
        // 喷嘴拖尾（真机反馈：喷嘴在前 = 双方头尾反了）
        this.visual.setRotation(
          Math.atan2(this.state.velocityY, this.state.velocityX) + Math.PI
        );
      } else {
        this.visual.rotation = this.body.angle;
      }

    } else if (this.state.status === 'exploding') {
      this.explodeElapsedMs += deltaMs;
      const progress = Math.min(
        1,
        this.explodeElapsedMs / GAME_CONFIG.projectile.explodeDurationMs
      );
      // 占位爆炸（仅 Graphics 回退路径）：本体快速扩大并淡出。
      // 美术路径弹体在 beginImpact 已隐藏 —— 爆炸视觉归 explosion 图层，
      // 弹体不得随爆炸放大重现（真机反馈修正）
      if (!this.usesProjectileArt) {
        const scale = 1 + progress * 2.2;
        this.visual.setScale(scale);
        this.visual.setAlpha(1 - progress);
      }
      if (progress >= 1) {
        this.state.status = 'destroyed';
      }
    }
  }

  showHomingLock(): void {
    if (this.state.status !== 'flying' || this.shot.itemType !== 'homing' || !this.shot.homingActivated) return;
    this.stopHomingSound ??= new SfxBus(this.scene).loop(SFX.itemHoming);
    if (this.usesProjectileArt) (this.visual as Phaser.GameObjects.Image).setTint(0x8bf2ed);
  }

  /** Latest simulated position, including contact-clipped endpoints. */
  get position(): { x: number; y: number } {
    return { x: this.state.x, y: this.state.y };
  }

  /** 碰撞 / 超时：IMPACT → EXPLODING（移除刚体，播放占位爆炸） */
  beginImpact(): void {
    if (this.state.status !== 'flying') {
      return;
    }
    this.stopHomingSound?.();
    // The sweep has clipped state to the exact first contact position.
    this.visual.setPosition(this.state.x, this.state.y);

    this.state.status = 'impact';
    this.scene.matter.world.remove(this.body);
    this.state.status = 'exploding';
    this.explodeElapsedMs = 0;

    // 爆炸视觉：优先显示像素爆炸资源；缺失时回退原有范围圈。
    if (this.usesProjectileArt) {
      this.visual.setVisible(false); // 弹体即隐：爆炸视觉归 explosion 图层
    } else {
      const fallback = this.visual as Phaser.GameObjects.Graphics;
      const radius = GAME_CONFIG.projectile.radius;
      fallback.clear();
      fallback.lineStyle(3, 0xffd24a, 0.95);
      fallback.strokeCircle(0, 0, radius + 10);
      fallback.fillStyle(0xffffff, 0.55);
      fallback.fillCircle(0, 0, radius + 6);
    }

    this.effects.impact(this.state.x, this.state.y, this.shot.itemType === 'range_boost'
      ? GAME_CONFIG.items.boostedRadius.splash : GAME_CONFIG.explosion.radius);
  }

  /** 出界：直接销毁，不播放爆炸（CODELY.md §14） */
  destroyWithoutExplosion(): void {
    this.stopHomingSound?.();
    this.state.status = 'destroyed';
    this.scene.matter.world.remove(this.body);
    this.effects.finish();
    this.visual.destroy();
  }

  /** 资源清理（系统统一调用） */
  destroy(): void {
    this.stopHomingSound?.();
    // 场景关闭链中 scene.matter.world 可能已置 null（SHUTDOWN 时序）——防御
    const world = this.scene.matter?.world;
    if (world && this.state.status !== 'destroyed') {
      world.remove(this.body);
    }
    this.effects.finish();
    this.visual.destroy();
  }
}
