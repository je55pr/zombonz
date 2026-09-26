// Side (Z right, Y up) and top (Z right, X down) silhouettes of oriented weapons, stacked in one PNG.
// Magazine parts are drawn red so their detection can be checked too.
import sharp from 'sharp';
import { loadSource } from './load.mjs';
import * as THREE from 'three';
import { applyIslandRules, collect, orientation, transformParts } from './convert.mjs';
import { WEAPONS } from './weapons.mjs';

const W = process.env.WEAPONS;
const ids = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(WEAPONS);
const cellW = 520, cellH = 150, pad = 10;
const image = Buffer.alloc(cellW * 2 * cellH * ids.length * 3, 255);
const width = cellW * 2;

function fillTriangle(a, b, c, colour, ox, oy) {
  const minX = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0]))), maxX = Math.min(cellW - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
  const minY = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1]))), maxY = Math.min(cellH - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
  const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  if (Math.abs(area) < 1e-9) return;
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
    const w0 = ((b[0] - x) * (c[1] - y) - (b[1] - y) * (c[0] - x)) / area;
    const w1 = ((c[0] - x) * (a[1] - y) - (c[1] - y) * (a[0] - x)) / area;
    if (w0 < 0 || w1 < 0 || w0 + w1 > 1) continue;
    const i = ((oy + y) * width + ox + x) * 3;
    image[i] = colour[0]; image[i + 1] = colour[1]; image[i + 2] = colour[2];
  }
}

for (const [row, id] of ids.entries()) {
  const config = WEAPONS[id];
  const raw = collect(await loadSource(`${W}/${config.source}`), config);
  let parts = transformParts(raw, orientation(raw, config), config.length);
  if (config.islandRules) parts = transformParts(applyIslandRules(parts, config.islandRules), new THREE.Matrix4(), config.length);
  // Fit both the length and the tallest/widest extent, so pistols are not clipped.
  let extent = 0;
  for (const part of parts) for (let i = 0; i < part.positions.length; i += 3) {
    extent = Math.max(extent, Math.abs(part.positions[i]), Math.abs(part.positions[i + 1]));
  }
  const scale = Math.min((cellW - 2 * pad) / config.length, (cellH / 2 - pad) / extent);
  for (const [view, ox] of [['side', 0], ['top', cellW]]) {
    for (const part of parts) {
      const colour = part.magazine ? [200, 40, 40] : [40, 40, 40];
      const p = part.positions;
      const project = i => [cellW / 2 + p[i + 2] * scale, cellH / 2 - (view === 'side' ? p[i + 1] : -p[i]) * scale];
      for (let i = 0; i < p.length; i += 9) fillTriangle(project(i), project(i + 3), project(i + 6), colour, ox, row * cellH);
    }
  }
  console.log(id, 'drawn');
}
await sharp(image, { raw: { width, height: cellH * ids.length, channels: 3 } }).png().toFile(process.env.OUT ?? 'preview.png');
