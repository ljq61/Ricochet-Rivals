import type { PlayerId, WeaponId } from './ids';

/**
 * 投射物逻辑状态（契约）。
 * velocity 单位与 GameConfig 一致：px/s。
 * State 不持有 Matter Body / Phaser 对象（渲染层经 id 关联）。
 */
export type ProjectileStatus =
  | 'spawn'
  | 'flying'
  | 'impact'
  | 'exploding'
  | 'destroyed';

export interface ProjectileState {
  id: string;
  ownerId: PlayerId;
  weaponId: WeaponId;
  x: number;
  y: number;
  velocityX: number;
  velocityY: number;
  status: ProjectileStatus;
  ageMs: number;
}
