import { optimizedAssetPath } from '../config/RuntimeAssets';

/** Source art stays intact; production bundles use the optimized encodings. */
export function assetUrl(path: string): string {
  const file = import.meta.env.PROD
    ? optimizedAssetPath(path)
    : path;
  return `${import.meta.env.BASE_URL}${file}`;
}
