import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync } from 'node:fs';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Box3, Vector3 } from 'three';
export function readAssetJson(path) { return JSON.parse(readFileSync(path, 'utf8')); }
export function assetExists(path) { return existsSync(path); }
/** Every GLB under a folder. */
export function glbFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? glbFiles(`${dir}/${entry.name}`)
    : entry.name.endsWith('.glb') ? [`${dir}/${entry.name}`] : []);
}
/** A GLB's JSON chunk, read without loading its binary payload. */
export function readGlbJson(path) {
  const file = openSync(path, 'r');
  try {
    const header = Buffer.alloc(20); readSync(file, header, 0, 20, 0);
    const json = Buffer.alloc(header.readUInt32LE(12)); readSync(file, json, 0, json.length, 20);
    return JSON.parse(json.toString('utf8'));
  } finally { closeSync(file); }
}

// Geometry/rig inspection without decoding textures or requiring a GPU.
globalThis.ProgressEvent ??= class { constructor(type, properties) { Object.assign(this, { type }, properties); } };
export async function readAssetGeometry(path) {
  const bytes = readFileSync(path);
  const length = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.toString('utf8', 20, 20 + length));
  const binaryOffset = 28 + length;
  json.buffers[0].uri = `data:application/octet-stream;base64,${bytes.subarray(binaryOffset).toString('base64')}`;
  delete json.images; delete json.textures;
  json.materials = json.materials?.map(material => ({ name: material.name }));
  return new GLTFLoader().parseAsync(JSON.stringify(json), '');
}

if (process.argv[2]) {
  const gltf = await readAssetGeometry(process.argv[2]);
  gltf.scene.updateMatrixWorld(true);
  const box = new Box3().setFromObject(gltf.scene);
  console.log('bounds', box.min.toArray(), box.max.toArray(), 'size', box.getSize(new Vector3()).toArray());
  console.log('clips', gltf.animations.map(clip => ({ name: clip.name, duration: clip.duration,
    tracks: clip.tracks.slice(0, 6).map(track => ({ name: track.name, first: Array.from(track.values.slice(0, 3)) })) })));
  console.log('root children', gltf.scene.children.map(node => ({ name: node.name, rotation: node.rotation.toArray(), scale: node.scale.toArray() })));
}
