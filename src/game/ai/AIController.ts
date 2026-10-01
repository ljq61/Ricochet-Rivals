import { GAME_CONFIG, type AIDifficulty } from '../config/GameConfig';
import { clamp } from '../utils/MathUtils';
import { getLaunchOrigin } from '../physics/aimMath';
import type { RandomSource } from '../random/SeededRandom';
import { TurnPhase } from '../state/TurnPhase';
import type { GameState } from '../state/GameState';
import type { PlayerState } from '../state/PlayerState';
import { solveTrajectory } from './TrajectorySolver';

/**
 * AIController（Phase 10，CODELY.md §18）—— 纯逻辑决策核心。
 *
 * 输入：GameState 快照（只读）+ SeededRandom + 难度；
 * 输出：AIDecision（不执行 —— 执行在 AIInputSource，经 GameCommand 链路）。
 * 零 Phaser / viewport / 设备依赖；表现延迟（思考时间）不在此层。
 *
 * 决策流：读双方位置 → 原地求解 →（无解时）搜索合法移动候选再求解
 * → 选择弹道 → 按难度加 seeded 误差。
 *
 * 回合唯一出口是发射（游戏没有 pass 机制）：无可行解时也必须给出
 * 尽力弹，否则回合卡死。仅 gameOver / 非法相位 / 已阵亡 / 已发射
 * 返回空决策。三档难度共用求解与执行链路，瞄准高度和误差由配置决定。
 */

export interface AIFirePlan {
  /** 发射仰角（deg；0° = +x，90° = 向上） */
  angleDeg: number;
  /** 发射速度（px/s），∈ [minLaunchSpeed, maxLaunchSpeed] */
  speed: number;
}

export interface AIDecision {
  /** 拟移动到的目标 x（无需移动 = null）；移动后才执行 fire */
  moveTargetX: number | null;
  /** 拟发射弹道（纯方向 + 力度；start 由执行层发射瞬间读取） */
  fire: AIFirePlan | null;
}

const NO_DECISION: AIDecision = { moveTargetX: null, fire: null };

export class AIController {
  constructor(private readonly difficulty: AIDifficulty) {}

  /** 决策（纯函数：不修改 state；同 state + 同 rng 序列 → 同输出） */
  decide(state: GameState, rng: RandomSource): AIDecision {
    // 安全短路：只应在己方 ACTION 且未发射时被调用，这里防御性复核
    if (state.gameOver || state.phase !== TurnPhase.ACTION) {
      return NO_DECISION;
    }
    const me = state.players[state.currentPlayerId];
    if (!me.isAlive || me.hasFired) {
      return NO_DECISION;
    }

    const enemyId = state.currentPlayerId === 'P1' ? 'P2' : 'P1';
    const enemy = state.players[enemyId];
    const origin = getLaunchOrigin(me);
    const { targetHeightRatio } = GAME_CONFIG.ai.difficulties[this.difficulty];
    const targetY = enemy.y - GAME_CONFIG.player.collision.height * targetHeightRatio;

    // 1. 原地求解
    const solution = solveTrajectory({
      originX: origin.x,
      originY: origin.y,
      targetX: enemy.x,
      targetY,
    });
    if (solution) {
      return { moveTargetX: null, fire: this.applyError(solution, rng) };
    }

    // 2. 无解：搜索基地内移动候选（先朝敌后背敌，确定性顺序）
    for (const candidateX of this.moveCandidates(me, enemy.x)) {
      const moved = solveTrajectory({
        originX: candidateX,
        originY: origin.y, // 水平移动，高度不变
        targetX: enemy.x,
        targetY,
      });
      if (moved) {
        return { moveTargetX: candidateX, fire: this.applyError(moved, rng) };
      }
    }

    // 3. 全部无解：尽力弹（回合唯一出口是发射，绝不返回 null fire）
    return { moveTargetX: null, fire: this.bestEffortShot(me, enemy.x, rng) };
  }

  // ---- 内部 ---------------------------------------------------------------

  /**
   * 移动候选（简单搜索）：朝敌 / 背敌两个方向 × 全程 / 半程，
   * clamp 在己方 bounds 内，跳过原地与重复。确定性顺序。
   */
  private moveCandidates(me: PlayerState, enemyX: number): number[] {
    const bounds =
      me.side === 'left'
        ? GAME_CONFIG.player.leftBounds
        : GAME_CONFIG.player.rightBounds;
    const towardEnemy = Math.sign(enemyX - me.x) || 1;
    const reach = (direction: number): number => {
      const boundRoom =
        direction > 0 ? bounds.maxX - me.x : me.x - bounds.minX;
      return Math.max(0, boundRoom);
    };

    const candidates: number[] = [];
    for (const direction of [towardEnemy, -towardEnemy]) {
      for (const fraction of [1, 0.5]) {
        const distance = reach(direction) * fraction;
        const candidateX = me.x + direction * distance;
        if (distance < 1 || Math.abs(candidateX - me.x) < 1) {
          continue; // 无空间 / 原地：跳过
        }
        if (!candidates.some((c) => Math.abs(c - candidateX) < 1)) {
          candidates.push(candidateX);
        }
      }
    }
    return candidates;
  }

  /** 无可行解时的尽力弹：朝敌方、固定低仰角、按目标距离估速度 */
  private bestEffortShot(
    me: PlayerState,
    enemyX: number,
    rng: RandomSource
  ): AIFirePlan {
    const { fallbackAngleDeg } = GAME_CONFIG.ai;
    const direction =
      Math.sign(enemyX - me.x) || (me.side === 'left' ? 1 : -1);
    const angleDeg = direction > 0 ? fallbackAngleDeg : 180 - fallbackAngleDeg;
    // 45° 直射近似估速（√(R·g)），clamp 进合法速度空间
    const distance = Math.abs(enemyX - me.x);
    const idealSpeed = Number.isFinite(distance)
      ? Math.sqrt(Math.max(distance * GAME_CONFIG.physics.gravityY, 1))
      : GAME_CONFIG.aiming.minLaunchSpeed;
    return this.applyError({ angleDeg, speed: idealSpeed }, rng);
  }

  /** 按难度叠加 seeded 误差（CODELY.md §18：角度 / 力度），clamp 回人类可达空间 */
  private applyError(
    plan: { angleDeg: number; speed: number },
    rng: RandomSource
  ): AIFirePlan {
    const { aimErrorDeg, powerErrorRatio } =
      GAME_CONFIG.ai.difficulties[this.difficulty];
    const { minLaunchSpeed, maxLaunchSpeed } = GAME_CONFIG.aiming;

    const angleDeg = clamp(
      plan.angleDeg + rng.range(-aimErrorDeg, aimErrorDeg),
      1,
      179
    );
    const speed = clamp(
      plan.speed * (1 + rng.range(-powerErrorRatio, powerErrorRatio)),
      minLaunchSpeed,
      maxLaunchSpeed
    );
    return { angleDeg, speed };
  }
}
