/**
 * 投射物生存规则（纯函数，可单测）。
 * CODELY.md §14：掉出 World Bounds 直接销毁；超时爆炸。
 */

export interface ProjectilePosition {
  x: number;
  y: number;
}

/**
 * 出界判定：
 * - 左右越出 World（含 margin 容差）：销毁
 * - 低于地面以下（穿地兜底）：销毁
 * - 高于 World 顶不算出界——抛物线会自然回落
 */
export function isProjectileOutOfBounds(
  projectile: ProjectilePosition,
  worldWidth: number,
  worldHeight: number,
  margin = 60
): boolean {
  if (projectile.x < -margin || projectile.x > worldWidth + margin) {
    return true;
  }
  return projectile.y > worldHeight + margin;
}

/** 超时判定（ageMs >= lifetimeMs 时在原地爆炸） */
export function isProjectileExpired(
  ageMs: number,
  lifetimeMs: number
): boolean {
  return ageMs >= lifetimeMs;
}

/**
 * 引信判定：炮弹出生点在炮手碰撞体内，必须离开发射点足够远
 * 才激活与玩家的碰撞（避免发射瞬间自爆）。
 */
export function isProjectileArmed(
  projectile: ProjectilePosition,
  spawnX: number,
  spawnY: number,
  armDistance: number
): boolean {
  return (
    Math.hypot(projectile.x - spawnX, projectile.y - spawnY) >= armDistance
  );
}
