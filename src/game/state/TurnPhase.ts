/**
 * 回合阶段状态机。
 * Phase 1 仅定义；完整流程在 Phase 8 实现。
 */
export enum TurnPhase {
  START = 'START',
  ACTION = 'ACTION',
  RETURN_HOME = 'RETURN_HOME',
  AIM = 'AIM',
  AIRSTRIKE = 'AIRSTRIKE',
  PROJECTILE = 'PROJECTILE',
  RESOLVE = 'RESOLVE',
  END = 'END',
  GAME_OVER = 'GAME_OVER',
}
