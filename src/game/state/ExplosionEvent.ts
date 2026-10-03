import type { ShotContext } from './ItemState';
import type { PlayerId, TurnId, WeaponId } from './ids';

/**
 * 投射物碰撞 / 超时爆炸时携带的完整上下文。
 * 由 ProjectileSystem 在爆炸点产生，消费方：
 * - CameraController（IMPACT 聚焦爆炸点）
 * - ExplosionSystem（构建 ExplosionEvent → DamageSystem）
 */
export interface ProjectileImpact {
  /** 爆炸点（刚体实时位置，世界坐标） */
  x: number;
  y: number;
  /** 发射者 */
  ownerId: PlayerId;
  weaponId: WeaponId;
  /** 发射该炮弹时的回合（FIRE 命令携带） */
  turnId: TurnId;
  itemType?: ShotContext['itemType'];
}

/**
 * 爆炸事件（Phase 7，契约见 TASKS.md Core TypeScript Contracts）。
 *
 * 流程红线（CODELY.md §15）：Projectile 不直接修改 Player HP，
 * 必须经 ExplosionEvent → DamageSystem → DamageResult → GameState。
 * 未来扩展 Shield / Poison / Critical / Armor 只改 DamageSystem。
 */
export interface ExplosionEvent {
  sourcePlayerId: PlayerId;
  weaponId: WeaponId;
  x: number;
  y: number;
  radius: number;
  turnId: TurnId;
  itemType?: ShotContext['itemType'];
}
