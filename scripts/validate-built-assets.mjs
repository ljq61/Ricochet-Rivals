/** Validate what Vite actually copied before allowing a production build to succeed. */
import { readFile, readdir } from 'node:fs/promises';
import { resolve, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { loadRuntimeAssetManifest } from './asset-optimization-manifest.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');
const report = JSON.parse(await readFile(resolve(root, '.asset-optimization-report.json'), 'utf8'));
const manifest = await loadRuntimeAssetManifest();
const expected = new Set([...manifest.RUNTIME_IMAGE_PATHS, ...manifest.RUNTIME_AUDIO_PATHS,
  ...manifest.RUNTIME_OTHER_PATHS].map(manifest.optimizedAssetPath));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
if (report.assets.length !== expected.size || new Set(report.assets.map(asset => asset.destination)).size !== expected.size || report.assets.some(asset => !expected.has(asset.destination))) {
  throw new Error('Optimization report differs from the current runtime inventory.');
}
for (const asset of report.assets) {
  if (sha256(await readFile(resolve(root, 'public', asset.source))) !== asset.sourceSha256 ||
    sha256(await readFile(resolve(dist, asset.destination))) !== asset.optimizedSha256) {
    throw new Error(`Missing, stale or altered production asset: ${asset.destination}`);
  }
}
async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Unexpected symlink: ${path}`);
    if (entry.isDirectory()) files.push(...await walk(path));
    else files.push(path);
  }
  return files;
}
let bytes = 0;
const files = await walk(dist);
for (const path of files) {
  const file = relative(dist, path).replaceAll('\\', '/');
  if (!expected.has(file) && file !== 'index.html' && !/^assets\/index-[\w-]+\.(js|css)$/.test(file)) {
    throw new Error(`Unreferenced source file in production build: ${file}`);
  }
  bytes += (await readFile(path)).length;
}
const html = await readFile(resolve(dist, 'index.html'), 'utf8');
if (!html.includes('lang="zh-CN"') || /assets\/art\/[^\s"'()<>]+\.(png|jpe?g)/i.test(html)) {
  throw new Error('Production HTML must retain Chinese and reference optimized startup images.');
}
console.log(`Verified production build: ${files.length} files, ${(bytes / 1e6).toFixed(2)} MB; ${expected.size} runtime resources match their SHA256 inventory.`);
