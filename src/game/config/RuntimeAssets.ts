import { ART_FILES, AIM_POSE_FILES } from './ArtAssets';
import { SFX_FILES } from './SfxAssets';

/** One runtime inventory shared by loading, optimization, and upload validation. */
export const RUNTIME_IMAGE_PATHS = [
  ...ART_FILES.map(([, file]) => `assets/art/${file}`),
  ...AIM_POSE_FILES.map(([, file]) => `assets/art/${file}`),
  'assets/art/settings-gear.png',
  'assets/art/loading-harbor.jpg',
] as const;

export const RUNTIME_AUDIO_PATHS = SFX_FILES.map(([, file]) => `assets/sfx/${file}`);
export const ASSET_ATTRIBUTION_PATH = 'assets/sfx/SOURCES.md';
export const RUNTIME_OTHER_PATHS = [
  ASSET_ATTRIBUTION_PATH,
  'assets/vector/cannon-mark.svg',
] as const;

/** Preserve source geometry; no atlas coordinates or animation frame sizes change. */
export function optimizedAssetPath(path: string): string {
  return path.replace(/\.(png|jpe?g)$/i, '.webp');
}
