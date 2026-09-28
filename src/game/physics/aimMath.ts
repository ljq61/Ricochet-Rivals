import { GAME_CONFIG } from '../config/GameConfig';
import type { PlayerState } from '../state/PlayerState';

/**
 * 瞄准计算纯函数（Angry Birds 式反方向拖拽，CODELY.md §12）。
 * 零 Phaser 依赖，可直接单测。
 *
 *   drag      = pointer - launchOrigin
 *   direction = -normalize(drag)          （发射方向与拖拽方向相反）
 *   power     = clamp(|drag| / maxDrag, 0, 1)
 *   speed     = lerp(minSpeed, maxSpeed, power)
 *   velocity  = direction × speed
 */

export interface AimDragInput {
  /** 发射原点（世界坐标） */
  originX: number;
  originY: number;
  /** 当前指针位置（世界坐标） */
  pointerX: number;
  pointerY: number;
}

export interface AimResult {
  /** 拖拽向量（origin → pointer） */
  dragX: number;
  dragY: number;
  /** 发射方向（已归一化，与拖拽反向） */
  directionX: number;
  directionY: number;
  /** 0 ~ 1，超过最大拖拽距离后保持 1 */
  power: number;
  speed: number;
  velocityX: number;
  velocityY: number;
  /** power >= minPower 才允许发射 */
  canFire: boolean;
}

/** 瞄准交互的完整可渲染状态（输入层维护，渲染层读取） */
export interface AimState {
  active: boolean;
  originX: number;
  originY: number;
  pointerX: number;
  pointerY: number;
  directionX: number;
  directionY: number;
  power: number;
  velocityX: number;
  velocityY: number;
  canFire: boolean;
}

/**
 * 发射原点：炮手脚底坐标 + 炮塔偏移（Phase 5 的 Projectile 从这里出生）。
 */
export function getLaunchOrigin(player: PlayerState): {
  x: number;
  y: number;
} {
  return {
    x: player.x,
    y: player.y + GAME_CONFIG.player.launcher.offsetY,
  };
}

export function calculateAim(input: AimDragInput): AimResult {
  const { maxDragDistance, minPower, minLaunchSpeed, maxLaunchSpeed } =
    GAME_CONFIG.aiming;

  const dragX = input.pointerX - input.originX;
  const dragY = input.pointerY - input.originY;
  const length = Math.hypot(dragX, dragY);

  // 无有效拖拽：无方向、不可发射（避免 NaN）
  if (length < 1e-6) {
    return {
      dragX: 0,
      dragY: 0,
      directionX: 0,
      directionY: 0,
      power: 0,
      speed: minLaunchSpeed,
      velocityX: 0,
      velocityY: 0,
      canFire: false,
    };
  }

  const power = Math.min(Math.max(length / maxDragDistance, 0), 1);
  const directionX = -dragX / length;
  const directionY = -dragY / length;
  const speed = minLaunchSpeed + (maxLaunchSpeed - minLaunchSpeed) * power;

  return {
    dragX,
    dragY,
    directionX,
    directionY,
    power,
    speed,
    velocityX: directionX * speed,
    velocityY: directionY * speed,
    canFire: power >= minPower,
  };
}
