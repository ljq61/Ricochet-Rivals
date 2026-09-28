/**
 * 全局共享 ID 与基础类型定义。
 * 该文件不依赖任何其他模块（避免循环依赖）。
 */

export type PlayerId = 'P1' | 'P2';

export type MatchId = string;

export type TurnId = number;

/** V0.1 只有 normal；未来扩展 split / heavy / bounce */
export type WeaponId = 'normal';

/** V0.1 只定义 Item 类型，不实现 Gameplay（见 CODELY.md §17） */
export type WorldItemType = 'heal' | 'damage_boost' | 'split' | 'shield';

/** 玩家阵营 */
export type Side = 'left' | 'right';

export const PLAYER_IDS: readonly PlayerId[] = ['P1', 'P2'] as const;
