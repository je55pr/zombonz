// Node shims so three's loaders can parse geometry without a browser.
import { DOMParser } from '@xmldom/xmldom';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { ColladaLoader } from 'three/addons/loaders/ColladaLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const fakeImage = () => ({ addEventListener() {}, removeEventListener() {}, set src(_) {}, style: {} });
globalThis.document ??= { createElementNS: fakeImage, createElement: fakeImage };
globalThis.self ??= globalThis;
globalThis.DOMParser ??= DOMParser;
globalThis.ProgressEvent ??= class { constructor(type, properties) { Object.assign(this, { type }, properties); } };
THREE.TextureLoader.prototype.load = function () { return new THREE.Texture(); };

/** Geometry-only GLB parse (Blender exports); textures come from the loose maps instead. */
async function loadGlb(path) {
  const bytes = readFileSync(path);
  const length = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.toString('utf8', 20, 20 + length));
  json.buffers[0].uri = `data:application/octet-stream;base64,${bytes.subarray(28 + length).toString('base64')}`;
  delete json.images; delete json.textures; delete json.samplers;
  json.materials = json.materials?.map(material => ({ name: material.name }));
  return (await new GLTFLoader().parseAsync(JSON.stringify(json), '')).scene;
}

export function loadSource(path) {
  const lower = path.toLowerCase();
  if (lower.endsWith('.glb')) return loadGlb(path);
  if (lower.endsWith('.fbx')) {
    const bytes = readFileSync(path);
    return new FBXLoader().parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  }
  if (lower.endsWith('.dae')) return new ColladaLoader().parse(readFileSync(path, 'utf8'), '').scene;
  if (lower.endsWith('.obj')) return new OBJLoader().parse(readFileSync(path, 'utf8'));
  throw new Error(`Unsupported source: ${path}`);
}

export function describe(root) {
  root.updateMatrixWorld(true);
  const meshes = [];
  root.traverse(object => {
    if (!object.isMesh) return;
    const materials = (Array.isArray(object.material) ? object.material : [object.material]).map(m => m?.name);
    const g = object.geometry;
    meshes.push({ name: object.name, materials, groups: g.groups.length,
      tris: (g.index ? g.index.count : g.attributes.position.count) / 3, uv: !!g.attributes.uv, skinned: !!object.isSkinnedMesh });
  });
  const box = new THREE.Box3().setFromObject(root);
  return { meshes, size: box.getSize(new THREE.Vector3()).toArray().map(v => +v.toFixed(3)),
    min: box.min.toArray().map(v => +v.toFixed(3)) };
}
