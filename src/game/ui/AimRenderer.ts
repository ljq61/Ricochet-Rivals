import Phaser from 'phaser';
import { GAME_CONFIG } from '../config/GameConfig';
import { calculateTrajectory } from '../physics/TrajectoryCalculator';
import type { AimState } from '../physics/aimMath';

const POWER_BAR_WIDTH = 120;
const POWER_BAR_HEIGHT = 10;
const POWER_BAR_OFFSET_Y = -150;

const COLORS = {
  tooWeak: 0x8fa3c7,
  min: 0x46e07a,
  mid: 0xffd24a,
  max: 0xff5063,
} as const;

/**
 * 瞄准渲染（CODELY.md §12/§13）：
 * - 拖拽线（炮塔 → 指针，力度染色）
 * - 力度条（炮手上方）
 * - 12 点 / 0.8s 轨迹虚点（渐小渐透明，不显示完整落点；
 *   力度不足时不显示轨迹——反馈"还不能发射"）
 * - 最大拉伸范围虚线圆
 *
 * 渲染层：只读 AimState，不含任何规则逻辑。
 *
 * Phase 6.5：动态 zoom 下保持反馈可读 —— 反馈元素尺寸按 1/zoom
 * 放大（屏幕尺寸恒定，属允许的 Touch Feedback 平台差异），
 * 位置与最大拉伸圈半径保持世界真实值（gameplay 语义）。
 */
export class AimRenderer {
  private readonly g: Phaser.GameObjects.Graphics;
  private readonly camera: Phaser.Cameras.Scene2D.Camera;

  constructor(scene: Phaser.Scene) {
    this.g = scene.add.graphics().setDepth(800);
    this.camera = scene.cameras.main;
  }

  update(aim: AimState): void {
    this.g.clear();
    if (!aim.active) {
      return;
    }

    // 屏幕尺寸恒定的反馈缩放（zoom < 1 的手机上放大到可读）
    const s = 1 / this.camera.zoom;

    const { originX, originY, pointerX, pointerY, power, canFire } = aim;

    // 1. 最大拉伸范围虚线圆（半径 = 真实 maxDragDistance，不缩放）
    this.drawDashedCircle(
      originX,
      originY,
      GAME_CONFIG.aiming.maxDragDistance,
      0xffffff,
      0.14,
      2 * s
    );

    // 2. 拖拽线 + 指针端圆点（力度染色）
    const lineColor = canFire ? powerColor(power) : COLORS.tooWeak;
    this.g.lineStyle(3 * s, lineColor, 0.9);
    this.g.lineBetween(originX, originY, pointerX, pointerY);
    this.g.fillStyle(lineColor, 0.9);
    this.g.fillCircle(pointerX, pointerY, 8 * s);

    // 3. 力度条（炮手上方；尺寸屏幕恒定）
    const barWidth = POWER_BAR_WIDTH * s;
    const barHeight = POWER_BAR_HEIGHT * s;
    const barX = originX - barWidth / 2;
    const barY = originY + POWER_BAR_OFFSET_Y;
    this.g.fillStyle(0x0d1420, 0.75);
    this.g.fillRoundedRect(barX, barY, barWidth, barHeight, 5 * s);
    if (power > 0) {
      this.g.fillStyle(canFire ? powerColor(power) : COLORS.tooWeak, 1);
      this.g.fillRoundedRect(
        barX,
        barY,
        Math.max(6 * s, barWidth * power),
        barHeight,
        5 * s
      );
    }
    this.g.lineStyle(1 * s, 0x56698a, 0.8);
    this.g.strokeRoundedRect(barX, barY, barWidth, barHeight, 5 * s);

    // 4. 轨迹虚点（仅力度足够时显示；与 Projectile 同一重力模型）
    if (canFire) {
      const points = calculateTrajectory({
        startX: originX,
        startY: originY,
        velocityX: aim.velocityX,
        velocityY: aim.velocityY,
        gravityX: GAME_CONFIG.physics.gravityX,
        gravityY: GAME_CONFIG.physics.gravityY,
        duration: GAME_CONFIG.aiming.previewDuration,
        steps: GAME_CONFIG.aiming.previewPoints,
      });
      for (let i = 1; i < points.length; i++) {
        const point = points[i]!;
        const t = i / (points.length - 1);
        this.g.fillStyle(0xffffff, 0.9 - 0.75 * t);
        this.g.fillCircle(point.x, point.y, (7 - 4.5 * t) * s);
      }
    }
  }

  destroy(): void {
    this.g.destroy();
  }

  private drawDashedCircle(
    x: number,
    y: number,
    radius: number,
    color: number,
    alpha: number,
    lineWidth: number
  ): void {
    const segments = 36;
    this.g.lineStyle(lineWidth, color, alpha);
    for (let i = 0; i < segments; i += 2) {
      const a0 = (i / segments) * Math.PI * 2;
      const a1 = ((i + 1) / segments) * Math.PI * 2;
      this.g.lineBetween(
        x + Math.cos(a0) * radius,
        y + Math.sin(a0) * radius,
        x + Math.cos(a1) * radius,
        y + Math.sin(a1) * radius
      );
    }
  }
}

/** 力度配色：0 → 绿，0.5 → 黄，1 → 红 */
function powerColor(power: number): number {
  if (power <= 0.5) {
    return lerpColor(COLORS.min, COLORS.mid, power * 2);
  }
  return lerpColor(COLORS.mid, COLORS.max, (power - 0.5) * 2);
}

function lerpColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}
