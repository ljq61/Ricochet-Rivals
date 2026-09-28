import { describe, expect, it, vi } from 'vitest';
import {
  GestureArbiter,
  type GestureClaimant,
  type GestureKind,
  type GesturePointerEvent,
  type GestureZone,
} from '../../src/game/input/gesture';

/**
 * Gesture 仲裁（CODELY.md §25）：
 * 优先级 UI > AIM > MOVEMENT > CAMERA；
 * 同一 Pointer 从 down 到 up / cancel 只属于一个 Owner；
 * 输入层不产生副作用：未获胜的 tryClaim 不应被调用。
 */

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function pointer(
  id: number,
  x: number,
  y: number,
  button = 0,
  pointerType = 'touch'
): GesturePointerEvent {
  // 画布铺满视口时 client == 画布坐标（InputRouter 恒等换算）
  return { pointerId: id, pointerType, button, x, y, clientX: x, clientY: y };
}

function makeZone(
  id: string,
  kind: GestureKind,
  rect: Rect,
  options: { active?: boolean } = {}
): { zone: GestureZone; down: ReturnType<typeof vi.fn>; up: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn>; hover: ReturnType<typeof vi.fn> } {
  const down = vi.fn();
  const up = vi.fn();
  const cancel = vi.fn();
  const hover = vi.fn();
  const active = options.active ?? true;
  const zone: GestureZone = {
    id,
    kind,
    isActive: () => active,
    contains: (x, y) =>
      x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h,
    onDown: down,
    onUp: up,
    onCancel: cancel,
    onHover: hover,
  };
  return { zone, down, up, cancel, hover };
}

function makeClaimant(
  kind: GestureKind,
  willClaim: boolean
): {
  claimant: GestureClaimant;
  tryClaim: ReturnType<typeof vi.fn>;
  move: ReturnType<typeof vi.fn>;
  up: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
} {
  const tryClaim = vi.fn(() => willClaim);
  const move = vi.fn();
  const up = vi.fn();
  const cancel = vi.fn();
  const claimant: GestureClaimant = {
    kind,
    tryClaim,
    onMove: move,
    onUp: up,
    onCancel: cancel,
  };
  return { claimant, tryClaim, move, up, cancel };
}

describe('GestureArbiter — 优先级 UI > AIM > MOVEMENT > CAMERA', () => {
  it('UI zone 覆盖点时最先获胜，AIM / CAMERA claimant 的 tryClaim 不被调用', () => {
    const arbiter = new GestureArbiter();
    const ui = makeZone('aim-btn', 'UI', { x: 0, y: 0, w: 100, h: 50 });
    const aim = makeClaimant('AIM', true);
    const camera = makeClaimant('CAMERA', true);
    arbiter.registerZone(ui.zone);
    arbiter.registerClaimant(aim.claimant);
    arbiter.registerClaimant(camera.claimant);

    arbiter.onPointerDown(pointer(1, 50, 25));

    expect(ui.down).toHaveBeenCalledTimes(1);
    expect(aim.tryClaim).not.toHaveBeenCalled();
    expect(camera.tryClaim).not.toHaveBeenCalled();
  });

  it('AIM claimant 胜过重叠的 MOVEMENT zone（优先级 1 < 2）', () => {
    const arbiter = new GestureArbiter();
    const move = makeZone('move-left', 'MOVEMENT', { x: 0, y: 0, w: 100, h: 100 });
    const aim = makeClaimant('AIM', true);
    arbiter.registerZone(move.zone);
    arbiter.registerClaimant(aim.claimant);

    arbiter.onPointerDown(pointer(1, 50, 50));

    expect(aim.tryClaim).toHaveBeenCalledTimes(1);
    expect(move.down).not.toHaveBeenCalled();
  });

  it('MOVEMENT zone 胜过 CAMERA claimant；无 zone 命中时 CAMERA 兜底', () => {
    const arbiter = new GestureArbiter();
    const move = makeZone('move-left', 'MOVEMENT', { x: 0, y: 0, w: 100, h: 100 });
    const camera = makeClaimant('CAMERA', true);
    arbiter.registerZone(move.zone);
    arbiter.registerClaimant(camera.claimant);

    arbiter.onPointerDown(pointer(1, 50, 50));
    expect(move.down).toHaveBeenCalledTimes(1);
    expect(camera.tryClaim).not.toHaveBeenCalled();

    arbiter.onPointerDown(pointer(2, 500, 500));
    expect(camera.tryClaim).toHaveBeenCalledTimes(1);
  });

  it('高优先级 claimant 拒绝（tryClaim=false）时按优先级落选到 CAMERA', () => {
    const arbiter = new GestureArbiter();
    const aim = makeClaimant('AIM', false);
    const camera = makeClaimant('CAMERA', true);
    arbiter.registerClaimant(aim.claimant);
    arbiter.registerClaimant(camera.claimant);

    arbiter.onPointerDown(pointer(1, 100, 100));

    expect(aim.tryClaim).toHaveBeenCalledTimes(1);
    expect(camera.tryClaim).toHaveBeenCalledTimes(1);
  });
});

