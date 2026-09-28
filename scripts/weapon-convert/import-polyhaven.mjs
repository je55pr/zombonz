// Turns the realism-pass Poly Haven downloads (see docs/assets/ENVIRONMENT_PACK.md) into runtime assets:
// props become self-contained GLBs with 1K WebP textures (heavy meshes simplified to a triangle
// budget), tileable textures become the environment material convention (basecolor/normal/ARM WebP
// at 1K), and the night sky becomes a tone-mapped WebP panorama with the moon's position noted.
// Usage: node import-polyhaven.mjs   (run from this folder; reads the external asset cache)
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions';
import { dedup, prune, simplify, weld } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const CACHE = 'C:/ChatGPT/Shared/Cache/ZombonzAssets';
const publicRoot = fileURLToPath(new URL('../../public', import.meta.url));

/** Runtime id, Poly Haven id, what it is for, and an optional triangle budget. */
const PROPS = [
  ['dead-tree', 'dead_tree_trunk_02', 'Bare dead tree for the foggy treeline', 6000],
  ['tree-stump', 'tree_stump_01', 'Broken tree stump', 4000],
  ['hospital-bed', 'old_bed_frame', 'Rusted iron bed frame (sanatorium ward)', 12000],
  ['wheelchair', 'wheelchair_01', 'Old wheelchair', 12000],
  ['crutches', 'vintage_crutches_01', 'Wooden crutches'],
  ['steel-shelves', 'steel_frame_shelves_01', 'Steel storage shelves'],
  ['office-desk', 'metal_office_desk', 'Metal office desk'],
  ['wooden-chair', 'WoodenChair_01', 'Plain wooden chair', 8000],
  ['drawer-cabinet', 'drawer_cabinet', 'Wooden drawer cabinet', 10000],
  ['wall-clock', 'wall_clock', 'Wall clock'],
  ['power-box', 'power_box_01', 'Lever power box (the power switch)', 12000],
  ['utility-box', 'utility_box_02', 'Metal utility box (trap switches)'],
  ['generator', 'portable_generator', 'Portable generator (power room)', 12000],
  ['industrial-pipes', 'modular_industrial_pipes_01', 'Industrial wall pipes'],
  ['hanging-lamp', 'hanging_industrial_lamp', 'Hanging industrial lamp'],
];
/**
 * Runtime material id, Poly Haven texture id, what it is for, and an optional colour grade for the
 * base colour: the sources' salmon paint, maroon tiles and orange linoleum become an institution's
 * sage paint, grimy white tiles and worn, faded flooring.
 */
const MATERIALS = [
  ['peeling-paint-wall', 'peeling_painted_wall', 'Peeling painted plaster, graded sage-grey (sanatorium walls)',
    { saturation: 0, tint: { r: 186, g: 196, b: 176 } }],
  ['dirty-tiles', 'dirty_tiles', 'Grimy ceramic tiles, graded off-white (sanatorium wainscot)',
    { saturation: 0, tint: { r: 224, g: 226, b: 214 }, lift: [1.9, 34] }],
  ['old-linoleum', 'old_linoleum_flooring_01', 'Worn tiled floor, colours faded (sanatorium)', { brightness: 0.72, saturation: 0.3 }],
  ['cobblestone', 'cobblestone_floor_03', 'Dirty cobblestones (courtyard)'],
  ['old-planks', 'old_planks_02', 'Old weathered planks (beams, boards)'],
  ['old-wood-floor', 'old_wooden_floor_02', 'Old wooden floorboards (stair treads)'],
  ['forest-floor', 'leaves_forest_ground', 'Leaf-strewn forest floor (outside)'],
];
const SKY = { id: 'moonlit-night', source: 'rogland_moonlit_night', file: 'rogland_moonlit_night_2k.hdr' };

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
await MeshoptSimplifier.ready;

