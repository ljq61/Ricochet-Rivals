import { afterEach, expect, it, vi } from 'vitest';
import type Phaser from 'phaser';
import { WorldItemView } from '../../src/game/entities/WorldItemView';
import { ART, ITEM_SUPPLY_ART } from '../../src/game/config/ArtAssets';

vi.mock('phaser', () => ({ default: {} }));
afterEach(() => vi.unstubAllGlobals());

interface DisplayStub { x: number; y: number; scale: number; destroyed: boolean }
function displayStub(): DisplayStub {
  const state = { x: 0, y: 0, scale: 1, destroyed: false };
  const proxy = new Proxy(state, { get: (obj, key) => key in obj ? obj[key as keyof typeof obj] : (...args: number[]) => {
    if (key === 'setPosition') { obj.x = args[0]!; obj.y = args[1]!; }
    if (key === 'setScale') obj.scale = args[0]!;
    if (key === 'destroy') obj.destroyed = true;
    return proxy;
  } });
  return proxy;
}

it('anchors the generated wooden body to the logical pickup bounds while the parachute extends above', () => {
  vi.stubGlobal('window', { devicePixelRatio: 1 });
  const origin = vi.fn(), displaySize = vi.fn();
  const supply = displayStub() as DisplayStub & { setOrigin: (...args: number[]) => unknown; setDisplaySize: (...args: number[]) => unknown };
  supply.setOrigin = (...args) => { origin(...args); return supply; };
  supply.setDisplaySize = (...args) => { displaySize(...args); return supply; };
  const scene = { time: { now: 100 }, textures: { exists: (key: string) => key === ART.itemSupply },
    add: { graphics: displayStub, image: () => supply, container: displayStub } } as unknown as Phaser.Scene;
  const item = { id: 'crate', type: 'heal' as const, x: 800, y: 400, active: true, spawnTurnId: 2, expiresAtTurnId: 8 };
  const view = new WorldItemView(scene);
  view.refresh([item]);
  expect(origin).toHaveBeenCalledWith(ITEM_SUPPLY_ART.originX, ITEM_SUPPLY_ART.originY);
  expect(displaySize).toHaveBeenCalledWith(ITEM_SUPPLY_ART.displayWidth, ITEM_SUPPLY_ART.displayHeight);
  const scaleX = ITEM_SUPPLY_ART.displayWidth / ITEM_SUPPLY_ART.sourceWidth;
  const scaleY = ITEM_SUPPLY_ART.displayHeight / ITEM_SUPPLY_ART.sourceHeight;
  const body = ITEM_SUPPLY_ART.body;
  expect((body.x - ITEM_SUPPLY_ART.originX * ITEM_SUPPLY_ART.sourceWidth) * scaleX).toBeCloseTo(-40);
  expect((body.y - ITEM_SUPPLY_ART.originY * ITEM_SUPPLY_ART.sourceHeight) * scaleY).toBeCloseTo(-32);
  expect(body.width * scaleX).toBeCloseTo(80);
  expect(body.height * scaleY).toBeCloseTo(64);
  expect(view.enteringUntil).toBe(450);
  expect(item).toEqual({ id: 'crate', type: 'heal', x: 800, y: 400, active: true, spawnTurnId: 2, expiresAtTurnId: 8 });
  view.destroy();
});

it('keeps the pickup flight in screen space as camera following pans and changes zoom', () => {
  vi.stubGlobal('window', { devicePixelRatio: 2 });
  const camera = { scrollX: 100, scrollY: 0, width: 844, height: 390, zoom: 0.4 };
  const containers: DisplayStub[] = [];
  const tweens: Array<{ targets: { value: number }; onUpdate: () => void; onComplete: () => void }> = [];
  const remove = vi.fn();
  const scene = { cameras: { main: camera }, add: {
    text: displayStub, graphics: displayStub, container: () => {
      const container = displayStub(); containers.push(container); return container;
    },
  }, tweens: { add: (config: typeof tweens[number]) => { tweens.push(config); return { remove }; } } } as unknown as Phaser.Scene;
  const view = new WorldItemView(scene);
  const target = { x: 810, y: 105 };
  view.pickupFeedback('homing', 1000, 300, target, 2);
  const flight = containers[0]!, tween = tweens.at(-1)!;
  const screenPosition = () => ({ x: camera.width / 2 + (flight.x - camera.width / 2) * camera.zoom,
    y: camera.height / 2 + (flight.y - camera.height / 2) * camera.zoom });
  const start = screenPosition();
  expect(start.x).toBeCloseTo(613.2);
  expect(start.y).toBeCloseTo(237);
  camera.scrollX = 1500; camera.zoom = 0.7;
  tween.targets.value = 0.5; tween.onUpdate();
  expect(screenPosition().x).toBeCloseTo((start.x + target.x) / 2);
  expect(screenPosition().y).toBeCloseTo((start.y + target.y) / 2 - 56);
  expect(flight.scale * camera.zoom).toBeCloseTo(1);
  tween.targets.value = 1; tween.onUpdate();
  expect(screenPosition()).toEqual(target);
  view.destroy();
  expect(remove).toHaveBeenCalledOnce();
  expect(flight.destroyed).toBe(true);
});