describe('GestureArbiter — 一个 Pointer 一个 Owner', () => {
  it('move/up 只路由给持有者；另一根手指可独立归属其他系统', () => {
    const arbiter = new GestureArbiter();
    const aim = makeClaimant('AIM', true);
    const camera = makeClaimant('CAMERA', true);
    arbiter.registerClaimant(aim.claimant);
    arbiter.registerClaimant(camera.claimant);

    // 指针 1 被 AIM 认领，指针 2 落在 AIM 拒绝的位置（已有 aim active）
    aim.claimant.tryClaim = vi.fn((e) => e.pointerId === 1);

    arbiter.onPointerDown(pointer(1, 10, 10));
    arbiter.onPointerDown(pointer(2, 20, 20));

    arbiter.onPointerMove(pointer(1, 15, 15));
    arbiter.onPointerMove(pointer(2, 25, 25));

    expect(aim.move).toHaveBeenCalledTimes(1);
    expect(camera.move).toHaveBeenCalledTimes(1);
  });

  it('pointerup 释放所有权并回调 onUp；后续 move 不再路由', () => {
    const arbiter = new GestureArbiter();
    const camera = makeClaimant('CAMERA', true);
    arbiter.registerClaimant(camera.claimant);

    arbiter.onPointerDown(pointer(1, 100, 100));
    arbiter.onPointerUp(pointer(1, 200, 200));
    arbiter.onPointerMove(pointer(1, 300, 300));

    expect(camera.up).toHaveBeenCalledTimes(1);
    expect(camera.move).not.toHaveBeenCalled();
  });

  it('pointercancel 按 cancel 释放（浏览器打断）', () => {
    const arbiter = new GestureArbiter();
    const camera = makeClaimant('CAMERA', true);
    arbiter.registerClaimant(camera.claimant);

    arbiter.onPointerDown(pointer(1, 100, 100));
    arbiter.onPointerCancel(pointer(1, 150, 150));

    expect(camera.cancel).toHaveBeenCalledTimes(1);
    expect(camera.up).not.toHaveBeenCalled();
  });

  it('无人认领的 Pointer：down/move/up 全部忽略', () => {
    const arbiter = new GestureArbiter();
    const camera = makeClaimant('CAMERA', false);
    arbiter.registerClaimant(camera.claimant);

    arbiter.onPointerDown(pointer(1, 100, 100));
    arbiter.onPointerMove(pointer(1, 200, 200));
    arbiter.onPointerUp(pointer(1, 300, 300));

    expect(camera.tryClaim).toHaveBeenCalledTimes(1);
    expect(camera.move).not.toHaveBeenCalled();
    expect(camera.up).not.toHaveBeenCalled();
  });

  it('releaseAll（window blur）：所有持有中的手势按 cancel 释放', () => {
    const arbiter = new GestureArbiter();
    const ui = makeZone('btn', 'UI', { x: 0, y: 0, w: 50, h: 50 });
    const camera = makeClaimant('CAMERA', true);
    arbiter.registerZone(ui.zone);
    arbiter.registerClaimant(camera.claimant);

    arbiter.onPointerDown(pointer(1, 10, 10)); // UI zone
    arbiter.onPointerDown(pointer(2, 500, 500)); // CAMERA
    arbiter.releaseAll();

    expect(ui.cancel).toHaveBeenCalledTimes(1);
    expect(camera.cancel).toHaveBeenCalledTimes(1);

    // 释放后 move 不再路由
    arbiter.onPointerMove(pointer(1, 20, 20));
    expect(ui.down).toHaveBeenCalledTimes(1);
  });

  it('非主键（button≠0，如右键）完全忽略', () => {
    const arbiter = new GestureArbiter();
    const camera = makeClaimant('CAMERA', true);
    arbiter.registerClaimant(camera.claimant);

    arbiter.onPointerDown(pointer(1, 100, 100, 2, 'mouse'));
    expect(camera.tryClaim).not.toHaveBeenCalled();
  });

  it('isActive=false 的 zone 不参与仲裁', () => {
    const arbiter = new GestureArbiter();
    const disabled = makeZone('focus', 'UI', { x: 0, y: 0, w: 100, h: 100 }, { active: false });
    const camera = makeClaimant('CAMERA', true);
    arbiter.registerZone(disabled.zone);
    arbiter.registerClaimant(camera.claimant);

    arbiter.onPointerDown(pointer(1, 50, 50));
    expect(disabled.down).not.toHaveBeenCalled();
    expect(camera.tryClaim).toHaveBeenCalledTimes(1);
  });

  it('zone 生命周期：down → up 回调；down → cancel 回调', () => {
    const arbiter = new GestureArbiter();
    const ui = makeZone('btn', 'UI', { x: 0, y: 0, w: 100, h: 100 });
    arbiter.registerZone(ui.zone);

    arbiter.onPointerDown(pointer(1, 50, 50));
    arbiter.onPointerUp(pointer(1, 50, 50));
    expect(ui.down).toHaveBeenCalledTimes(1);
    expect(ui.up).toHaveBeenCalledTimes(1);

    arbiter.onPointerDown(pointer(2, 50, 50));
    arbiter.onPointerCancel(pointer(2, 50, 50));
    expect(ui.cancel).toHaveBeenCalledTimes(1);
  });
});

