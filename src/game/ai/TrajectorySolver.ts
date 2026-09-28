import { GAME_CONFIG } from '../config/GameConfig';

/**
 * TrajectorySolver（Phase 10，CODELY.md §18 AI 弹道求解）。
 *
 * 策略：45° 射程灵敏度驻点（∂R/∂θ = 0，角度误差二阶不敏感）+
 * 力度一维二分搜索（射程对速度单调递增）。与 scripts/e2e.mjs 的
 * solveFortyFiveRelease 思路一致，但在 src 内独立实现（不 import 脚本），
 * 并考虑发射原点与落点的高度差。
 *
 * 物理模型与 TrajectoryCalculator / Projectile 同一套参数（CODELY.md §13）：
 *   p(t) = p₀ + v·t + ½·g·t²（g = physics.gravityY，px/s²，+y 向下）
 * 搜索区间 = [aiming.minLaunchSpeed, maxLaunchSpeed]（人类拖拽的速度构造区间；
 * 注：人类可发射下限因 minPower=0.15 门禁实际 ≈827 px/s，AI 下限略宽 ——
 * 双方阵地最小间距 3300px 下求解速度 ≥1800 px/s，该口径差在对局中不可触达），
 * 不建第二套物理。
 *
 * 安全（P0）：有限迭代、异常输入一律返回 null、绝不抛异常、绝不死循环。
 * 已知 Matter 半隐式积分比解析式射程系统性过冲 ~0.6–0.7%（≈26px @ 3970px），
 * 直伤半径 60px 足以吸收 —— 稳定优先，不做数值补偿。
 */

/** 发射仰角（deg）：45° 驻点；向左发射时镜像为 180° − 45° */
const SOLVE_ANGLE_DEG = 45;
/** 力度二分上限（48 次远超收敛需求，仅作死循环保险） */
const MAX_ITERATIONS = 48;
/** 二分收敛阈值（px） */
const CONVERGENCE_PX = 0.25;

export interface TrajectorySolveInput {
  originX: number;
  originY: number;
  targetX: number;
  /** 落点判停高度（默认地面 world.groundTopY） */
  targetY?: number;
  /** 落点横向容差（默认 explosion.directDamageRadius = 直伤半径） */
  tolerancePx?: number;
}

export interface TrajectorySolution {
  /** 发射仰角（数学约定：0° = +x，90° = 竖直向上；屏幕 y 向下） */
  angleDeg: number;
  /** 发射速度（px/s），∈ [aiming.minLaunchSpeed, maxLaunchSpeed] */
  speed: number;
  velocityX: number;
  velocityY: number;
  /** 预测落点 x（解析式判停） */
  predictedLandingX: number;
}

/** 仰角 + 速度 → 速度向量（正角 = 向上；与人类拖拽产物 direction × speed 同构） */
export function velocityFromAngleSpeed(
  angleDeg: number,
  speed: number
): { velocityX: number; velocityY: number } {
  const rad = (angleDeg * Math.PI) / 180;
  return {
    velocityX: Math.cos(rad) * speed,
    velocityY: -Math.sin(rad) * speed,
  };
}

export function solveTrajectory(
  input: TrajectorySolveInput
): TrajectorySolution | null {
  const { originX, originY, targetX } = input;

  // 异常输入安全短路（不抛异常）
  if (
    !Number.isFinite(originX) ||
    !Number.isFinite(originY) ||
    !Number.isFinite(targetX)
  ) {
    return null;
  }
  const landingY = input.targetY ?? GAME_CONFIG.world.groundTopY;
  if (!Number.isFinite(landingY)) {
    return null;
  }
  const tolerance =
    input.tolerancePx ?? GAME_CONFIG.explosion.directDamageRadius;
  if (!Number.isFinite(tolerance) || tolerance < 0) {
    return null;
  }

  // 目标与原点同 x：45° 无从逼近（竖直上抛不产生水平位移）
  const direction = Math.sign(targetX - originX);
  if (direction === 0) {
    return null;
  }
  const distance = Math.abs(targetX - originX);

  const { minLaunchSpeed, maxLaunchSpeed } = GAME_CONFIG.aiming;
  const gravity = GAME_CONFIG.physics.gravityY;
  if (!(gravity > 0)) {
    return null; // 无重力无从谈抛体（防御；GameConfig 恒为 1000）
  }

  /**
   * 45° 仰角下给定速度的落点水平偏移（对速度单调递增）。
   * 屏幕坐标 y 向下：y(t) = originY + vy·t + ½·g·t²（vy 为负 = 向上），
   * 落地：½·g·t² + vy·t + (originY − landingY) = 0 取正根。
   */
  const landingOffset = (speed: number): number | null => {
    const rad = (SOLVE_ANGLE_DEG * Math.PI) / 180;
    const horizontal = Math.cos(rad) * speed;
    const vy = -Math.sin(rad) * speed;
    const disc = vy * vy + 2 * gravity * (landingY - originY);
    if (disc < 0) {
      return null;
    }
    const t = (-vy + Math.sqrt(disc)) / gravity;
    if (!Number.isFinite(t) || t <= 0) {
      return null;
    }
    return horizontal * t;
  };

  let lo: number = minLaunchSpeed;
  let hi: number = maxLaunchSpeed;
  const offsetAtLo = landingOffset(lo);
  const offsetAtHi = landingOffset(hi);
  if (offsetAtLo === null || offsetAtHi === null) {
    return null;
  }

  // 目标超出速度可达范围（含容差）：返回 null —— 调用方（AIController）
  // 有尽力弹兜底，solver 语义保持「可命中才返回」
  if (distance < offsetAtLo - tolerance || distance > offsetAtHi + tolerance) {
    return null;
  }

  // 力度一维搜索：区间内二分；贴端点（容差内）直接取端点速度
  let speed: number;
  if (distance <= offsetAtLo) {
    speed = lo;
  } else if (distance >= offsetAtHi) {
    speed = hi;
  } else {
    speed = (lo + hi) / 2;
    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const offset = landingOffset(speed);
      if (offset === null) {
        return null;
      }
      if (Math.abs(offset - distance) <= CONVERGENCE_PX) {
        break;
      }
      if (offset < distance) {
        lo = speed;
      } else {
        hi = speed;
      }
      speed = (lo + hi) / 2;
    }
  }

  const finalOffset = landingOffset(speed);
  if (finalOffset === null) {
    return null;
  }
  const predictedLandingX = originX + direction * finalOffset;
  if (Math.abs(predictedLandingX - targetX) > tolerance) {
    return null;
  }

  const angleDeg = direction > 0 ? SOLVE_ANGLE_DEG : 180 - SOLVE_ANGLE_DEG;
  const { velocityX, velocityY } = velocityFromAngleSpeed(angleDeg, speed);
  return { angleDeg, speed, velocityX, velocityY, predictedLandingX };
}
