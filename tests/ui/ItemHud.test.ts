import { afterEach, describe, expect, it, vi } from 'vitest';
import type Phaser from 'phaser';
import { ItemHud } from '../../src/game/ui/ItemHud';
import type { InputRouter } from '../../src/game/input/InputRouter';
import type { GesturePointerEvent, GestureZone } from '../../src/game/input/gesture';
import { createInitialGameState } from '../../src/game/state/GameState';
import { computeViewportMetrics } from '../../src/game/platform/viewportMath';
import type { ViewportService } from '../../src/game/platform/ViewportService';

vi.mock('phaser', () => ({ default: {} }));
afterEach(() => vi.unstubAllGlobals());

function objectStub(): unknown {
  const target: Record<string, unknown> = { visible: true };
  const proxy = new Proxy(target, {
    get: (obj, key) => key in obj ? obj[key as string] : (...args: unknown[]) => {
      if (key === 'setVisible') obj.visible = args[0];
      return proxy;
    },
  });
  return proxy;
}

function fixture(open = true) {
  const listeners = new Map<string, (event: PointerEvent) => void>();
  vi.stubGlobal('window', { addEventListener: (type: string, listener: (event: PointerEvent) => void) => listeners.set(type, listener),
    removeEventListener: (type: string) => listeners.delete(type) });
  const zones = new Map<string, GestureZone>();
  const router = { registerZone: (zone: GestureZone) => zones.set(zone.id, zone), unregisterZone: (id: string) => zones.delete(id) } as unknown as InputRouter;
  const state = createInitialGameState({ matchId: 'items', seed: 1 });
  state.players.P1.inventory[0] = { id: 'damage', type: 'damage_boost' };
  const onSlotTap = vi.fn();
  let allowed = true;
  const viewport = { current: computeViewportMetrics(844, 430, { top: 0, left: 0, right: 0, bottom: 0 }),
    onChange: () => () => {} } as unknown as ViewportService;
  const scene = { add: { graphics: objectStub, text: objectStub, container: objectStub } } as unknown as Phaser.Scene;
  const hud = new ItemHud(scene, { router, viewport, getState: () => state, getPlayerId: () => 'P1',
    canUse: () => allowed, getSelectedItemId: () => null, isPending: () => false, onSlotTap });
  const bag = hud.debugState.bag!;
  const bagEvent: GesturePointerEvent = { pointerId: 1, pointerType: 'touch', button: 0,
    x: bag.x, y: bag.y, clientX: bag.x, clientY: bag.y };
  const bagZone = zones.get('item-slot--1')!;
  if (open) { bagZone.onDown!(bagEvent); bagZone.onUp!(bagEvent); }
  const slot = hud.debugState.slots[0] ?? bag;
  const event: GesturePointerEvent = { pointerId: 1, pointerType: 'touch', button: 0,
    x: slot.x, y: slot.y, clientX: slot.x, clientY: slot.y };
  return { hud, state, event, bagEvent, onSlotTap, zones, listeners, setAllowed: (value: boolean) => { allowed = value; } };
}

describe('item HUD gesture ownership', () => {
  it('captures the closed bag, opens on tap, and drops slot hit regions when collapsed', () => {
    const f = fixture(false), bagZone = f.zones.get('item-slot--1')!, slotZone = f.zones.get('item-slot-0')!;
    expect(slotZone.isActive()).toBe(false);
    expect(f.hud.inventoryTarget('P1', 0)).toEqual({ x: f.bagEvent.x, y: f.bagEvent.y });
    bagZone.onDown!(f.bagEvent); bagZone.onUp!(f.bagEvent);
    expect(f.hud.debugState.slots).toHaveLength(3);
    expect(slotZone.isActive()).toBe(true);
    bagZone.onDown!(f.bagEvent); bagZone.onUp!(f.bagEvent);
    expect(f.hud.debugState.slots).toHaveLength(0);
    expect(slotZone.isActive()).toBe(false);
    expect(f.onSlotTap).not.toHaveBeenCalled();
  });
  it('uses a slot on pointerup, after a tap on the same item instance', () => {
    const f = fixture(), zone = f.zones.get('item-slot-0')!;
    zone.onDown!(f.event);
    expect(f.onSlotTap).not.toHaveBeenCalled();
    zone.onUp!(f.event);
    expect(f.onSlotTap).toHaveBeenCalledExactlyOnceWith('damage');
    expect(f.hud.debugState.expanded).toBe(false);
    expect(f.hud.debugState.slots).toHaveLength(0);
    f.hud.destroy();
    expect(f.zones.size).toBe(0);
    expect(f.listeners.size).toBe(0);
  });

  it('captures disabled slots but rejects use, dragged gestures and release outside', () => {
    const f = fixture(), zone = f.zones.get('item-slot-0')!;
    f.setAllowed(false);
    expect(zone.isActive()).toBe(true);
    zone.onDown!(f.event); zone.onUp!(f.event);
    zone.onDown!(f.event);
    f.setAllowed(true);
    zone.onUp!(f.event);
    zone.onDown!(f.event);
    f.listeners.get('pointermove')!({ pointerId: 1, clientX: f.event.clientX + 20, clientY: f.event.clientY } as PointerEvent);
    zone.onUp!(f.event);
    zone.onDown!(f.event); zone.onUp!({ ...f.event, x: -100 });
    expect(f.onSlotTap).not.toHaveBeenCalled();
  });

  it('does not use newly replaced inventory or a slot after turn change', () => {
    const f = fixture(), zone = f.zones.get('item-slot-0')!;
    zone.onDown!(f.event);
    f.state.players.P1.inventory[0] = { id: 'new', type: 'homing' };
    zone.onUp!(f.event);
    zone.onDown!(f.event);
    f.state.turnId++;
    f.hud.refresh();
    zone.onUp!(f.event);
    expect(f.onSlotTap).not.toHaveBeenCalled();
  });

  it('preserves the first pointer when a second finger touches the same slot', () => {
    const f = fixture(), zone = f.zones.get('item-slot-0')!;
    zone.onDown!(f.event);
    zone.onDown!({ ...f.event, pointerId: 2 });
    zone.onUp!({ ...f.event, pointerId: 2 });
    expect(f.onSlotTap).not.toHaveBeenCalled();
    zone.onUp!(f.event);
    expect(f.onSlotTap).toHaveBeenCalledExactlyOnceWith('damage');
  });

  it('targets the local slot and the opponent read-only HP inventory badge', () => {
    const f = fixture(), slot = f.hud.debugState.slots[0]!;
    expect(f.hud.inventoryTarget('P1', 0)).toEqual({ x: slot.x, y: slot.y });
    const first = f.hud.inventoryTarget('P2', 0), last = f.hud.inventoryTarget('P2', 2);
    expect(first.x).toBeGreaterThan(844 / 2);
    expect(first.y).toBeLessThan(83);
    expect(last.x - first.x).toBe(44);
  });
});
