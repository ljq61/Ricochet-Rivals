import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Read the real TypeScript inventories without importing Phaser in build tools. */
export async function loadRuntimeAssetManifest() {
  const imports = {};
  for (const name of ['ArtAssets', 'SfxAssets', 'RuntimeAssets']) {
    const file = resolve(root, `src/game/config/${name}.ts`);
    const source = await readFile(file, 'utf8');
    let emitted = ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
      fileName: file,
    }).outputText;
    for (const [dependency, url] of Object.entries(imports)) {
      emitted = emitted.replaceAll(`'./${dependency}'`, JSON.stringify(url));
    }
    imports[name] = `data:text/javascript;base64,${Buffer.from(emitted).toString('base64')}`;
  }
  return import(imports.RuntimeAssets);
}
