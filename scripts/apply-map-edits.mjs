import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const [sourcePath, editsPath] = process.argv.slice(2);
if (!sourcePath || !editsPath) {
  console.error('Usage: node scripts/apply-map-edits.mjs <map.json> <edits.json>');
  process.exit(2);
}
const original = JSON.parse(await readFile(sourcePath, 'utf8'));
const edits = JSON.parse(await readFile(editsPath, 'utf8'));
if (!Array.isArray(edits)) throw new Error('Edits must be an array');
for (const { path, value } of edits) {
  if (!Array.isArray(path) || !path.length || !path.every(part => typeof part === 'string' || Number.isInteger(part)))
    throw new Error('Invalid edit path');
  let parent = original;
  for (const part of path.slice(0, -1)) {
    if (parent == null || !(part in parent)) throw new Error(`Unknown edit path: ${path.join('.')}`);
    parent = parent[part];
  }
  const key = path.at(-1);
  if (parent == null || typeof parent !== 'object') throw new Error(`Unknown edit target: ${path.join('.')}`);
  if (Array.isArray(parent) && (typeof key !== 'number' || key < 0 || key > parent.length))
    throw new Error(`Array edit out of bounds: ${path.join('.')}`);
  if (Array.isArray(parent) && key === parent.length) parent.push(value);
  else parent[key] = value;
}
const vite = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), server: { middlewareMode: true, hmr: false }, appType: 'custom' });
try {
  const { validateMapDocument } = await vite.ssrLoadModule('/src/maps/mapDocument.ts');
  const errors = validateMapDocument(original);
  if (errors.length) throw new Error(errors.join('\n'));
} finally {
  await vite.close();
}
await writeFile(sourcePath, `${JSON.stringify(original, null, 2)}\n`);
console.log(`Applied ${edits.length} map edit(s) to ${sourcePath}`);
