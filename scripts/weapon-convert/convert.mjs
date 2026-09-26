// Converts WWII weapon sources (FBX/DAE/OBJ + loose PBR maps) to compact runtime GLBs.
// Output convention: Y up, muzzle toward +Z, real-world length in metres, magazine meshes named "Magazine".
import * as THREE from 'three';
import sharp from 'sharp';
import { Document, NodeIO } from '@gltf-transform/core';
import { EXTTextureWebP } from '@gltf-transform/extensions';
import { dedup, prune, weld } from '@gltf-transform/functions';
import { mkdirSync } from 'node:fs';
import { loadSource } from './load.mjs';

const W = process.env.WEAPONS;

/** Bake every mesh (skinned ones in their bind pose) to world-space triangles grouped by material. */
export function collect(root, config) {
  root.updateMatrixWorld(true);
  const parts = new Map();
  const point = new THREE.Vector3();
  root.traverse(object => {
    if (!object.isMesh || (config.drop && config.drop.test(object.name))) return;
    const geometry = object.geometry.index ? object.geometry.toNonIndexed() : object.geometry.clone();
    if (object.isSkinnedMesh) {
      const position = geometry.getAttribute('position');
      const proxy = new THREE.SkinnedMesh(geometry, object.material);
      proxy.skeleton = object.skeleton; proxy.bindMatrix.copy(object.bindMatrix); proxy.bindMatrixInverse.copy(object.bindMatrixInverse);
      for (let i = 0; i < position.count; i++) {
        point.fromBufferAttribute(position, i); proxy.applyBoneTransform(i, point); position.setXYZ(i, point.x, point.y, point.z);
      }
    }
    geometry.applyMatrix4(object.matrixWorld);
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    const groups = geometry.groups.length ? geometry.groups
      : [{ start: 0, count: geometry.attributes.position.count, materialIndex: 0 }];
    const magazine = !!(config.magazine && config.magazine.test(object.name));
    for (const group of groups) {
      const source = materials[group.materialIndex]?.name ?? 'default';
      const name = config.materialAlias?.[source] ?? source;
      const key = `${name}|${magazine}`;
      if (!parts.has(key)) parts.set(key, { material: name, magazine, positions: [], normals: [], uvs: [] });
      const part = parts.get(key);
      const p = geometry.attributes.position, n = geometry.attributes.normal, uv = geometry.attributes.uv;
      const end = Math.min(group.start + group.count, p.count);
      for (let i = group.start; i < end; i++) {
        part.positions.push(p.getX(i), p.getY(i), p.getZ(i));
        if (n) part.normals.push(n.getX(i), n.getY(i), n.getZ(i));
        part.uvs.push(uv ? uv.getX(i) : 0, uv ? uv.getY(i) : 0);
      }
    }
  });
  return [...parts.values()];
}

function bounds(parts) {
  const box = new THREE.Box3(), v = new THREE.Vector3();
  for (const part of parts) for (let i = 0; i < part.positions.length; i += 3) box.expandByPoint(v.fromArray(part.positions, i));
  return box;
}

/** World -> weapon space: longest axis becomes Z, next longest Y, with configured flips. */
export function orientation(parts, config) {
  const size = bounds(parts).getSize(new THREE.Vector3()).toArray();
  const order = [0, 1, 2].sort((a, b) => size[a] - size[b]);
  const axis = index => new THREE.Vector3(...[0, 1, 2].map(i => (i === index ? 1 : 0)));
  const yAxis = config.up ? new THREE.Vector3(...config.up) : axis(order[1]);
  const zAxis = config.forward ? new THREE.Vector3(...config.forward) : axis(order[2]);
  if (config.flipUp) yAxis.negate();
  if (config.flipForward) zAxis.negate();
  const xAxis = new THREE.Vector3().crossVectors(yAxis, zAxis);
  return new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis).transpose();
}

export function transformParts(parts, matrix, lengthMetres) {
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(matrix);
  const v = new THREE.Vector3();
  for (const part of parts) {
    for (let i = 0; i < part.positions.length; i += 3) v.fromArray(part.positions, i).applyMatrix4(matrix).toArray(part.positions, i);
    for (let i = 0; i < part.normals.length; i += 3) v.fromArray(part.normals, i).applyMatrix3(normalMatrix).normalize().toArray(part.normals, i);
  }
  const box = bounds(parts), size = box.getSize(new THREE.Vector3()), scale = lengthMetres / size.z;
  const centre = box.getCenter(new THREE.Vector3());
  for (const part of parts) for (let i = 0; i < part.positions.length; i += 3) {
    v.fromArray(part.positions, i).sub(centre).multiplyScalar(scale).toArray(part.positions, i);
  }
  return parts;
}

