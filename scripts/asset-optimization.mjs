import { copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { loadRuntimeAssetManifest } from './asset-optimization-manifest.mjs';

const run = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const staging = resolve(root, '.crazygames-assets');
const reportPath = resolve(root, '.crazygames-assets-report.json');
const quality = 90;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

async function pruneUnusedAssets(directory, expected) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) await pruneUnusedAssets(path, expected);
    else if (!expected.has(relative(staging, path))) await rm(path);
  }
}

function imageSize(bytes, file) {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
  }
  if (bytes.subarray(0, 2).equals(Buffer.from([255, 216]))) {
    for (let offset = 2; offset < bytes.length;) {
      if (bytes[offset++] !== 255) continue;
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd7) continue;
      const size = bytes.readUInt16BE(offset);
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        return [bytes.readUInt16BE(offset + 5), bytes.readUInt16BE(offset + 3)];
      }
      offset += size;
    }
  }
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
    for (let offset = 12; offset + 8 <= bytes.length;) {
      const chunk = bytes.toString('ascii', offset, offset + 4);
      const size = bytes.readUInt32LE(offset + 4);
      const data = offset + 8;
      if (chunk === 'VP8X') return [1 + bytes.readUIntLE(data + 4, 3), 1 + bytes.readUIntLE(data + 7, 3)];
      if (chunk === 'VP8 ') return [bytes.readUInt16LE(data + 6) & 0x3fff, bytes.readUInt16LE(data + 8) & 0x3fff];
      if (chunk === 'VP8L') {
        const packed = bytes.readUInt32LE(data + 1);
        return [(packed & 0x3fff) + 1, (packed >>> 14 & 0x3fff) + 1];
      }
      offset = data + size + (size % 2);
    }
  }
  throw new Error(`Cannot verify image dimensions: ${file}`);
}

/** Sources stay intact; only runtime resources enter the platform staging directory. */
export async function optimizeRuntimeAssets() {
  const encoder = process.env.CWEBP_BIN || 'cwebp';
  let encoderVersion;
  try {
    encoderVersion = (await run(encoder, ['-version'])).stdout.trim();
  } catch {
    throw new Error('cwebp is required for the CrazyGames build. Install WebP tools (macOS: brew install webp), or set CWEBP_BIN.');
  }
  const manifest = await loadRuntimeAssetManifest();
  const images = [...new Set(manifest.RUNTIME_IMAGE_PATHS)];
  const files = [...images, ...manifest.RUNTIME_AUDIO_PATHS, ...manifest.RUNTIME_OTHER_PATHS];
  if (new Set(files).size !== files.length) throw new Error('Runtime asset inventory contains duplicate paths.');
  const destinations = new Set(files.map(manifest.optimizedAssetPath));
  if (destinations.size !== files.length) throw new Error('Optimized asset filenames collide.');
  let previous;
  try { previous = JSON.parse(await readFile(reportPath, 'utf8')); } catch { previous = null; }
  const entries = [];
  for (const source of files) {
    const destination = manifest.optimizedAssetPath(source);
    const sourcePath = resolve(root, 'public', source);
    const destinationPath = resolve(staging, destination);
    const bytes = await readFile(sourcePath);
    const sourceSha256 = sha256(bytes);
    await mkdir(dirname(destinationPath), { recursive: true });
    const previousEntry = previous?.encoderVersion === encoderVersion && previous?.quality === quality && Array.isArray(previous?.assets)
      ? previous.assets.find(asset => asset.source === source && asset.sourceSha256 === sourceSha256) : null;
    let cached = false;
    if (previousEntry) {
      try { cached = sha256(await readFile(destinationPath)) === previousEntry.optimizedSha256; } catch { /* encode again */ }
    }
    if (!cached) {
      if (images.includes(source)) {
        await run(encoder, ['-quiet', '-q', String(quality), '-m', '6', '-alpha_q', '100', '-metadata', 'none', sourcePath, '-o', destinationPath]);
      } else {
        await copyFile(sourcePath, destinationPath);
      }
    }
    const optimized = await readFile(destinationPath);
    const dimensions = images.includes(source) ? imageSize(bytes, source) : null;
    if (dimensions && dimensions.join('x') !== imageSize(optimized, destination).join('x')) {
      throw new Error(`Image dimensions changed: ${source}`);
    }
    entries.push({ source, destination, sourceBytes: bytes.length, optimizedBytes: optimized.length,
      dimensions, sourceSha256, optimizedSha256: sha256(optimized) });
  }
  const report = {
    encoder: 'cwebp', encoderVersion, quality, alphaQuality: 100,
    imageCount: images.length, audioCount: manifest.RUNTIME_AUDIO_PATHS.length,
    otherCount: manifest.RUNTIME_OTHER_PATHS.length,
    sourceBytes: entries.reduce((sum, asset) => sum + asset.sourceBytes, 0),
    optimizedBytes: entries.reduce((sum, asset) => sum + asset.optimizedBytes, 0),
    assets: entries,
  };
  await pruneUnusedAssets(resolve(staging, 'assets'), destinations);
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Runtime assets: ${report.imageCount} images, ${report.audioCount} sounds. ${(report.sourceBytes / 1e6).toFixed(2)} MB → ${(report.optimizedBytes / 1e6).toFixed(2)} MB; dimensions preserved, alpha quality 100.`);
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  optimizeRuntimeAssets().catch(error => { console.error(error.message); process.exitCode = 1; });
}
