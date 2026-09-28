/**
 * Matter 碰撞分类（TASKS Phase 5：统一 collision categories）。
 *
 * 碰撞规则：碰撞发生当且仅当 A.mask ∩ B.category 且 B.mask ∩ A.category。
 * - 炮弹：撞 地面 / 玩家
 * - 玩家刚体：只作为炮弹目标（与地面互不碰撞，玩家由 MovementSystem 驱动）
 */
export const COLLISION_CATEGORY = {
  GROUND: 0x0001,
  PLAYER: 0x0002,
  PROJECTILE: 0x0004,
} as const;
