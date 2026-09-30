import type { PlayerId, Side, WeaponId } from './ids';

/**
 * 玩家逻辑状态。
 *
 * 架构红线（见 CODELY.md / 验收标准 9）：
 * State 严禁持有 Phaser GameObject（Sprite / Matter Body / Camera / Scene）。
 * 渲染层通过 playerId 关联并读取 State。
 */
export interface PlayerState {
  id: PlayerId;
  side: Side;

  x: number;
  y: number;

  hp: number;
  maxHp: number;

  /** 旧联机快照兼容字段，固定为 0；不参与移动门禁。 */
  moveRemaining: number;

  /** 本回合是否已发射 */
  hasFired: boolean;

  isAlive: boolean;

  weaponId: WeaponId;
}
