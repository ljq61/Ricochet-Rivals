import { describe, expect, it, vi } from 'vitest';
import type Phaser from 'phaser';
import { CameraController } from '../../src/game/camera/CameraController';
import { CameraMode } from '../../src/game/camera/CameraMode';
import { GAME_CONFIG } from '../../src/game/config/GameConfig';
import type { GesturePointerEvent } from '../../src/game/input/gesture';

vi.mock('phaser', () => ({ default: {} }));

interface TweenConfig {
  targets: Record<string, number>;
  duration: number;
  onUpdate?: () => void;
  onComplete?: () => void;
  [key: string]: unknown;
}

/** A linear clock checks ownership/lifetime; rendered E2E checks Phaser easing. */
function fixture() {
  const camera = { width: 844, height: 390, zoom: 390 / 1080,
    scrollX: 1078, scrollY: 345 };
  const tweens: { stopped: boolean; elapsed: number; config: TweenConfig;
    props: { key: string; start: number; end: number }[];
    stop: () => void; updateTo: (key: string, value: number, current: boolean) => void }[] = [];
  const scene = {
    cameras: { main: camera }, game: { canvas: { style: {} } },
    tweens: { add: (config: TweenConfig) => {
      const props = Object.entries(config)
        .filter(([key, value]) => typeof value === 'number' && typeof config.targets[key] === 'number')
        .map(([key, value]) => ({ key, start: config.targets[key]!, end: value as number }));
      const tween = { stopped: false, elapsed: 0, config, props,
        stop: () => { tween.stopped = true; },
        updateTo: (key: string, value: number, current: boolean) => {
          const prop = props.find((entry) => entry.key === key);
          if (prop) {
            prop.end = value;
            if (current) prop.start = config.targets[key]!;
          }
        },
      };
      tweens.push(tween);
      return tween;
    } },
  };
  const tick = (ms: number) => {
    for (const tween of [...tweens]) {
      if (tween.stopped) continue;
      tween.elapsed += ms;
      const q = Math.min(1, tween.elapsed / tween.config.duration);
      for (const prop of tween.props) {
        tween.config.targets[prop.key] = prop.start + (prop.end - prop.start) * q;
      }
      tween.config.onUpdate?.();
      if (q === 1 && !tween.stopped) {
        tween.stopped = true;
        tween.config.onComplete?.();
      }
    }
  };
  const controller = new CameraController(scene as unknown as Phaser.Scene);
  return { camera, controller, tick, tweens,
    centerX: () => camera.scrollX + camera.width / 2,
    centerY: () => camera.scrollY + camera.height / 2 };
}

function pointer(x: number, pointerId = 1): GesturePointerEvent {
  return { pointerId, pointerType: 'touch', button: 0,
    x, y: 200, clientX: x, clientY: 200 };
}

