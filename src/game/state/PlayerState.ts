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

  /** 本回合剩余可移动距离（px），按实际移动累计消耗 */
  moveRemaining: number;

  /** 本回合是否已发射 */
  hasFired: boolean;

  isAlive: boolean;

  weaponId: WeaponId;
}