async function importProp([id, source, purpose, triangles]) {
  const doc = await io.read(`${CACHE}/props/polyhaven/${source}/${source}_1k.gltf`);
  doc.createExtension(EXTTextureWebP).setRequired(true);
  const before = countTriangles(doc);
  if (triangles && before > triangles) {
    // Weld first so the simplifier can collapse across the source's split vertices.
    await doc.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio: triangles / before, error: 0.01, lockBorder: false }));
  }
  await doc.transform(dedup(), prune());
  for (const texture of doc.getRoot().listTextures()) {
    const slots = new Set(doc.getGraph().listParentEdges(texture).map(edge => edge.getName()));
    const normal = slots.has('normalTexture');
    const image = await sharp(Buffer.from(texture.getImage()))
      .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: normal ? 90 : 86 }).toBuffer();
    texture.setImage(new Uint8Array(image)).setMimeType('image/webp');
    const uri = texture.getURI();
    if (uri) texture.setURI(uri.replace(/\.(png|jpe?g)$/i, '.webp'));
  }
  const dir = `${publicRoot}/assets/props/${id}`;
  mkdirSync(dir, { recursive: true });
  await io.write(`${dir}/model.glb`, doc);
  const bytes = statSync(`${dir}/model.glb`).size;
  console.log(`prop ${id}: ${before} -> ${countTriangles(doc)} triangles, ${(bytes / 1e6).toFixed(2)} MB`);
  return [id, { model: `/assets/props/${id}/model.glb`, purpose, source: `https://polyhaven.com/a/${source}`, license: 'CC0', bytes }];
}
function countTriangles(doc) {
  let total = 0;
  for (const mesh of doc.getRoot().listMeshes()) for (const primitive of mesh.listPrimitives()) {
    const indices = primitive.getIndices();
    total += (indices ? indices.getCount() : primitive.getAttribute('POSITION').getCount()) / 3;
  }
  return Math.round(total);
}

async function importMaterial([id, source, purpose, grade]) {
  const dir = `${publicRoot}/assets/environment/materials/${id}`;
  mkdirSync(dir, { recursive: true });
  const maps = { basecolor: 'diff', normal: 'nor_gl', arm: 'arm' };
  const entry = {};
  for (const [key, suffix] of Object.entries(maps)) {
    let image = sharp(`${CACHE}/environment-textures/polyhaven/${source}/${source}_${suffix}_1k.jpg`)
      .resize({ width: 1024, height: 1024, fit: 'inside' });
    if (key === 'basecolor' && grade) {
      image = image.modulate({ brightness: grade.brightness ?? 1, saturation: grade.saturation ?? 1 });
      if (grade.tint) image = image.tint(grade.tint);
    }
    let output = await image.webp({ quality: key === 'normal' ? 92 : 90 }).toBuffer();
    // A brightness lift runs as its own pass, after the grade.
    if (key === 'basecolor' && grade?.lift) output = await sharp(output).linear(...grade.lift).webp({ quality: 90 }).toBuffer();
    writeFileSync(`${dir}/${key}.webp`, output);
    entry[key] = `/assets/environment/materials/${id}/${key}.webp`;
  }
  console.log(`material ${id}`);
  return [id, { purpose, ...entry, armChannels: { r: 'ao', g: 'roughness', b: 'metallic' },
    source: `https://polyhaven.com/a/${source}`, sourceId: source, license: 'CC0' }];
}

/** Reads a Radiance .hdr (new-style run-length scanlines) into linear RGB floats. */
function readHdr(buffer) {
  let offset = 0;
  const line = () => { const end = buffer.indexOf(10, offset); const text = buffer.toString('latin1', offset, end); offset = end + 1; return text; };
  if (!line().startsWith('#?')) throw new Error('Not a Radiance HDR file');
  while (line().trim() !== '') { /* header */ }
  const [, height, , width] = line().trim().split(/\s+/).map(Number);
  const pixels = new Float32Array(width * height * 3);
  const scan = new Uint8Array(width * 4);
  for (let y = 0; y < height; y++) {
    if (buffer[offset] !== 2 || buffer[offset + 1] !== 2) throw new Error('Unsupported HDR encoding');
    offset += 4;
    for (let channel = 0; channel < 4; channel++) {
      for (let x = 0; x < width;) {
        let count = buffer[offset++];
        if (count > 128) { count -= 128; const value = buffer[offset++]; while (count--) scan[(x++) * 4 + channel] = value; }
        else while (count--) scan[(x++) * 4 + channel] = buffer[offset++];
      }
    }
    for (let x = 0; x < width; x++) {
      const e = scan[x * 4 + 3], scale = e ? 2 ** (e - 136) : 0;
      for (let c = 0; c < 3; c++) pixels[(y * width + x) * 3 + c] = scan[x * 4 + c] * scale;
    }
  }
  return { width, height, pixels };
}

