import { describe, expect, it, vi } from 'vitest';
import type Phaser from 'phaser';
import { TouchControls } from '../../src/game/input/TouchControls';
import type { InputRouter } from '../../src/game/input/InputRouter';
import type { GestureZone } from '../../src/game/input/gesture';
import type { ViewportService } from '../../src/game/platform/ViewportService';
import { computeViewportMetrics } from '../../src/game/platform/viewportMath';
import { createInitialGameState } from '../../src/game/state/GameState';
import { InMemoryCommandBus } from '../../src/game/commands/CommandBus';
import { GAME_CONFIG } from '../../src/game/config/GameConfig';
import { clampCameraCenterX, groundAnchoredCenterY } from '../../src/game/camera/cameraBounds';
import { screenMoveButtonLayout } from '../../src/game/ui/touchControlLayout';
import { TurnPhase } from '../../src/game/state/TurnPhase';

vi.mock('phaser', () => ({ default: { GameObjects: { GetCalcMatrix: (
  object: { x: number; y: number },
  camera: { width: number; height: number; originX: number; originY: number; scrollX: number; scrollY: number; zoom: number; x: number; y: number },
) => ({ calc: {
  tx: camera.zoom * object.x + camera.x + camera.width * camera.originX * (1 - camera.zoom) - camera.zoom * camera.scrollX,
  ty: camera.zoom * object.y + camera.y + camera.height * camera.originY * (1 - camera.zoom) - camera.zoom * camera.scrollY,
} }) } } }));

function renderObject() {
  const data: Record<string, unknown> = { x: 0, y: 0, scaleX: 1, scaleY: 1, scrollFactorX: 1, scrollFactorY: 1 };
  const proxy = new Proxy(data, { get: (target, key) => key in target ? target[key as string] : (...args: unknown[]) => {
    if (key === 'setPosition') { target.x = args[0]; target.y = args[1]; }
    if (key === 'setScale') { target.scaleX = args[0]; target.scaleY = args[1] ?? args[0]; }
    if (key === 'setScrollFactor') { target.scrollFactorX = args[0]; target.scrollFactorY = args[1] ?? args[0]; }
    return proxy;
  } });
  return proxy;
}

function fixture(playerId: 'P1' | 'P2', dpr: number) {
  const state = createInitialGameState({ matchId: 'base-controls', seed: 1, firstPlayer: playerId });
  state.phase = TurnPhase.ACTION;
  const zones = new Map<string, GestureZone>();
  let onResize: () => void = () => {};
  const viewport = { current: computeViewportMetrics(844 * dpr, 390 * dpr,
    { left: 4 * dpr, right: 4 * dpr, top: 8 * dpr, bottom: 20 * dpr }, undefined, dpr),
  onChange: (callback: () => void) => { onResize = callback; return () => {}; } };
  const camera = { width: viewport.current.width, height: viewport.current.height, x: 0, y: 0,
    originX: 0.5, originY: 0.5, scrollX: 0, scrollY: 0, zoom: viewport.current.zoom };
  const home = () => {
    camera.scrollX = clampCameraCenterX(GAME_CONFIG.player.spawn[state.currentPlayerId],
      viewport.current.visibleWorldWidth, GAME_CONFIG.world.width) - camera.width / 2;
    camera.scrollY = groundAnchoredCenterY(viewport.current.visibleWorldHeight, GAME_CONFIG.world.height) - camera.height / 2;
  };
  home();
  const scene = { cameras: { main: camera }, textures: { exists: () => true },
    add: { container: renderObject, graphics: renderObject, image: renderObject } } as unknown as Phaser.Scene;
  const controls = new TouchControls(scene, { getState: () => state, commandBus: new InMemoryCommandBus(),
    router: { registerZone: (zone: GestureZone) => zones.set(zone.id, zone), unregisterZone: (id: string) => zones.delete(id) } as unknown as InputRouter,
    viewport: viewport as unknown as ViewportService });
  return { state, zones, viewport, camera, controls, home, resize: () => onResize() };
}

describe('TouchControls rendered base anchors and touch projection', () => {
  it.each(['P1', 'P2'] as const)('pans %s controls with the base and updates hit targets before the next frame', (playerId) => {
    for (const dpr of [1, 2, 3]) {
      const f = fixture(playerId, dpr);
      const world = f.controls.moveButtonWorldCenters;
      const initial = f.controls.moveButtonCenters;
      for (const side of ['left', 'right'] as const) {
        expect(f.controls.moveButtonRenderState[side].scrollFactorX).toBe(1);
        expect(f.controls.moveButtonRenderState[side].scrollFactorY).toBe(1);
        expect(f.controls.moveButtonRenderState[side].renderX).toBeCloseTo(initial[side].x);
        expect(f.controls.moveButtonRenderState[side].renderY).toBeCloseTo(initial[side].y);
        expect(f.zones.get(`touch-move-${side}`)!.contains(initial[side].x, initial[side].y)).toBe(true);
      }
      f.camera.scrollX += 600;
      f.camera.scrollY -= 100;
      // No refresh: hit testing must still match the actual changed camera.
      for (const side of ['left', 'right'] as const) {
        const expected = { x: initial[side].x - 600 * f.camera.zoom, y: initial[side].y + 100 * f.camera.zoom };
        expect(f.zones.get(`touch-move-${side}`)!.contains(expected.x, expected.y)).toBe(true);
        expect(f.zones.get(`touch-move-${side}`)!.contains(initial[side].x, initial[side].y)).toBe(false);
        expect(f.controls.moveButtonCenters[side].x).toBeCloseTo(expected.x);
        expect(f.controls.moveButtonCenters[side].y).toBeCloseTo(expected.y);
      }
      f.state.players[playerId].x += playerId === 'P1' ? 200 : -200;
      f.controls.refresh();
      expect(f.controls.moveButtonWorldCenters).toEqual(world);
      f.camera.zoom *= 1.3;
      f.controls.refresh();
      expect(f.controls.moveButtonWorldCenters).toEqual(world);
      expect(f.controls.moveButtonSizes.visual / dpr).toBe(44);
      expect(f.controls.moveButtonSizes.hit / dpr).toBe(48);
      expect(f.controls.moveButtonRenderState.left.scaleX * f.camera.zoom).toBeCloseTo(1);
    }
  });

  it('changes to the other base on a hot-seat turn and recalculates anchors on resize', () => {
    const f = fixture('P1', 2);
    const initialWorld = f.controls.moveButtonWorldCenters;
    f.state.currentPlayerId = 'P2';
    f.home(); f.controls.refresh();
    expect(f.controls.moveButtonWorldCenters.left.x).toBeGreaterThan(initialWorld.left.x);
    f.viewport.current = computeViewportMetrics(932 * 2, 430 * 2,
      { left: 44 * 2, right: 24 * 2, top: 8 * 2, bottom: 34 * 2 }, undefined, 2);
    Object.assign(f.camera, { width: f.viewport.current.width, height: f.viewport.current.height, zoom: f.viewport.current.zoom });
    f.home(); f.resize();
    const reference = screenMoveButtonLayout(f.viewport.current, 'P2');
    for (const side of ['left', 'right'] as const) {
      expect(f.controls.moveButtonCenters[side].x).toBeCloseTo(reference[side].x);
      expect(f.controls.moveButtonCenters[side].y).toBeCloseTo(reference[side].y);
    }
    f.state.phase = TurnPhase.AIM;
    f.controls.refresh();
    expect(f.zones.get('touch-move-left')!.isActive()).toBe(false);
    f.controls.destroy();
    expect(f.zones.size).toBe(0);
  });
});
