import { GAME_CONFIG } from '../config/GameConfig';
import type { GameState } from '../state/GameState';
import type { PlayerState } from '../state/PlayerState';
import type { ExplosionEvent } from '../state/ExplosionEvent';
import type { DamageResult, PlayerDamageResult } from '../state/DamageResult';
import { PLAYER_IDS } from '../state/ids';

/**
 * DamageSystem（Phase 7，CODELY.md §15）：
 *
 *   Projectile impact → ExplosionEvent → DamageSystem.calculate()
 *   → DamageResult → apply() → GameState → UI / Animation 响应
 *
 * 伤害分层（GameConfig.explosion）：
 *   distance ≤ 60   → 2（directDamage）
 *   60 < d ≤ 140    → 1（splashDamage）
 *   d > 140         → 0
 *
 * 距离 = 爆炸中心到玩家身体中心（x, y − collision.height/2）。
 * 炮弹回落砸中发射者同样结算（Phase 5 引信语义）。
 * 纯逻辑、零 Phaser 依赖：calculate/apply 均可直接单测；
 * 未来 Shield / Poison / Critical / Armor 只在此层扩展。
 */
export interface DamageSystem {
  calculate(gameState: GameState, explosion: ExplosionEvent): DamageResult;
  apply(gameState: GameState, result: DamageResult): void;
}

/** 按距离取伤害值（分层边界：≤60 → 2；≤140 → 1；>140 → 0） */
export function damageAtDistance(distance: number): number {
  const { directDamageRadius, directDamage, radius, splashDamage } =
    GAME_CONFIG.explosion;
  if (distance <= directDamageRadius) {
    return directDamage;
  }
  if (distance <= radius) {
    return splashDamage;
  }
  return 0;
}

export class ConcreteDamageSystem implements DamageSystem {
  calculate(gameState: GameState, explosion: ExplosionEvent): DamageResult {
    const players: PlayerDamageResult[] = PLAYER_IDS.map((playerId) => {
      const player = gameState.players[playerId];
      const distance = distanceToPlayer(explosion, player);
      // 已阵亡玩家不再受伤（保持血量不变，UI 不闪）
      const damage = player.isAlive ? damageAtDistance(distance) : 0;
      return {
        playerId,
        distance,
        damage,
        hpBefore: player.hp,
        hpAfter: Math.max(0, player.hp - damage),
      };
    });

    return { explosion, players };
  }

  apply(gameState: GameState, result: DamageResult): void {
    for (const entry of result.players) {
      const player = gameState.players[entry.playerId];
      player.hp = entry.hpAfter;
      player.isAlive = player.hp > 0;
    }
    applyGameOverIfDead(gameState);
  }
}

/** 爆炸中心到玩家身体中心的欧氏距离 */
function distanceToPlayer(
  explosion: ExplosionEvent,
  player: PlayerState
): number {
  // 玩家碰撞体中心：x 为脚底横坐标，y 为脚底 − 身高一半
  const centerY = player.y - GAME_CONFIG.player.collision.height / 2;
  return Math.hypot(explosion.x - player.x, explosion.y - centerY);
}

/**
 * 阵亡判定：任一玩家死亡 → gameOver；恰有一方存活 → 该方获胜，
 * 同归于尽（自爆波及）→ winnerId = null。Phase 8 TurnManager 消费。
 */
export function applyGameOverIfDead(gameState: GameState): void {
  const dead = PLAYER_IDS.filter((id) => !gameState.players[id].isAlive);
  if (dead.length === 0) {
    return;
  }
  gameState.gameOver = true;
  const alive = PLAYER_IDS.filter((id) => gameState.players[id].isAlive);
  const [winner] = alive;
  gameState.winnerId = alive.length === 1 && winner !== undefined ? winner : null;
}
