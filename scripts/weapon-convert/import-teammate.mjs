// Builds the teammate figure: the CC-BY "WW2 US Army Ranger" (Tactical_Beard, Sketchfab), rigged by
// Mixamo, as one GLB with its skin, skeleton, 1K WebP PBR textures and four clips: idle, walk, run
// (both made to play in place) and death (which ends lying down, and doubles as the downed pose).
// Usage: node import-teammate.mjs   (run from this folder; reads the external asset cache)
import * as THREE from 'three';
import sharp from 'sharp';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { NodeIO } from '@gltf-transform/core';
import { EXTTextureWebP } from '@gltf-transform/extensions';
import { dedup, prune, resample, weld } from '@gltf-transform/functions';
import { mkdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadSource } from './load.mjs';

const ROOT = 'C:/ChatGPT/Shared/Cache/ZombonzAssets/originals/teammate';
const TEXTURES = `${ROOT}/source/model/textures`;
const out = fileURLToPath(new URL('../../public/assets/players/ranger', import.meta.url));
const CLIPS = { idle: 'Rifle Idle', walk: 'Rifle Walk', run: 'Rifle Run', death: 'Dying' };

// GLTFExporter builds its GLB through FileReader, which Node lacks.
globalThis.FileReader ??= class {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then(buffer => { this.result = buffer; this.onloadend?.(); }); }
  readAsDataURL(blob) {
    blob.arrayBuffer().then(buffer => {
      this.result = `data:${blob.type};base64,${Buffer.from(buffer).toString('base64')}`; this.onloadend?.();
    });
  }
};

const figure = await loadSource(`${ROOT}/mixamo/${CLIPS.idle}.fbx`);
// Plain named materials here; the real maps go on afterwards, matched by name.
figure.traverse(object => {
  if (!object.isMesh) return;
  const name = [].concat(object.material)[0].name.replace(/mat$/, '');
  object.material = new THREE.MeshStandardMaterial({ name });
});

/** Takes the forward drift out of the hips, keeping their sway, so a cycle plays in place. */
function inPlace(clip) {
  const hips = clip.tracks.find(track => /Hips\.position$/.test(track.name));
  if (!hips) return clip;
  const v = hips.values, n = v.length / 3, duration = hips.times[n - 1] || 1;
  const drift = [v[(n - 1) * 3] - v[0], 0, v[(n - 1) * 3 + 2] - v[2]];
  for (let i = 0; i < n; i++) {
    const t = hips.times[i] / duration;
    v[i * 3] -= drift[0] * t; v[i * 3 + 2] -= drift[2] * t;
  }
  return clip;
}
const clips = [];
const pace = {};
for (const [name, file] of Object.entries(CLIPS)) {
  const clip = (name === 'idle' ? figure : await loadSource(`${ROOT}/mixamo/${file}.fbx`)).animations[0].clone();
  clip.name = name;
  const hips = clip.tracks.find(track => /Hips\.position$/.test(track.name));
  if (hips && (name === 'walk' || name === 'run')) {
    const v = hips.values, n = v.length / 3;
    pace[name] = Math.hypot(v[(n - 1) * 3] - v[0], v[(n - 1) * 3 + 2] - v[2]) / clip.duration;
    inPlace(clip);
  }
  clips.push(clip);
}

const glb = await new GLTFExporter().parseAsync(figure, { binary: true, animations: clips, onlyVisible: false });
const io = new NodeIO().registerExtensions([EXTTextureWebP]);
const doc = await io.readBinary(new Uint8Array(glb));
doc.createExtension(EXTTextureWebP).setRequired(true);

// Teammates are seen from a few metres away: the uniform's colour keeps 1K, everything else 512.
const encode = async (path, size, quality) => new Uint8Array(await sharp(path).resize(size, size, { fit: 'inside' }).webp({ quality }).toBuffer());
async function orm(name, size = 512) {
  const read = suffix => sharp(`${TEXTURES}/${name}_${suffix}.jpg`).resize(size, size, { fit: 'fill' }).greyscale().raw().toBuffer();
  const [ao, roughness, metallic] = await Promise.all([read('AO'), read('roughness'), read('metallic')]);
  const rgb = Buffer.alloc(size * size * 3);
  for (let i = 0; i < size * size; i++) { rgb[i * 3] = ao[i]; rgb[i * 3 + 1] = roughness[i]; rgb[i * 3 + 2] = metallic[i]; }
  return new Uint8Array(await sharp(rgb, { raw: { width: size, height: size, channels: 3 } }).webp({ quality: 85 }).toBuffer());
}
for (const material of doc.getRoot().listMaterials()) {
  const name = material.getName();
  const texture = (key, image) => doc.createTexture(`${name}_${key}`).setImage(image).setMimeType('image/webp');
  const packed = texture('orm', await orm(name));
  material.setBaseColorTexture(texture('base', await encode(`${TEXTURES}/${name}_albedo.jpg`, name === 'Cloth' ? 1024 : 512, 85)))
    .setNormalTexture(texture('normal', await encode(`${TEXTURES}/${name}_normal.jpg`, 512, 88)))
    .setMetallicRoughnessTexture(packed).setOcclusionTexture(packed).setMetallicFactor(1).setRoughnessFactor(1);
}
await doc.transform(weld(), resample(), dedup(), prune());
mkdirSync(out, { recursive: true });
await io.write(`${out}/model.glb`, doc);
console.log(`ranger: ${(statSync(`${out}/model.glb`).size / 1e6).toFixed(2)} MB, clips ${clips.map(clip => `${clip.name} ${clip.duration.toFixed(2)}s`).join(', ')}`);
console.log(`ground speed of the cycles (m/s): ${JSON.stringify(pace)}`);
