// Lists connected pieces (islands) of an oriented weapon in normalized metres: Z forward, Y up.
import { loadSource } from './load.mjs';
import { collect, islands, orientation, transformParts } from './convert.mjs';
import { WEAPONS } from './weapons.mjs';

if (process.argv[2]) {
  const config = WEAPONS[process.argv[2]];
  const raw = collect(await loadSource(`${process.env.WEAPONS}/${config.source}`), config);
  const parts = transformParts(raw, orientation(raw, config), config.length);
  const list = islands(parts);
  const f = v => v.map(x => x.toFixed(3)).join(',');
  console.log(`${list.length} islands`);
  for (const g of list.slice(0, Number(process.argv[3] ?? 25))) {
    console.log(`${String(g.tris.length).padStart(6)} tris  x[${g.min[0].toFixed(3)},${g.max[0].toFixed(3)}] y[${g.min[1].toFixed(3)},${g.max[1].toFixed(3)}] z[${g.min[2].toFixed(3)},${g.max[2].toFixed(3)}] ${g.tris[0].part.material}`);
  }
}
