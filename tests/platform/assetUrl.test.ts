import { afterEach, describe, expect, it, vi } from 'vitest';
import { assetUrl } from '../../src/game/platform/assetUrl';

afterEach(() => vi.unstubAllEnvs());

describe('build-specific runtime resource paths', () => {
  it('keeps original Pages art and project prefix', () => {
    vi.stubEnv('MODE', 'production');
    vi.stubEnv('BASE_URL', '/Ricochet-Rivals/');
    expect(assetUrl('assets/art/red-walk-v3.png')).toBe('/Ricochet-Rivals/assets/art/red-walk-v3.png');
  });

  it('uses optimized image paths relative to the uploaded entry', () => {
    vi.stubEnv('MODE', 'crazygames');
    vi.stubEnv('BASE_URL', './');
    expect(assetUrl('assets/art/red-walk-v3.png')).toBe('./assets/art/red-walk-v3.webp');
    expect(assetUrl('assets/art/loading-harbor.jpg')).toBe('./assets/art/loading-harbor.webp');
    expect(assetUrl('assets/sfx/airstrike-drop.wav')).toBe('./assets/sfx/airstrike-drop.wav');
    expect(assetUrl('assets/vector/cannon-mark.svg')).toBe('./assets/vector/cannon-mark.svg');
  });
});
