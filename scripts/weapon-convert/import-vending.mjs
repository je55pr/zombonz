// Converts the CC-BY "Vintage Vending Machine" (cansuaydin, Sketchfab) into the perk machine: a GLB
// 2.1 m tall with its base at y = 0 and its front toward +z, plus one base-colour map per perk.
// The source's Dr Pepper logo and branded bottle decal are painted out with clean panel from nearby,
// and the green paint is regraded per perk (Jugger-Nog red, Double Tap amber, Quick Revive blue;
// Speed Cola keeps the original green).
// Usage: node import-vending.mjs   (run from this folder; reads the external asset cache)
import * as THREE from 'three';
import sharp from 'sharp';
import { Document, NodeIO } from '@gltf-transform/core';
import { EXTTextureWebP } from '@gltf-transform/extensions';
import { dedup, prune, weld } from '@gltf-transform/functions';
import { mkdirSync, writeFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadSource } from './load.mjs';

const SOURCE = 'C:/ChatGPT/Shared/Cache/ZombonzAssets/originals/vending';
const MAPS = `${SOURCE}/source/Model/Textures`;
const out = fileURLToPath(new URL('../../public/assets/props/vending-machine', import.meta.url));
const HEIGHT = 2.1;
const SIZE = 1024;
/** Hue turns (degrees) from the source green, and a brightness, for each perk's paint. */
const PERKS = { juggernog: [-125, 0.95], 'double-tap': [-95, 1.05], 'speed-cola': [0, 1], 'quick-revive': [75, 1] };
/** Trademarked artwork: [centre x, centre y, radius] in the 2048 px texture, and where clean panel is. */
const COVERS = [
  { at: [495, 1140], radius: 104, from: [735, 1140] }, // the Dr Pepper roundel
  { at: [225, 1412], radius: 100, from: [225, 1208] }, // the hand holding a branded bottle
];

async function cleanDiffuse() {
  let image = sharp(`${MAPS}/Texture_1_Diffuse.png`).removeAlpha();
  const layers = [];
  for (const { at, radius, from } of COVERS) {
    const size = radius * 2;
    const patch = await sharp(`${MAPS}/Texture_1_Diffuse.png`).removeAlpha()
      .extract({ left: from[0] - radius, top: from[1] - radius, width: size, height: size }).raw().toBuffer();
    // A soft-edged disc, so the patch blends into the paint around it.
    const mask = Buffer.alloc(size * size);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - radius + 0.5, y - radius + 0.5) / radius;
      mask[y * size + x] = Math.round(255 * Math.max(0, Math.min(1, (1 - d) / 0.25)));
    }
    const rgba = Buffer.alloc(size * size * 4);
    for (let i = 0; i < size * size; i++) { rgba.set(patch.subarray(i * 3, i * 3 + 3), i * 4); rgba[i * 4 + 3] = mask[i]; }
    layers.push({ input: rgba, raw: { width: size, height: size, channels: 4 }, left: at[0] - radius, top: at[1] - radius });
  }
  return image.composite(layers).png().toBuffer();
}

async function orm() {
  const read = path => sharp(path).resize(SIZE, SIZE, { fit: 'fill' }).greyscale().raw().toBuffer();
  const [ao, roughness, metallic] = await Promise.all([
    read(`${SOURCE}/textures/vendingMachine_LP_DefaultMaterial_Ambient.png`), read(`${MAPS}/Texture_6_Roughness.png`),
    read(`${MAPS}/Texture_3_Metallic.png`)]);
  const rgb = Buffer.alloc(SIZE * SIZE * 3);
  for (let i = 0; i < SIZE * SIZE; i++) { rgb[i * 3] = ao[i]; rgb[i * 3 + 1] = roughness[i]; rgb[i * 3 + 2] = metallic[i]; }
  return sharp(rgb, { raw: { width: SIZE, height: SIZE, channels: 3 } }).webp({ quality: 88 }).toBuffer();
}

