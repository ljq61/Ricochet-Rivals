/**
 * 对局模式（Phase 11）。
 * 单一来源：菜单选择 → MatchSetup → BattleScene 消费；
 * Gameplay Systems 不感知模式本身，只看 PlayerController 组合。
 */
export type GameMode = 'single_player' | 'local_2p' | 'online';
