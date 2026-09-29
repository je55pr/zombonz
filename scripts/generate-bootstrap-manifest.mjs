import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const assets = join(root, 'assets');
const included = path => /\.(glb|webp|png|jpe?g|mp3|ogg|wav|ktx2)$/i.test(path)
  || path === 'environment/manifest.json';

async function files(directory) {
  const result = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, item.name);
    if (item.isDirectory()) result.push(...await files(path));
    else if (item.isFile()) result.push(path);
  }
  return result;
}

const entries = [];
for (const path of await files(assets)) {
  const name = relative(assets, path).split(sep).join('/');
  if (!included(name)) continue;
  const bytes = await readFile(path);
  entries.push([`assets/${name}`, { size: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') }]);
}
entries.sort(([a], [b]) => a.localeCompare(b));
const destination = join(assets, 'bootstrap-manifest.json');
const assetFiles = Object.fromEntries(entries);
const revision = createHash('sha256').update(JSON.stringify(assetFiles)).digest('hex');
await writeFile(destination, `${JSON.stringify({ version: 1, revision, files: assetFiles }, null, 2)}\n`);
console.log(`Wrote ${entries.length} asset records to ${destination}`);
