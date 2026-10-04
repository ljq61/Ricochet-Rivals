import { afterEach, describe, expect, it, vi } from 'vitest';
import { assetUrl } from '../../src/game/platform/assetUrl';

afterEach(() => vi.unstubAllEnvs());

describe('production and development resource paths', () => {
  it('keeps original source art in the dev server', () => {
    vi.stubEnv('PROD', false);
    vi.stubEnv('BASE_URL', '/');
    expect(assetUrl('assets/art/red-walk-v3.png')).toBe('/assets/art/red-walk-v3.png');
  });

  it('uses optimized image paths beneath the Pages project prefix', () => {
    vi.stubEnv('PROD', true);
    vi.stubEnv('BASE_URL', '/Ricochet-Rivals/');
    expect(assetUrl('assets/art/red-walk-v3.png')).toBe('/Ricochet-Rivals/assets/art/red-walk-v3.webp');
    expect(assetUrl('assets/art/loading-harbor.jpg')).toBe('/Ricochet-Rivals/assets/art/loading-harbor.webp');
    expect(assetUrl('assets/sfx/airstrike-drop.wav')).toBe('/Ricochet-Rivals/assets/sfx/airstrike-drop.wav');
    expect(assetUrl('assets/vector/cannon-mark.svg')).toBe('/Ricochet-Rivals/assets/vector/cannon-mark.svg');
  });
});