async function encode(path, maxSize, quality) {
  const image = sharp(path).resize({ width: maxSize, height: maxSize, fit: 'inside', withoutEnlargement: true });
  return new Uint8Array(await image.webp({ quality }).toBuffer());
}

/** glTF packs occlusion (R), roughness (G) and metalness (B) into one texture. */
async function packOrm({ ao, roughness, metallic }, maxSize) {
  const sources = [ao, roughness, metallic].filter(Boolean);
  const { width, height } = await sharp(sources[0]).metadata();
  const w = Math.min(maxSize, width), h = Math.min(maxSize, height);
  const channel = async (path, fallback) => path
    ? sharp(path).resize(w, h, { fit: 'fill' }).greyscale().raw().toBuffer()
    : Buffer.alloc(w * h, fallback);
  const [r, g, b] = await Promise.all([channel(ao, 255), channel(roughness, 255), channel(metallic, 0)]);
  const rgb = Buffer.alloc(w * h * 3);
  for (let i = 0; i < w * h; i++) { rgb[i * 3] = r[i]; rgb[i * 3 + 1] = g[i]; rgb[i * 3 + 2] = b[i]; }
  return new Uint8Array(await sharp(rgb, { raw: { width: w, height: h, channels: 3 } }).webp({ quality: 88 }).toBuffer());
}

export async function convert(id, config, outDir) {
  const root = await loadSource(`${W}/${config.source}`);
  const raw = collect(root, config);
  const parts = transformParts(raw, orientation(raw, config), config.length);
  const doc = new Document();
  doc.createExtension(EXTTextureWebP).setRequired(true);
  const buffer = doc.createBuffer();
  const scene = doc.createScene(id);
  const materials = new Map();
  const maxTexture = config.maxTexture ?? 2048;
  for (const [name, spec] of Object.entries(config.materials)) {
    const material = doc.createMaterial(name).setMetallicFactor(spec.metal ?? 1).setRoughnessFactor(spec.rough ?? 1);
    if (spec.color) material.setBaseColorFactor(spec.color);
    const texture = async (key, path, size, quality) => doc.createTexture(`${name}_${key}`)
      .setImage(await encode(`${W}/${path}`, size, quality)).setMimeType('image/webp');
    if (spec.base) material.setBaseColorTexture(await texture('base', spec.base, maxTexture, 85));
    if (spec.normal) material.setNormalTexture(await texture('normal', spec.normal, maxTexture, 90));
    if (spec.roughness || spec.metallic || spec.ao) {
      const orm = doc.createTexture(`${name}_orm`).setMimeType('image/webp').setImage(await packOrm({
        ao: spec.ao && `${W}/${spec.ao}`, roughness: spec.roughness && `${W}/${spec.roughness}`,
        metallic: spec.metallic && `${W}/${spec.metallic}` }, Math.min(1024, maxTexture)));
      material.setMetallicRoughnessTexture(orm);
      if (!spec.metallic) material.setMetallicFactor(spec.metal ?? 0);
      if (spec.ao) material.setOcclusionTexture(orm);
    } else if (spec.base) material.setMetallicFactor(spec.metal ?? 0).setRoughnessFactor(spec.rough ?? 0.6);
    materials.set(name, material);
  }
  for (const part of parts) {
    const material = materials.get(part.material);
    if (!material) throw new Error(`${id}: no material spec for "${part.material}"`);
    const uvs = new Float32Array(part.uvs);
    // FBX/DAE/OBJ loaders give three.js v-up UVs; GLB sources are already v-down.
    if (!config.source.toLowerCase().endsWith('.glb')) for (let i = 1; i < uvs.length; i += 2) uvs[i] = 1 - uvs[i];
    const primitive = doc.createPrimitive().setMaterial(material)
      .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(part.positions)).setBuffer(buffer))
      .setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(uvs).setBuffer(buffer));
    if (part.normals.length) {
      primitive.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(part.normals)).setBuffer(buffer));
    }
    const name = part.magazine ? 'Magazine' : `Body_${part.material}`;
    scene.addChild(doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(primitive)));
  }
  await doc.transform(weld(), dedup(), prune());
  mkdirSync(outDir, { recursive: true });
  await new NodeIO().registerExtensions([EXTTextureWebP]).write(`${outDir}/model.glb`, doc);
  return parts;
}
