import Phaser from 'phaser';
import { GAME_CONFIG } from '../config/GameConfig';
import type { FireCommand } from '../commands/GameCommand';
import { Projectile } from '../entities/Projectile';
import {
  isProjectileExpired,
  isProjectileOutOfBounds,
} from '../physics/projectileRules';
import { COLLISION_CATEGORY } from '../physics/collisionCategories';
import { MatterLib } from '../physics/matterRuntime';
import type { GameState } from '../state/GameState';
import type { ProjectileImpact } from '../state/ExplosionEvent';
import type { ProjectileState } from '../state/ProjectileState';
import { PLAYER_IDS, type PlayerId } from '../state/ids';

const GROUND_LABEL = 'ground';
const PLAYER_LABEL_PREFIX = 'player:';

const EVENT_LAUNCHED = 'launched';
const EVENT_IMPACT = 'impact';
const EVENT_OUT_OF_BOUNDS = 'out-of-bounds';

/**
 * 投射物系统（Phase 5）：
 * - 持有地面 / 玩家静态刚体（玩家刚体每帧跟随 PlayerState）
 * - launch：由 GameLogic 在 FireCommand 校验通过后调用
 * - 碰撞（地面 / 玩家）→ 爆炸；出界 → 直接销毁；超时 → 原地爆炸
 * - 不直接修改 Player HP（Phase 7 经 ExplosionEvent → DamageSystem）
 */
export class ProjectileSystem {
  private readonly scene: Phaser.Scene;
  private readonly events = new Phaser.Events.EventEmitter();
  private readonly projectiles: Projectile[] = [];
  private readonly groundBody: MatterJS.BodyType;
  private readonly playerBodies: Record<PlayerId, MatterJS.BodyType>;
  private nextId = 1;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;

    // 地面静态刚体（Projectile 的碰撞目标；视觉地面由 WorldBuilder 绘制）
    const { width, height, groundTopY } = GAME_CONFIG.world;
    const groundHeight = height - groundTopY;
    this.groundBody = scene.matter.add.rectangle(
      width / 2,
      groundTopY + groundHeight / 2,
      width,
      groundHeight,
      {
        isStatic: true,
        label: GROUND_LABEL,
        collisionFilter: {
          category: COLLISION_CATEGORY.GROUND,
          mask: COLLISION_CATEGORY.PROJECTILE,
        },
      }
    );

    // 玩家静态刚体（仅作为炮弹目标；位置每帧由 State 同步）
    const { width: pw, height: ph } = GAME_CONFIG.player.collision;
    this.playerBodies = {
      P1: this.createPlayerBody('P1', pw, ph),
      P2: this.createPlayerBody('P2', pw, ph),
    };

