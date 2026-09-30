import { describe, expect, it, vi } from 'vitest';
import type Phaser from 'phaser';
import { AimController } from '../../src/game/input/AimController';
import { CameraMode } from '../../src/game/camera/CameraMode';
import { InMemoryCommandBus } from '../../src/game/commands/CommandBus';
import type { GameCommand } from '../../src/game/commands/GameCommand';
import { createInitialGameState } from '../../src/game/state/GameState';
import { getLaunchOrigin } from '../../src/game/physics/aimMath';
import type { GesturePointerEvent } from '../../src/game/input/gesture';

// Only the screen-to-world adapter needs Phaser; aim math and command dispatch are real.
vi.mock('phaser', () => ({
  default: { Math: { Vector2: class { x = 0; y = 0; } } },
}));

function setup(touch = false, gate = true) {
  const state = createInitialGameState({ matchId: 'aim-lock', seed: 1 });
  const bus = new InMemoryCommandBus();
  const commands: GameCommand[] = [];
  bus.subscribe((command) => commands.push(command));
  let allowed = true;
  const scene = {
    cameras: {
      main: {
        zoom: 1,
        getWorldPoint: (x: number, y: number, result: { x: number; y: number }) => {
          result.x = x;
          result.y = y;
          return result;
        },
      },
    },
  } as unknown as Phaser.Scene;
  const aim = new AimController(scene, {
    getState: () => state,
    getCameraMode: () => CameraMode.AIMING,
    commandBus: bus,
    isTouchProfile: touch,
    getUiScale: () => 1,
    ...(gate ? { canControl: () => allowed } : {}),
  });
  const origin = getLaunchOrigin(state.players.P1);
  const pointer = (dx = 0): GesturePointerEvent => ({
    pointerId: 1,
    pointerType: touch ? 'touch' : 'mouse',
    button: 0,
    x: origin.x + dx,
    y: origin.y,
    clientX: origin.x + dx,
    clientY: origin.y,
  });
  return { aim, commands, pointer, lock: () => { allowed = false; }, unlock: () => { allowed = true; } };
}

describe('AimController — recovery input lock', () => {
  it('rejects a fresh pointer while locked even if the camera is still AIMING', () => {
    const { aim, commands, pointer, lock } = setup();
    lock();
    expect(aim.tryClaim(pointer())).toBe(false);
    aim.onMove(pointer(-100));
    aim.onUp(pointer(-100));
    expect(commands).toHaveLength(0);
  });

  it('does not fire when recovery begins immediately before pointer release', () => {
    const { aim, commands, pointer, lock } = setup();
    expect(aim.tryClaim(pointer())).toBe(true);
    aim.onMove(pointer(-100));
    expect(aim.aimState.canFire).toBe(true);
    lock();
    aim.onUp(pointer(-100));
    expect(aim.aimState.active).toBe(false);
    expect(commands).toHaveLength(0);
  });

  it.each(['update', 'move'] as const)('%s cancels an existing drag before unlock', (entry) => {
    const { aim, commands, pointer, lock, unlock } = setup();
    aim.tryClaim(pointer());
    aim.onMove(pointer(-100));
    lock();
    if (entry === 'update') aim.update();
    else aim.onMove(pointer(-120));
    expect(aim.aimState.active).toBe(false);
    unlock();
    aim.onMove(pointer(-120));
    aim.onUp(pointer(-120));
    expect(commands).toHaveLength(0);
    expect(aim.tryClaim(pointer())).toBe(true);
    aim.onMove(pointer(-100));
    aim.onUp(pointer(-100));
    expect(commands).toHaveLength(1);
  });

  it('abandons a touch drag still inside the dead zone, preventing activation after unlock', () => {
    const { aim, commands, pointer, lock, unlock } = setup(true);
    expect(aim.tryClaim(pointer())).toBe(true);
    expect(aim.aimState.active).toBe(false);
    lock();
    aim.update();
    unlock();
    aim.onMove(pointer(-100));
    aim.onUp(pointer(-100));
    expect(aim.aimState.active).toBe(false);
    expect(commands).toHaveLength(0);
    expect(aim.tryClaim(pointer())).toBe(true);
  });

  it('explicit cancellation discards an active drag without requiring a camera mode change', () => {
    const { aim, commands, pointer } = setup();
    aim.tryClaim(pointer());
    aim.onMove(pointer(-100));
    aim.cancel();
    aim.onUp(pointer(-100));
    expect(commands).toHaveLength(0);
    expect(aim.aimState.active).toBe(false);
  });

  it('preserves offline dragging when no control gate is supplied', () => {
    const { aim, commands, pointer } = setup(false, false);
    expect(aim.tryClaim(pointer())).toBe(true);
    aim.onMove(pointer(-100));
    aim.onUp(pointer(-100));
    expect(commands).toHaveLength(1);
    expect(commands[0]?.type).toBe('FIRE');
  });
});
