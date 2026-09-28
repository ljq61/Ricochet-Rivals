import { GAME_CONFIG } from '../config/GameConfig';
import type { GameState } from '../state/GameState';
import type { ExplosionEvent, ProjectileImpact } from '../state/ExplosionEvent';
import type { DamageResult } from '../state/DamageResult';
import type { DamageSystem } from './DamageSystem';

export interface ExplosionSystemDeps {
  damage: DamageSystem;
}

/**
 * ExplosionSystem（Phase 7）：
 * 把投射物爆炸上下文（ProjectileImpact）转换为完整爆炸结算：
 *
 *   ProjectileImpact
 *     → ExplosionEvent（半径等参数统一来自 GameConfig.explosion）
 *     → DamageSystem.calculate → DamageSystem.apply（GameState 更新）
 *     → DamageResult（返回给 BattleScene 驱动 UI 反馈）
 *
 * 系统层不感知渲染；纯逻辑可单测。
 * 未来多种武器时：按 weaponId 选择爆炸参数表即可（当前仅 NORMAL）。
 */
export class ExplosionSystem {
  private readonly damage: DamageSystem;

  constructor(deps: ExplosionSystemDeps) {
    this.damage = deps.damage;
  }

  /** 结算一次爆炸：构建事件 → 计算并应用伤害 → 返回结果 */
  explode(gameState: GameState, impact: ProjectileImpact): DamageResult {
    const explosion: ExplosionEvent = {
      sourcePlayerId: impact.ownerId,
      weaponId: impact.weaponId,
      x: impact.x,
      y: impact.y,
      radius: GAME_CONFIG.explosion.radius,
      turnId: impact.turnId,
    };

    const result = this.damage.calculate(gameState, explosion);
    this.damage.apply(gameState, result);
    return result;
  }
}