// Geometry: every group but the glass is opaque; the glass is its own see-through part.
const root = await loadSource(`${SOURCE}/source/Model/Final.obj`);
root.updateMatrixWorld(true);
const parts = { body: { positions: [], normals: [], uvs: [] }, glass: { positions: [], normals: [], uvs: [] } };
const box = new THREE.Box3();
root.traverse(object => {
  if (!object.isMesh) return;
  const geometry = (object.geometry.index ? object.geometry.toNonIndexed() : object.geometry.clone()).applyMatrix4(object.matrixWorld);
  const part = /glass/i.test(object.name) ? parts.glass : parts.body;
  const p = geometry.attributes.position, n = geometry.attributes.normal, uv = geometry.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    part.positions.push(p.getX(i), p.getY(i), p.getZ(i));
    part.normals.push(n.getX(i), n.getY(i), n.getZ(i));
    part.uvs.push(uv.getX(i), 1 - uv.getY(i));
    box.expandByPoint(new THREE.Vector3(p.getX(i), p.getY(i), p.getZ(i)));
  }
});
// Turn the machine to face +z, then stand it 2.1 m tall.
const centre = box.getCenter(new THREE.Vector3()), glass = new THREE.Box3();
for (let i = 0; i < parts.glass.positions.length; i += 3) glass.expandByPoint(new THREE.Vector3(...parts.glass.positions.slice(i, i + 3)));
const front = glass.getCenter(new THREE.Vector3()).sub(centre).setY(0);
// The front runs across the machine's width (it is wider than deep); the glass, which sits off to
// one side of the front, only says which of those two faces is the front.
const wide = box.max.x - box.min.x > box.max.z - box.min.z;
const turn = wide ? (front.z > 0 ? 0 : Math.PI) : (front.x > 0 ? Math.PI / 2 : -Math.PI / 2);
console.log(`glass offset from centre: x ${front.x.toFixed(2)} z ${front.z.toFixed(2)} (source units)`);
const scale = HEIGHT / (box.max.y - box.min.y);
const matrix = new THREE.Matrix4().makeScale(scale, scale, scale)
  .multiply(new THREE.Matrix4().makeRotationY(-turn))
  .multiply(new THREE.Matrix4().makeTranslation(-centre.x, -box.min.y, -centre.z));
const normalMatrix = new THREE.Matrix3().getNormalMatrix(matrix);
for (const part of Object.values(parts)) {
  const v = new THREE.Vector3();
  for (let i = 0; i < part.positions.length; i += 3) {
    v.fromArray(part.positions, i).applyMatrix4(matrix).toArray(part.positions, i);
    v.fromArray(part.normals, i).applyMatrix3(normalMatrix).normalize().toArray(part.normals, i);
  }
}

mkdirSync(out, { recursive: true });
const diffuse = await cleanDiffuse();
const variants = {};
for (const [perk, [hue, brightness]] of Object.entries(PERKS)) {
  const image = await sharp(diffuse).resize(SIZE, SIZE).modulate({ hue: (hue + 360) % 360, brightness }).webp({ quality: 86 }).toBuffer();
  writeFileSync(`${out}/paint-${perk}.webp`, image);
  variants[perk] = `/assets/props/vending-machine/paint-${perk}.webp`;
}

const doc = new Document();
doc.createExtension(EXTTextureWebP).setRequired(true);
const buffer = doc.createBuffer();
const scene = doc.createScene('vending-machine');
const texture = (name, image) => doc.createTexture(name).setImage(new Uint8Array(image)).setMimeType('image/webp');
const base = texture('paint', await sharp(diffuse).resize(SIZE, SIZE).webp({ quality: 86 }).toBuffer());
const normal = texture('normal', await sharp(`${MAPS}/Texture_4_Normal.png`).resize(SIZE, SIZE).webp({ quality: 90 }).toBuffer());
const packed = texture('orm', await orm());
const body = doc.createMaterial('Body').setBaseColorTexture(base).setNormalTexture(normal)
  .setMetallicRoughnessTexture(packed).setOcclusionTexture(packed).setMetallicFactor(1).setRoughnessFactor(1);
const glassMaterial = doc.createMaterial('Glass').setBaseColorFactor([0.55, 0.65, 0.62, 0.28]).setAlpha(0.28)
  .setAlphaMode('BLEND').setMetallicFactor(0).setRoughnessFactor(0.08);
for (const [name, part] of Object.entries(parts)) {
  const primitive = doc.createPrimitive().setMaterial(name === 'glass' ? glassMaterial : body)
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(part.positions)).setBuffer(buffer))
    .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(part.normals)).setBuffer(buffer))
    .setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(new Float32Array(part.uvs)).setBuffer(buffer));
  scene.addChild(doc.createNode(name === 'glass' ? 'Glass' : 'Body').setMesh(doc.createMesh(name).addPrimitive(primitive)));
}
await doc.transform(weld(), dedup(), prune());
await new NodeIO().registerExtensions([EXTTextureWebP]).write(`${out}/model.glb`, doc);
const size = new THREE.Vector3().subVectors(box.max, box.min).multiplyScalar(scale);
console.log(`vending machine: ${(statSync(`${out}/model.glb`).size / 1e6).toFixed(2)} MB, ${size.x.toFixed(2)} x ${size.y.toFixed(2)} x ${size.z.toFixed(2)} m, front turned ${(turn * 180 / Math.PI).toFixed(0)} deg`);
console.log(JSON.stringify(variants));