    scene.matter.world.on('collisionstart', this.onCollisionStart);
  }

  /** 当前活动投射物（Phase 6 相机跟随 / 调试读取） */
  get activeProjectiles(): readonly ProjectileState[] {
    return this.projectiles.map((p) => p.state);
  }

  // ---- 事件（相机 / Phase 8 TurnManager 消费） ----

  /** 炮弹生成并发射（所有输入源 FIRE 的统一汇聚点） */
  onLaunched(handler: (state: ProjectileState) => void): () => void {
    this.events.on(EVENT_LAUNCHED, handler);
    return () => this.events.off(EVENT_LAUNCHED, handler);
  }

  /** 碰撞 / 超时爆炸（payload：爆炸点 + 发射者 / 武器 / 回合上下文） */
  onImpact(handler: (impact: ProjectileImpact) => void): () => void {
    this.events.on(EVENT_IMPACT, handler);
    return () => this.events.off(EVENT_IMPACT, handler);
  }

  /** 飞出 World Bounds 销毁（无爆炸，攻击直接结束） */
  onOutOfBounds(handler: () => void): () => void {
    this.events.on(EVENT_OUT_OF_BOUNDS, handler);
    return () => this.events.off(EVENT_OUT_OF_BOUNDS, handler);
  }

  /** 生成并发射一颗 NORMAL 炮弹（AI / 网络 FIRE 同一入口） */
  launch(command: FireCommand): void {
    const id = `proj-${this.nextId}`;
    this.nextId += 1;
    const projectile = new Projectile(this.scene, id, command);
    this.projectiles.push(projectile);
    this.events.emit(EVENT_LAUNCHED, projectile.state);
  }

  update(state: GameState, deltaMs: number): void {
    // 玩家刚体跟随 PlayerState（x 为脚底，刚体取几何中心）
    const { height: bodyHeight } = GAME_CONFIG.player.collision;
    for (const playerId of PLAYER_IDS) {
      const player = state.players[playerId];
      MatterLib.Body.setPosition(this.playerBodies[playerId], {
        x: player.x,
        y: player.y - bodyHeight / 2,
      });
    }

    for (const projectile of [...this.projectiles]) {
      projectile.tick(deltaMs);
      const ps = projectile.state;

      if (ps.status === 'flying') {
        const { width, height } = GAME_CONFIG.world;
        if (isProjectileOutOfBounds(ps, width, height)) {
          // 掉出 World Bounds：直接销毁并结束当前攻击（无爆炸）
          projectile.destroyWithoutExplosion();
          this.remove(projectile);
          this.events.emit(EVENT_OUT_OF_BOUNDS);
          continue;
        }
        if (
          isProjectileExpired(ps.ageMs, GAME_CONFIG.physics.projectileLifetimeMs)
        ) {
          this.emitImpact(projectile);
          projectile.beginImpact();
        }
      } else if (ps.status === 'destroyed') {
        this.remove(projectile);
      }
    }
  }

  destroy(): void {
    // 场景关闭链中 scene.matter.world 可能已置 null（SHUTDOWN 时序）——防御
    const world = this.scene.matter?.world;
    if (world) {
      world.off('collisionstart', this.onCollisionStart);
      world.remove(this.groundBody);
      for (const playerId of PLAYER_IDS) {
        world.remove(this.playerBodies[playerId]);
      }
    }
    for (const projectile of this.projectiles) {
      projectile.destroy();
    }
    this.projectiles.length = 0;
    this.events.removeAllListeners();
  }

  private createPlayerBody(
    playerId: PlayerId,
    width: number,
    height: number
  ): MatterJS.BodyType {
    const spawnX = GAME_CONFIG.player.spawn[playerId];
    const body = this.scene.matter.add.rectangle(
      spawnX,
      GAME_CONFIG.world.groundTopY - height / 2,
      width,
      height,
      {
        isStatic: true,
        label: `${PLAYER_LABEL_PREFIX}${playerId}`,
        collisionFilter: {
          category: COLLISION_CATEGORY.PLAYER,
          mask: COLLISION_CATEGORY.PROJECTILE,
        },
      }
    );
    return body;
  }

  private readonly onCollisionStart = (event: {
    pairs: { bodyA: MatterJS.BodyType; bodyB: MatterJS.BodyType }[];
  }): void => {
    for (const pair of event.pairs) {
      const projectile =
        this.findProjectile(pair.bodyA) ?? this.findProjectile(pair.bodyB);
      if (projectile) {
        this.emitImpact(projectile);
        projectile.beginImpact();
      }
    }
  };

  private emitImpact(projectile: Projectile): void {
    const position = projectile.position;
    this.events.emit(EVENT_IMPACT, {
      x: position.x,
      y: position.y,
      ownerId: projectile.state.ownerId,
      weaponId: projectile.state.weaponId,
      turnId: projectile.turnId,
    });
  }

  private findProjectile(body: MatterJS.BodyType): Projectile | undefined {
    if (!body.label.startsWith('projectile:')) {
      return undefined;
    }
    const id = body.label.slice('projectile:'.length);
    return this.projectiles.find((p) => p.state.id === id);
  }

  private remove(projectile: Projectile): void {
    const index = this.projectiles.indexOf(projectile);
    if (index >= 0) {
      this.projectiles.splice(index, 1);
    }
    projectile.destroy();
  }
}
