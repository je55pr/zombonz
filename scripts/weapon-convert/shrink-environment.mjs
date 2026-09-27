// Re-encodes every map in public/assets/environment/manifest.json at the size the game decodes it
// (ENVIRONMENT_TEXTURE_SIZE, 1024), as WebP, and points the manifest at the new files.
// Usage: node shrink-environment.mjs   (run from this folder; rewrites files in place)
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const SIZE = 1024;
const root = fileURLToPath(new URL('../../public', import.meta.url));
const manifestPath = `${root}/assets/environment/manifest.json`;
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

let before = 0, after = 0;
async function shrink(path, key) {
  const source = `${root}${path}`;
  const target = path.replace(/\.(png|jpe?g|webp)$/i, '.webp');
  const input = readFileSync(source);
  const output = await sharp(input)
    .resize({ width: SIZE, height: SIZE, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: key === 'normal' ? 92 : 90 }).toBuffer();
  writeFileSync(`${root}${target}`, output);
  if (target !== path && existsSync(source)) unlinkSync(source);
  before += input.length; after += output.length;
  return target;
}

for (const group of ['materials', 'decals']) {
  for (const [id, entry] of Object.entries(manifest[group])) {
    // Materials list their maps directly; decals nest them under `maps`.
    const maps = group === 'materials' ? entry : entry.maps;
    for (const [key, value] of Object.entries(maps)) {
      if (typeof value !== 'string' || !/\.(png|jpe?g|webp)$/i.test(value)) continue;
      maps[key] = await shrink(value, key);
    }
    console.log(`${group}/${id}`);
  }
}
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`environment maps: ${(before / 1e6).toFixed(1)} MB -> ${(after / 1e6).toFixed(1)} MB`);
