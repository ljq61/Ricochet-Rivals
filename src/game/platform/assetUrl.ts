import { optimizedAssetPath } from '../config/RuntimeAssets';

/** Source art stays intact; the CrazyGames bundle uses the optimized encodings. */
export function assetUrl(path: string): string {
  const file = import.meta.env.MODE === 'crazygames'
    ? optimizedAssetPath(path)
    : path;
  return `${import.meta.env.BASE_URL}${file}`;
}
