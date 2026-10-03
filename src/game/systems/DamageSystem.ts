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
 * 距离 = 爆炸中心到玩家碰撞矩形的最近距离（内部为 0）。
 * 大体型角色的头顶、侧身和脚底命中均按实际身体边缘结算。
 * 炮弹回落砸中发射者同样结算（Phase 5 引信语义）。
 * 纯逻辑、零 Phaser 依赖：calculate/apply 均可直接单测；
 * 未来 Shield / Poison / Critical / Armor 只在此层扩展。
 */
export interface DamageSystem {
  calculate(gameState: GameState, explosion: ExplosionEvent): DamageResult;
  apply(gameState: GameState, result: DamageResult): void;
}

/** 按距离取伤害值（分层边界：≤60 → 2；≤140 → 1；>140 → 0） */
export function damageAtDistance(distance: number, itemType?: ExplosionEvent['itemType']): number {
  const directDamageRadius = itemType === 'range_boost' ? GAME_CONFIG.items.boostedRadius.direct : GAME_CONFIG.explosion.directDamageRadius;
  const radius = itemType === 'range_boost' ? GAME_CONFIG.items.boostedRadius.splash : GAME_CONFIG.explosion.radius;
  const directDamage = itemType === 'damage_boost' ? GAME_CONFIG.items.boostedDamage.direct : GAME_CONFIG.explosion.directDamage;
  const splashDamage = itemType === 'damage_boost' ? GAME_CONFIG.items.boostedDamage.splash : GAME_CONFIG.explosion.splashDamage;
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
      const damage = player.isAlive ? damageAtDistance(distance, explosion.itemType) : 0;
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

/** 爆炸中心到与 Matter 相同的玩家 AABB 的最近距离。 */
function distanceToPlayer(
  explosion: ExplosionEvent,
  player: PlayerState
): number {
  const { width, height } = GAME_CONFIG.player.collision;
  const dx = Math.max(0, Math.abs(explosion.x - player.x) - width / 2);
  const dy = Math.max(0, player.y - height - explosion.y, explosion.y - player.y);
  return Math.hypot(dx, dy);
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
