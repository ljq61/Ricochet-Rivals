import { describe, expect, it, vi } from 'vitest';
import { BootScene } from '../../src/game/scenes/BootScene';
import { ART, ART_FILES, ITEM_ART_FRAMES, WALK_ART } from '../../src/game/config/ArtAssets';

vi.mock('phaser', () => ({ default: { Scene: class {} } }));
vi.mock('../../src/game/scenes/MainMenuScene', () => ({ MainMenuScene: { KEY: 'MainMenuScene' } }));

describe('BootScene — walk atlas slicing', () => {
  it('loads both generated item images and registers six alpha-trimmed HUD frames', () => {
    expect(ART_FILES).toContainEqual([ART.itemSupply, 'item-supply-v02.png']);
    expect(ART_FILES).toContainEqual([ART.itemHud, 'item-hud-atlas-v02.png']);
    const atlas = { add: vi.fn() };
    const scene = new BootScene();
    Object.assign(scene, { textures: { exists: (key: string) => key === ART.itemHud, get: () => atlas },
      scene: { start: vi.fn() } });
    scene.create();
    expect(atlas.add).toHaveBeenCalledTimes(6);
    for (const [name, frame] of Object.entries(ITEM_ART_FRAMES)) {
      expect(atlas.add).toHaveBeenCalledWith(name, 0, frame.x, frame.y, frame.width, frame.height);
      expect(frame.x + frame.width).toBeLessThanOrEqual(1024);
      expect(frame.y + frame.height).toBeLessThanOrEqual(1536);
    }
  });

  it('aligns all sixteen water frames inside the original generated sheet', () => {
    const atlas = { getSourceImage: () => ({ width: 1254, height: 1254 }), add: vi.fn() };
    const scene = new BootScene();
    Object.assign(scene, { textures: { exists: (key: string) => key === ART.octopusSplash, get: () => atlas },
      scene: { start: vi.fn() } });
    scene.create();
    expect(ART_FILES).toContainEqual([ART.octopusSplash, 'octopus-splash-v02.png']);
    expect(atlas.add).toHaveBeenCalledTimes(16);
    for (let i = 0; i < 16; i++) {
      const row = Math.floor(i / 4);
      expect(atlas.add).toHaveBeenNthCalledWith(i + 1, i, 0, (i % 4) * 313,
        row * 313 + [75, 52, 48, 24][row]!, 313, 215);
    }
  });

  it('slices complete 8-frame red and blue poses from their configured grids', () => {
    const red = { getSourceImage: () => ({ width: 1774, height: 887 }), add: vi.fn() };
    const blue = { getSourceImage: () => ({ width: 1774, height: 887 }), add: vi.fn() };
    const scene = new BootScene();
    Object.assign(scene, {
      textures: {
        exists: (key: string) => key === WALK_ART.P1.key || key === WALK_ART.P2.key,
        get: (key: string) => key === WALK_ART.P1.key ? blue : red,
      },
      scene: { start: vi.fn() },
    });
    scene.create();
    expect(red.add).toHaveBeenCalledTimes(8);
    for (let i = 0; i < 8; i++) {
      expect(red.add).toHaveBeenNthCalledWith(i + 1, i, 0, (i % 4) * 443, Math.floor(i / 4) * 443, 443, i < 4 ? 443 : 444);
    }
    expect(blue.add).toHaveBeenCalledTimes(8);
    expect(blue.add).toHaveBeenNthCalledWith(8, 7, 0, 1329, 443, 443, 443);
  });
});
