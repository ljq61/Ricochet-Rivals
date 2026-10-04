import { readFile, readdir, stat, mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { loadRuntimeAssetManifest } from './asset-optimization-manifest.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bundle = resolve(root, 'dist-crazygames');
const artifacts = resolve(root, 'artifacts');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Symlink is not allowed in the upload bundle: ${path}`);
    if (entry.isDirectory()) files.push(...await walk(path));
    else if (entry.isFile()) files.push(path);
  }
  return files.sort();
}

const { version } = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const optimization = JSON.parse(await readFile(resolve(root, '.crazygames-assets-report.json'), 'utf8'));
const manifest = await loadRuntimeAssetManifest();
const html = await readFile(resolve(bundle, 'index.html'), 'utf8');
if (!html.includes('lang="en"') || html.includes('/Ricochet-Rivals/') || html.includes('/src/main.ts')) {
  throw new Error('The upload needs an English production entry with relative asset paths.');
}
if (/(?:src|href)="\//.test(html) || /url\(["']?\//.test(html)) {
  throw new Error('Absolute local resource paths remain in index.html.');
}
const runtime = new Set(optimization.assets.map(asset => asset.destination));
const expected = [...manifest.RUNTIME_IMAGE_PATHS, ...manifest.RUNTIME_AUDIO_PATHS,
  ...(manifest.RUNTIME_OTHER_PATHS ?? [manifest.ASSET_ATTRIBUTION_PATH])].map(manifest.optimizedAssetPath);
if (expected.length !== runtime.size || expected.some(path => !runtime.has(path))) {
  throw new Error('The optimization report does not match the current runtime inventory.');
}
for (const asset of optimization.assets) {
  const source = await readFile(resolve(root, 'public', asset.source));
  const bytes = await readFile(resolve(bundle, asset.destination));
  if (sha256(source) !== asset.sourceSha256 || sha256(bytes) !== asset.optimizedSha256) {
    throw new Error(`Stale or altered resource: ${asset.destination}`);
  }
}
const files = await walk(bundle);
const entries = [];
for (const path of files) {
  const file = relative(bundle, path).replaceAll('\\', '/');
  if (file !== 'index.html' && !runtime.has(file) && !/^assets\/index-[\w-]+\.(js|css)$/.test(file)) {
    throw new Error(`Unreferenced file in the upload bundle: ${file}`);
  }
  const bytes = await readFile(path);
  entries.push({ file, bytes: (await stat(path)).size, sha256: sha256(bytes) });
}
const totalBytes = entries.reduce((sum, file) => sum + file.bytes, 0);
if (totalBytes > 50_000_000 || entries.length > 1500) throw new Error('Basic Launch file size/count limit exceeded.');
await mkdir(artifacts, { recursive: true });
const archive = resolve(artifacts, `ricochet-rivals-crazygames-${version}.zip`);
await rm(archive, { force: true });
// Explicit filenames preserve index.html at ZIP root; source art and reports stay outside it.
execFileSync('zip', ['-q', '-X', archive, ...entries.map(entry => entry.file)], { cwd: bundle });
execFileSync('unzip', ['-t', archive], { stdio: 'pipe' });
const archiveBytes = await readFile(archive);
const report = { version, target: 'CrazyGames Basic Launch', sdk: false, fileCount: entries.length,
  totalBytes, withinMobileSizeLimit: totalBytes <= 20_000_000,
  zipBytes: archiveBytes.length, zipSha256: sha256(archiveBytes), files: entries };
await writeFile(resolve(artifacts, 'crazygames-build-report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(`CrazyGames upload candidate: ${entries.length} files, ${(totalBytes / 1e6).toFixed(2)} MB; ZIP ${(archiveBytes.length / 1e6).toFixed(2)} MB. Mobile size limit: ${report.withinMobileSizeLimit ? 'PASS' : 'NOT MET'}.`);
console.log(archive);
