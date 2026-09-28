import Phaser from 'phaser';
import { GAME_CONFIG } from '../config/GameConfig';
import { playerColor } from '../config/Palette';
import type { FireCommand } from '../commands/GameCommand';
import { COLLISION_CATEGORY } from '../physics/collisionCategories';
import { MatterLib } from '../physics/matterRuntime';
import {
  isProjectileArmed,
} from '../physics/projectileRules';
import type { ProjectileState } from '../state/ProjectileState';
import type { TurnId } from '../state/ids';

/** Matter 固定步长 60Hz：速度单位 px/s → px/step 需除以 60 */
const MATTER_STEPS_PER_SECOND = 60;

const PROJECTILE_LABEL_PREFIX = 'projectile:';

/**
 * 投射物（Phase 5，V0.1 仅 NORMAL）。
 *
 * 组成：
 * - state：ProjectileState（纯数据，契约结构，velocity 单位 px/s）
 * - body：Matter 圆形刚体（frictionAir 0，保证弹道与预览一致）
 * - visual：Graphics 占位视觉
 *
 * 状态机（CODELY.md §14）：
 *   spawn → flying →（碰撞/超时）→ impact → exploding → destroyed
 * 出界：由 ProjectileSystem 判定并直接 destroy（无爆炸）。
 *
 * 引信：出生点在炮手碰撞体内，飞离发射点 armDistance 后
 * 才激活与玩家的碰撞（激活后永久保持，回落砸中发射者同样爆炸）。
 */
export class Projectile {
  readonly state: ProjectileState;
  /** 发射该炮弹的回合（FIRE 命令携带，Phase 7 爆炸事件需要） */
  readonly turnId: TurnId;

  private readonly scene: Phaser.Scene;
  private readonly body: MatterJS.BodyType;
  private readonly visual: Phaser.GameObjects.Graphics;
  private readonly spawnX: number;
  private readonly spawnY: number;
  private armed = false;
  private explodeElapsedMs = 0;

  constructor(scene: Phaser.Scene, id: string, command: FireCommand) {
    this.scene = scene;
    this.spawnX = command.startX;
    this.spawnY = command.startY;
    this.turnId = command.turnId;

    this.state = {
      id,
      ownerId: command.playerId,
      weaponId: command.weaponId,
      x: command.startX,
      y: command.startY,
      velocityX: command.velocityX,
      velocityY: command.velocityY,
      status: 'spawn',
      ageMs: 0,
    };

    const radius = GAME_CONFIG.projectile.radius;
    const color = playerColor(command.playerId);

    // 视觉（占位：本体 + 白描边）
    this.visual = scene.add.graphics().setDepth(500);
    this.visual.fillStyle(color, 1);
    this.visual.fillCircle(0, 0, radius);
    this.visual.lineStyle(2, 0xffffff, 0.9);
    this.visual.strokeCircle(0, 0, radius);
    this.visual.setPosition(command.startX, command.startY);

    // 物理刚体：无空气阻力，弹道与 TrajectoryCalculator 一致；
    // 引信未激活前只与地面碰撞（出生点在炮手碰撞体内）
    this.body = scene.matter.add.circle(command.startX, command.startY, radius, {
      label: `${PROJECTILE_LABEL_PREFIX}${id}`,
      frictionAir: 0,
      friction: 0,
      restitution: 0,
      collisionFilter: {
        category: COLLISION_CATEGORY.PROJECTILE,
        mask: COLLISION_CATEGORY.GROUND,
      },
    });

    // px/s → px/step
    MatterLib.Body.setVelocity(this.body, {
      x: command.velocityX / MATTER_STEPS_PER_SECOND,
      y: command.velocityY / MATTER_STEPS_PER_SECOND,
    });

    this.state.status = 'flying';
  }