async function importSky() {
  const { width, height, pixels } = readHdr(readFileSync(`${CACHE}/hdri/polyhaven/${SKY.source}/${SKY.file}`));
  // The moon is the brightest spot; the renderer turns the sky so it sits behind the moonlight.
  let brightest = 0, moon = { u: 0, v: 0 };
  for (let y = 0; y < height / 2; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 3, value = pixels[i] + pixels[i + 1] + pixels[i + 2];
    if (value > brightest) { brightest = value; moon = { u: (x + 0.5) / width, v: (y + 0.5) / height }; }
  }
  // Exposure to taste, then a filmic curve and sRGB encoding.
  let sum = 0;
  for (let i = 0; i < pixels.length; i++) sum += pixels[i];
  const exposure = 0.18 / (sum / pixels.length);
  const rgb = Buffer.alloc(width * height * 3);
  // The photo's own ground and hills don't belong behind our maps: below the moon the sky fades into
  // the scene's fog colour, as the fogged ground does, so the horizon is one soft band.
  const FOG = [0x1d, 0x2b, 0x30], FADE_FROM = moon.v + 0.015, FADE_TO = moon.v + 0.065;
  for (let i = 0; i < pixels.length; i++) {
    const v = pixels[i] * exposure, mapped = (v * (2.51 * v + 0.03)) / (v * (2.43 * v + 0.59) + 0.14);
    const clamped = Math.max(0, Math.min(1, mapped));
    const srgb = clamped <= 0.0031308 ? clamped * 12.92 : 1.055 * clamped ** (1 / 2.4) - 0.055;
    const row = Math.floor(i / 3 / width) / height;
    const t = Math.max(0, Math.min(1, (row - FADE_FROM) / (FADE_TO - FADE_FROM))), fade = t * t * (3 - 2 * t);
    rgb[i] = Math.round((Math.max(0, Math.min(1, srgb)) * (1 - fade) + FOG[i % 3] / 255 * fade) * 255);
  }
  const dir = `${publicRoot}/assets/environment/sky`;
  mkdirSync(dir, { recursive: true });
  await sharp(rgb, { raw: { width, height, channels: 3 } }).webp({ quality: 88 }).toFile(`${dir}/${SKY.id}.webp`);
  console.log(`sky ${SKY.id}: moon at u=${moon.u.toFixed(3)} v=${moon.v.toFixed(3)}`);
  return { image: `/assets/environment/sky/${SKY.id}.webp`, moon, source: `https://polyhaven.com/a/${SKY.source}`, license: 'CC0' };
}

const propsPath = `${publicRoot}/assets/props/manifest.json`;
const props = JSON.parse(readFileSync(propsPath, 'utf8'));
for (const prop of PROPS) { const [id, entry] = await importProp(prop); props.props[id] = entry; }
writeFileSync(propsPath, `${JSON.stringify(props, null, 2)}\n`);

const environmentPath = `${publicRoot}/assets/environment/manifest.json`;
const environment = JSON.parse(readFileSync(environmentPath, 'utf8'));
for (const material of MATERIALS) { const [id, entry] = await importMaterial(material); environment.materials[id] = entry; }
environment.sky = await importSky();
writeFileSync(environmentPath, `${JSON.stringify(environment, null, 2)}\n`);
