/**
 * Camera 状态机模式（CODELY.md §8）。
 * Phase 1 仅实现 FREE_VIEW；其余模式在后续 Phase 激活。
 */
export enum CameraMode {
  FREE_VIEW = 'FREE_VIEW',
  RETURN_HOME = 'RETURN_HOME',
  AIMING = 'AIMING',
  PROJECTILE_FOLLOW = 'PROJECTILE_FOLLOW',
  IMPACT = 'IMPACT',
  TURN_TRANSITION = 'TURN_TRANSITION',
}