  /** 每帧同步（仅 FLYING 推进；EXPLODING 播放占位爆炸动画） */
  tick(deltaMs: number): void {
    if (this.state.status === 'flying') {
      this.state.ageMs += deltaMs;

      // Matter body.velocity 单位为 px/step → 换算回 px/s 存入 State
      this.state.x = this.body.position.x;
      this.state.y = this.body.position.y;
      this.state.velocityX = this.body.velocity.x * MATTER_STEPS_PER_SECOND;
      this.state.velocityY = this.body.velocity.y * MATTER_STEPS_PER_SECOND;

      this.visual.setPosition(this.state.x, this.state.y);
      this.visual.rotation = this.body.angle;

      // 引信：离开发射点后激活玩家碰撞（激活后保持）
      if (!this.armed && isProjectileArmed(this.state, this.spawnX, this.spawnY, GAME_CONFIG.projectile.playerCollisionArmDistance)) {
        this.armed = true;
        this.body.collisionFilter = {
          category: COLLISION_CATEGORY.PROJECTILE,
          mask: COLLISION_CATEGORY.GROUND | COLLISION_CATEGORY.PLAYER,
          group: 0,
        };
      }
    } else if (this.state.status === 'exploding') {
      this.explodeElapsedMs += deltaMs;
      const progress = Math.min(
        1,
        this.explodeElapsedMs / GAME_CONFIG.projectile.explodeDurationMs
      );
      // 占位爆炸：本体快速扩大并淡出
      const scale = 1 + progress * 2.2;
      this.visual.setScale(scale);
      this.visual.setAlpha(1 - progress);
      if (progress >= 1) {
        this.state.status = 'destroyed';
      }
    }
  }

  /** 刚体实时位置（碰撞瞬间读取，比每帧同步的 state 更新） */
  get position(): { x: number; y: number } {
    return { x: this.body.position.x, y: this.body.position.y };
  }

  /** 碰撞 / 超时：IMPACT → EXPLODING（移除刚体，播放占位爆炸） */
  beginImpact(): void {
    if (this.state.status !== 'flying') {
      return;
    }
    // 爆炸点吸附到刚体实时位置（state 上帧同步值最多落后一帧）
    this.state.x = this.body.position.x;
    this.state.y = this.body.position.y;
    this.visual.setPosition(this.state.x, this.state.y);

    this.state.status = 'impact';
    this.scene.matter.world.remove(this.body);
    this.state.status = 'exploding';
    this.explodeElapsedMs = 0;

    // 爆炸视觉：白色扩散圈 + 本体淡出
    this.visual.clear();
    const radius = GAME_CONFIG.projectile.radius;
    this.visual.lineStyle(3, 0xffd24a, 0.95);
    this.visual.strokeCircle(0, 0, radius + 10);
    this.visual.fillStyle(0xffffff, 0.55);
    this.visual.fillCircle(0, 0, radius + 6);

    // 爆炸范围圈（Phase 7 反馈）：真实伤害半径（explosion.radius）的
    // 提示环，扩散淡出后销毁 —— 与本体扩散动画相互独立
    const ring = this.scene.add.graphics().setDepth(490);
    ring.setPosition(this.state.x, this.state.y);
    ring.lineStyle(4, 0xff5063, 0.55);
    ring.strokeCircle(0, 0, GAME_CONFIG.explosion.radius);
    ring.fillStyle(0xff5063, 0.08);
    ring.fillCircle(0, 0, GAME_CONFIG.explosion.radius);
    this.scene.tweens.add({
      targets: ring,
      alpha: 0,
      scale: 1.35,
      duration: GAME_CONFIG.projectile.explodeDurationMs * 2,
      ease: 'Sine.easeOut',
      onComplete: () => ring.destroy(),
    });
  }

  /** 出界：直接销毁，不播放爆炸（CODELY.md §14） */
  destroyWithoutExplosion(): void {
    this.state.status = 'destroyed';
    this.scene.matter.world.remove(this.body);
    this.visual.destroy();
  }

  /** 资源清理（系统统一调用） */
  destroy(): void {
    // 场景关闭链中 scene.matter.world 可能已置 null（SHUTDOWN 时序）——防御
    const world = this.scene.matter?.world;
    if (world && this.state.status !== 'destroyed') {
      world.remove(this.body);
    }
    this.visual.destroy();
  }
}