describe('CameraController hazard resolution ownership', () => {
  it('cancels the existing drag so its old anchor cannot move the camera after the laser', () => {
    const { controller, centerX } = fixture();
    expect(controller.tryClaim(pointer(100))).toBe(true);
    controller.focusResolution({ x: 2500, y: 300 });
    expect(controller.tryClaim(pointer(150, 2))).toBe(false);
    controller.onMove(pointer(120));
    expect(centerX()).toBe(2500);
    controller.releaseResolutionFocus();
    controller.onMove(pointer(140));
    expect(centerX()).toBe(2500);
    expect(controller.tryClaim(pointer(150, 2))).toBe(true);
  });

  it('cancels an existing pan and rejects another pan while the hazard owns focus', () => {
    const { controller, tick, tweens, centerX } = fixture();
    controller.panToX(4000);
    controller.focusResolution({ x: 2500, y: 300 }, 450);
    expect(tweens[0]?.stopped).toBe(true);
    controller.panToX(4500);
    expect(tweens).toHaveLength(2);
    tick(450);
    expect(centerX()).toBe(2500);
  });

  it('smoothly moves both axes without letting the old projectile provider take over', () => {
    const { camera, controller, tick, centerX, centerY } = fixture();
    camera.scrollY = -camera.height / 2;
    controller.followProjectile(() => ({ x: 4500, y: -300 }));
    controller.focusResolution({ x: 2500, y: 300 }, 450);
    expect(centerX()).toBe(1500);
    expect(centerY()).toBe(0);
    tick(225);
    controller.update(16);
    expect(centerX()).toBeGreaterThan(1500);
    expect(centerX()).toBeLessThan(2500);
    expect(centerY()).toBeGreaterThan(0);
    expect(centerY()).toBeLessThan(540);
    tick(225);
    expect(centerX()).toBe(2500);
    expect(centerY()).toBe(540);
    expect(controller.currentMode).toBe(CameraMode.PROJECTILE_FOLLOW);
  });

  it('preserves IMPACT and resolves dwell without returning to the old explosion after release', async () => {
    const { controller, tick, centerX } = fixture();
    const dwell = controller.focusImpact({ x: 4500, y: 960 });
    controller.focusResolution({ x: 2500, y: 300 }, 450);
    tick(450);
    controller.update(850);
    await dwell;
    expect(controller.currentMode).toBe(CameraMode.IMPACT);
    expect(controller.tryClaim(pointer(100))).toBe(false);
    controller.releaseResolutionFocus();
    controller.update(100);
    expect(centerX()).toBe(2500);
  });

  it('retargets an active vertical tween after a short viewport reaches minimum zoom', () => {
    const { camera, controller, tick, centerX, centerY } = fixture();
    controller.focusResolution({ x: 2500, y: 300 }, 450);
    tick(225);
    camera.height = 240;
    camera.zoom = 0.3;
    controller.onViewportChanged();
    controller.update(16);
    expect(centerY()).toBe(680);
    tick(225);
    controller.update(16);
    expect(centerY()).toBe(680);
    expect(centerX()).toBe(2500);
    expect(centerY() + camera.height / camera.zoom / 2).toBe(1080);
  });

  it('snapshot mode takeover cancels the old tween and restores normal camera gestures', () => {
    const { controller, tick, centerX } = fixture();
    controller.focusResolution({ x: 2500, y: 300 }, 450);
    tick(100);
    controller.enableFreeView();
    controller.centerOnX(3000);
    tick(5000);
    controller.update(16);
    expect(centerX()).toBe(3000);
    expect(controller.currentMode).toBe(CameraMode.FREE_VIEW);
    expect(controller.tryClaim(pointer(100))).toBe(true);
  });

  it('turn transitions snap fast when the camera already sits at the next player', () => {
    const { camera, controller, tick, tweens } = fixture();
    // 章鱼激光收尾：相机停在被 clamp 的右侧基地边缘，下一位玩家就在附近
    const clampedCenter = GAME_CONFIG.world.width - camera.width / camera.zoom / 2;
    camera.scrollX = clampedCenter - camera.width / 2;
    void controller.transitionToPlayer(() => 4400);
    expect(tweens).toHaveLength(1);
    expect(tweens[0]!.config.duration).toBe(GAME_CONFIG.camera.turnTransitionNearMs);
    tick(GAME_CONFIG.camera.turnTransitionNearMs);
    expect(controller.currentMode).toBe(CameraMode.FREE_VIEW);
  });

  it('turn transitions keep the full duration only beyond the near threshold', () => {
    const { camera, controller, tweens } = fixture();
    // 夹具默认中心 1500：目标 2000 = 位移 500（含边界）→ 近距快转
    void controller.transitionToPlayer(() => 2000);
    expect(tweens[0]!.config.duration).toBe(GAME_CONFIG.camera.turnTransitionNearMs);
    // 位移 501 超阈值 → 全长转场
    void controller.transitionToPlayer(() => 2001);
    expect(tweens[1]!.config.duration).toBe(GAME_CONFIG.camera.turnTransitionDurationMs);
    // 跨图目标 → 全长转场
    void controller.transitionToPlayer(() => 4550);
    expect(tweens[2]!.config.duration).toBe(GAME_CONFIG.camera.turnTransitionDurationMs);
    expect(camera.scrollX).toBe(1078); // 断言前未推进任何 tick，起点不变
  });
});
