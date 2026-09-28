import type { AIDifficulty } from '../config/GameConfig';
import type { GameMode } from './GameMode';

/**
 * 每个玩家由谁控制（Phase 11 InputSource 组合契约）。
 * human → DesktopControls / TouchControls（本地人类）
 * ai    → AIInputSource（Phase 10）
 * network → NetworkInputSource（Phase 12+，本阶段仅契约占位）
 */
export type PlayerController = 'human' | 'ai' | 'network';

/**
 * 一次对局的启动契约（Phase 11）。
 *
 * 由 MainMenuScene 构造，经 scene.start(BattleScene.KEY, { setup }) 注入；
 * BattleScene **只**通过本对象决定 InputSource 组合 ——
 * 禁止从 URL / 字符串 / 全局变量 / Scene 名字猜模式。
 *
 * Gameplay Systems（TurnManager / Movement / Aim / Projectile / Damage）
 * 不感知 GameMode —— 模式差异只体现在谁产出 GameCommand。
 */
export interface MatchSetup {
  mode: GameMode;

  p1Controller: PlayerController;

  p2Controller: PlayerController;

  /** SP：AI 难度（缺省 normal 由 MatchFactory 填充） */
  aiDifficulty?: AIDifficulty;
}

/** scene.start 数据载荷：BattleScene.init 的入参形态 */
export interface BattleSceneData {
  setup: MatchSetup;
}
