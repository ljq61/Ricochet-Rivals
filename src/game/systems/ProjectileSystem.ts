import Phaser from 'phaser';
import { GAME_CONFIG } from '../config/GameConfig';
import type { FireCommand } from '../commands/GameCommand';
import { Projectile } from '../entities/Projectile';
import { stepFlight, simulationFrameBudget } from '../physics/flightSimulation';
import type { ItemChangeKind, ItemPickup, ShotContext } from '../state/ItemState';
import { ItemSystem, crateRect } from './ItemSystem';
import { sweptCircleRectTime } from '../physics/itemGeometry';
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
  private readonly groundBodies: MatterJS.BodyType[];
  private readonly playerBodies: Record<PlayerId, MatterJS.BodyType>;
  private nextId = 1;
  private authority = true;
  private accumulatorMs = 0;
  private readonly items = new ItemSystem();
  private readonly fullNotices = new Set<string>();

  constructor(scene: Phaser.Scene) {
    this.scene = scene;

    // 地面静态刚体（Projectile 的碰撞目标；视觉地面由 WorldBuilder 绘制）
    const { height, groundTopY, platformOverhang } = GAME_CONFIG.world;
    const groundHeight = height - groundTopY;
    this.groundBodies = [GAME_CONFIG.player.leftBounds, GAME_CONFIG.player.rightBounds].map(
      (bounds) => scene.matter.add.rectangle(
        (bounds.minX + bounds.maxX) / 2, groundTopY + groundHeight / 2,
        bounds.maxX - bounds.minX + platformOverhang * 2, groundHeight,
        { isStatic: true, label: GROUND_LABEL,
          collisionFilter: { category: COLLISION_CATEGORY.GROUND, mask: COLLISION_CATEGORY.PROJECTILE } },
      ),
    );

    // 玩家静态刚体（仅作为炮弹目标；位置每帧由 State 同步）
    const { width: pw, height: ph } = GAME_CONFIG.player.collision;
    this.playerBodies = {
      P1: this.createPlayerBody('P1', pw, ph),
      P2: this.createPlayerBody('P2', pw, ph),
    };
  }

  /** 当前活动投射物（Phase 6 相机跟随 / 调试读取） */
  get activeProjectiles(): readonly ProjectileState[] {
    return this.projectiles.map((p) => p.state);
  }

  /**
   * Phase 15 修复轮：desync 恢复入口清空在飞本地模拟炮弹。
   * 权威快照将整回合重述，在飞模拟已作废 —— 若保留，后台冻结的炮弹
   * 会在恢复完成后迟发 impact：相机被 focusImpact 打回 IMPACT，而
   * pendingTurnEnd 已消费 / 恢复期 TURN_END 被丢弃、无任何重试路径
   * → 相机永久滞留（E2E 全量三连复现：cam=IMPACT 而 phase=ACTION）。
   * 静默销毁（无爆炸、无 IMPACT/OUT_OF_BOUNDS 事件），副作用止于
   * 表现层；被恢复回合的权威伤害数字不补播（HUD 已随快照对齐）。
   */
  clearInFlightSimulations(): void {
    for (const projectile of this.projectiles) {
      projectile.destroyWithoutExplosion();
    }
    this.projectiles.length = 0;
    this.accumulatorMs = 0;
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
  launch(command: FireCommand, shot?: ShotContext): void {
    const id = `proj-${this.nextId}`;
    this.nextId += 1;
    const context = shot && !this.authority ? structuredClone(shot) : shot;
    const projectile = new Projectile(this.scene, id, command, context);
    this.accumulatorMs = 0;
    this.fullNotices.clear();
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

    // Long background pauses do not fast-forward gameplay. Ordinary low FPS frames
    // (<=250ms) retain their complete simulation duration in fixed 60Hz steps.
    const budget = simulationFrameBudget(this.accumulatorMs, deltaMs);
    this.accumulatorMs = budget.remainingMs;
    const stepMs = GAME_CONFIG.items.simulationStepMs;
    for (let step = 0; step < budget.steps; step++) {
      for (const projectile of [...this.projectiles]) {
        if (projectile.state.status !== 'flying') continue;
        const update = stepFlight(projectile.state, state, stepMs, projectile.shot);
        // The valid sweep already ends at the first solid/out-of-bounds contact.
        // Pickup at that endpoint is awarded before the termination event.
        for (const segment of update.segments) {
          const pickups = this.authority
            ? this.items.collectAlongSegment(state, projectile.state.ownerId, segment.from, segment.to) : [];
          for (const pickup of pickups) {
            this.events.emit('pickup', pickup);
            this.events.emit('item-changed', 'pickup', pickup.itemId);
          }
          if (state.players[projectile.state.ownerId].inventory.every((item) => item !== null)) {
            for (const item of state.items) {
              if (!this.fullNotices.has(item.id) && sweptCircleRectTime(segment.from, segment.to,
                  crateRect(item), GAME_CONFIG.projectile.radius) !== null) {
                this.fullNotices.add(item.id);
                this.events.emit('inventory-full', item.id);
              }
            }
          }
        }
        if (update.homingActivated) {
          projectile.showHomingLock();
          if (this.authority) this.events.emit('item-changed', 'homing', projectile.shot.itemId);
        }
        if (update.termination === 'out-of-bounds') {
          projectile.destroyWithoutExplosion();
          this.remove(projectile);
          this.events.emit(EVENT_OUT_OF_BOUNDS);
        } else if (update.termination === 'impact') {
          this.emitImpact(projectile);
          projectile.beginImpact();
        }
      }
    }
    for (const projectile of [...this.projectiles]) {
      projectile.tick(deltaMs);
      if (projectile.state.status === 'destroyed') this.remove(projectile);
    }
  }

  /** Guest simulation may render flight, but only Host writes public item state. */
  setAuthority(authority: boolean): void { this.authority = authority; }

  onInventoryFull(handler: (itemId: string) => void): () => void {
    this.events.on('inventory-full', handler);
    return () => this.events.off('inventory-full', handler);
  }

  onPickup(handler: (pickup: ItemPickup) => void): () => void {
    this.events.on('pickup', handler);
    return () => this.events.off('pickup', handler);
  }

  onItemChanged(handler: (kind: ItemChangeKind, itemId?: string) => void): () => void {
    this.events.on('item-changed', handler);
    return () => this.events.off('item-changed', handler);
  }

  destroy(): void {
    // 场景关闭链中 scene.matter.world 可能已置 null（SHUTDOWN 时序）——防御
    const world = this.scene.matter?.world;
    if (world) {
      for (const body of this.groundBodies) world.remove(body);
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

  private emitImpact(projectile: Projectile): void {
    const position = projectile.position;
    this.events.emit(EVENT_IMPACT, {
      x: position.x,
      y: position.y,
      ownerId: projectile.state.ownerId,
      weaponId: projectile.state.weaponId,
      turnId: projectile.turnId,
      itemType: projectile.shot.itemType,
    });
  }

  private remove(projectile: Projectile): void {
    const index = this.projectiles.indexOf(projectile);
    if (index >= 0) {
      this.projectiles.splice(index, 1);
    }
    projectile.destroy();
  }
}
