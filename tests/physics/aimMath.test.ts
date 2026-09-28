import { describe, expect, it } from 'vitest';
import {
  calculateAim,
  getLaunchOrigin,
} from '../../src/game/physics/aimMath';
import { createPlayerState } from '../../src/game/state/GameState';
import { GAME_CONFIG } from '../../src/game/config/GameConfig';

const ORIGIN = { originX: 500, originY: 900 };

describe('calculateAim', () => {
  it('方向反转：拖拽向左下 → 发射向右上（CODELY.md §12）', () => {
    const result = calculateAim({
      ...ORIGIN,
      pointerX: 400, // 向左 100
      pointerY: 950, // 向下 50
    });

    expect(result.dragX).toBe(-100);
    expect(result.dragY).toBe(50);
    expect(result.directionX).toBeGreaterThan(0);
    expect(result.directionY).toBeLessThan(0);
    // 方向已归一化
    expect(Math.hypot(result.directionX, result.directionY)).toBeCloseTo(1, 6);
  });

  it('力度 clamp：超过 180px 拖拽后 power 保持 1，速度为最大值', () => {
    const dragLen = 300; // > maxDragDistance
    const result = calculateAim({
      ...ORIGIN,
      pointerX: ORIGIN.originX + dragLen,
      pointerY: ORIGIN.originY,
    });

    expect(result.power).toBe(1);
    expect(result.speed).toBe(GAME_CONFIG.aiming.maxLaunchSpeed);
    expect(result.velocityX).toBe(-GAME_CONFIG.aiming.maxLaunchSpeed);
    expect(result.velocityY).toBeCloseTo(0, 6);
  });

  it('力度 0.5：速度 = lerp(min, max, 0.5)', () => {
    const result = calculateAim({
      ...ORIGIN,
      pointerX: ORIGIN.originX + 90, // 90 / 180 = 0.5
      pointerY: ORIGIN.originY,
    });

    const { minLaunchSpeed, maxLaunchSpeed } = GAME_CONFIG.aiming;
    expect(result.power).toBe(0.5);
    expect(result.speed).toBe(
      minLaunchSpeed + (maxLaunchSpeed - minLaunchSpeed) * 0.5
    );
  });

  it('velocity = direction × speed', () => {
    const result = calculateAim({
      ...ORIGIN,
      pointerX: ORIGIN.originX - 60,
      pointerY: ORIGIN.originY - 80, // 长度 100，方向 (0.6, 0.8)
    });

    expect(result.power).toBeCloseTo(100 / 180, 6);
    const { minLaunchSpeed, maxLaunchSpeed } = GAME_CONFIG.aiming;
    const speed =
      minLaunchSpeed +
      (maxLaunchSpeed - minLaunchSpeed) * (100 / 180);
    expect(result.velocityX).toBeCloseTo(0.6 * speed, 6);
    expect(result.velocityY).toBeCloseTo(0.8 * speed, 6);
  });

  it('最小力度边界：power == 0.15 可发射，略低于则不可', () => {
    const atMin = calculateAim({
      ...ORIGIN,
      pointerX: ORIGIN.originX + 27, // 27 / 180 = 0.15
      pointerY: ORIGIN.originY,
    });
    expect(atMin.power).toBe(0.15);
    expect(atMin.canFire).toBe(true);

    const belowMin = calculateAim({
      ...ORIGIN,
      pointerX: ORIGIN.originX + 26,
      pointerY: ORIGIN.originY,
    });
    expect(belowMin.canFire).toBe(false);
    expect(belowMin.power).toBeLessThan(GAME_CONFIG.aiming.minPower);
  });

  it('零拖拽安全：无方向、无 NaN、不可发射', () => {
    const result = calculateAim({
      ...ORIGIN,
      pointerX: ORIGIN.originX,
      pointerY: ORIGIN.originY,
    });

    expect(result.canFire).toBe(false);
    expect(result.power).toBe(0);
    expect(result.velocityX).toBe(0);
    expect(result.velocityY).toBe(0);
    expect(Number.isNaN(result.directionX)).toBe(false);
    expect(Number.isNaN(result.directionY)).toBe(false);
  });
});

describe('getLaunchOrigin', () => {
  it('发射原点 = 炮手脚底 + 炮塔偏移', () => {
    const player = createPlayerState('P1');
    const origin = getLaunchOrigin(player);

    expect(origin.x).toBe(player.x);
    expect(origin.y).toBe(player.y + GAME_CONFIG.player.launcher.offsetY);
  });
});
