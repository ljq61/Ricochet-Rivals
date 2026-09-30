import { describe, expect, it, vi } from 'vitest';
import { BootScene } from '../../src/game/scenes/BootScene';
import { WALK_ART } from '../../src/game/config/ArtAssets';

vi.mock('phaser', () => ({ default: { Scene: class {} } }));
vi.mock('../../src/game/scenes/MainMenuScene', () => ({ MainMenuScene: { KEY: 'MainMenuScene' } }));

describe('BootScene — walk atlas slicing', () => {
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
