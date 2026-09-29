import type { PlayerId } from './ids';
import type { ExplosionEvent } from './ExplosionEvent';

/**
 * 单个玩家受击结果（契约见 TASKS.md Core TypeScript Contracts）。
 * distance = 爆炸中心到玩家碰撞矩形的最近距离（内部为 0）（见 DamageSystem）。
 */
export interface PlayerDamageResult {
  playerId: PlayerId;
  distance: number;
  damage: number;
  hpBefore: number;
  hpAfter: number;
}

/** 一次爆炸的完整结算结果（UI 反馈 / Phase 8 TurnManager 消费） */
export interface DamageResult {
  explosion: ExplosionEvent;
  players: PlayerDamageResult[];
}
