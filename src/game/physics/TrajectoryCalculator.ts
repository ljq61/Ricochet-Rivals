/**
 * 弹道预测计算（CODELY.md §13）。
 *
 * 使用与 Projectile 相同的抛体模型（解析式）：
 *   position(t) = p0 + v·t + ½·g·t²
 *
 * 只预测限定时长（约 0.8s），不计算落点——
 * 玩家能看到方向与弧线趋势，但完整落点仍需技巧判断。
 * 零 Phaser 依赖，可直接单测；Phase 5 的 Projectile 飞行
 * 必须与这里使用同一套 GameConfig 重力参数。
 */

export interface TrajectoryInput {
  startX: number;
  startY: number;
  velocityX: number;
  velocityY: number;
  gravityX: number;
  gravityY: number;
  /** 预测时长（秒） */
  duration: number;
  /** 采样点数（含 t=0 起点） */
  steps: number;
}

export interface TrajectoryPoint {
  x: number;
  y: number;
  time: number;
}

export function calculateTrajectory(input: TrajectoryInput): TrajectoryPoint[] {
  const points: TrajectoryPoint[] = [];
  const stepCount = Math.max(1, input.steps);
  const dt = stepCount > 1 ? input.duration / (stepCount - 1) : 0;

  for (let i = 0; i < stepCount; i++) {
    const t = i * dt;
    points.push({
      x: input.startX + input.velocityX * t + 0.5 * input.gravityX * t * t,
      y: input.startY + input.velocityY * t + 0.5 * input.gravityY * t * t,
      time: t,
    });
  }

  return points;
}