describe('GestureArbiter — 悬停通知（桌面 mouse）', () => {
  it('未占用鼠标 move 进入 zone → onHover(true)，离开 → onHover(false)', () => {
    const arbiter = new GestureArbiter();
    const ui = makeZone('btn', 'UI', { x: 0, y: 0, w: 100, h: 100 });
    arbiter.registerZone(ui.zone);

    arbiter.notifyHover(pointer(9, 50, 50, 0, 'mouse'));
    expect(ui.hover).toHaveBeenLastCalledWith(true, expect.anything());

    arbiter.notifyHover(pointer(9, 500, 500, 0, 'mouse'));
    expect(ui.hover).toHaveBeenLastCalledWith(false, expect.anything());
    expect(ui.hover).toHaveBeenCalledTimes(2);
  });

  it('已占用的指针不触发 hover（拖拽经过按钮不产生悬停反馈）', () => {
    const arbiter = new GestureArbiter();
    const ui = makeZone('btn', 'UI', { x: 0, y: 0, w: 100, h: 100 });
    const camera = makeClaimant('CAMERA', true);
    arbiter.registerZone(ui.zone);
    arbiter.registerClaimant(camera.claimant);

    arbiter.onPointerDown(pointer(9, 500, 500, 0, 'mouse')); // CAMERA 占用
    arbiter.notifyHover(pointer(9, 50, 50, 0, 'mouse'));
    expect(ui.hover).not.toHaveBeenCalled();
  });
});
