// Usage: WEAPONS=<extracted source dir> node run.mjs [id ...]   (writes to public/assets/weapons/<id>/model.glb)
import { statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { convert } from './convert.mjs';
import { WEAPONS } from './weapons.mjs';

const out = fileURLToPath(new URL('../../public/assets/weapons', import.meta.url));
const ids = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(WEAPONS);
for (const id of ids) {
  const parts = await convert(id, WEAPONS[id], `${out}/${id}`);
  const tris = parts.reduce((total, part) => total + part.positions.length / 9, 0);
  console.log(id.padEnd(14), `${(statSync(`${out}/${id}/model.glb`).size / 1e6).toFixed(2)} MB`, `${Math.round(tris)} tris`);
}
