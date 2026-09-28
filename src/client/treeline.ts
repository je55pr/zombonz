import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { loadModel } from './runtimeAssets.ts';

/** The treeline's models, for the start-screen download and warm-up. */
export const TREELINE_ASSETS = ['dead-tree', 'tree-stump'] as const;

/** A small seeded generator, so every player sees the same forest. */
function seeded(seed: number): () => number {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
}

/**
 * One bare dead tree: a crooked, tapering trunk that forks into branches three times over. Each limb is
 * a short cylinder bent at its joints; the bark texture repeats about every metre and a half.
 */
function deadTreeGeometry(random: () => number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  const limb = (start: THREE.Vector3, direction: THREE.Vector3, length: number, radius: number, depth: number) => {
    const geometry = new THREE.CylinderGeometry(radius * 0.62, radius, length, 7, 3, true);
    geometry.translate(0, length / 2, 0);
    // Kink the middle rings sideways so no limb is ruler-straight.
    const position = geometry.attributes.position;
    const kinks = [0, (random() - 0.5) * radius * 1.6, (random() - 0.5) * radius * 1.6, 0];
    for (let i = 0; i < position.count; i++) {
      const ring = Math.round(position.getY(i) / length * 3);
      position.setX(i, position.getX(i) + kinks[ring]);
    }
    const uv = geometry.attributes.uv;
    const around = Math.max(1, Math.round(radius * 8));
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * around, uv.getY(i) * length / 1.5);
    geometry.computeVertexNormals();
    geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, direction));
    geometry.translate(start.x, start.y, start.z);
    parts.push(geometry);
    if (depth === 0) return;
    const end = start.clone().addScaledVector(direction, length);
    const children = depth === 3 ? 3 : 2 + Math.floor(random() * 2);
    for (let child = 0; child < children; child++) {
      // Branches lean out from their parent and a little upward; the first carries the trunk on.
      const leader = child === 0 && depth >= 2;
      const tilt = leader ? 0.12 + random() * 0.15 : 0.45 + random() * 0.5;
      const axis = new THREE.Vector3(random() - 0.5, 0, random() - 0.5).normalize();
      const next = direction.clone().applyAxisAngle(axis, tilt).lerp(up, leader ? 0.1 : 0.15).normalize();
      limb(end, next, length * (leader ? 0.78 : 0.55 + random() * 0.2), radius * (leader ? 0.72 : 0.5), depth - 1);
    }
  };
  limb(new THREE.Vector3(0, -0.3, 0), up.clone(), 3 + random() * 1.5, 0.22 + random() * 0.1, 3);
  const merged = mergeGeometries(parts, false)!;
  parts.forEach(part => part.dispose());
  return merged;
}

/** Every mesh of a model, baked into its model-space transform, with its material. */
function modelParts(root: THREE.Object3D): Array<{ geometry: THREE.BufferGeometry; material: THREE.Material }> {
  root.updateMatrixWorld(true);
  const parts: Array<{ geometry: THREE.BufferGeometry; material: THREE.Material }> = [];
  root.traverse(object => {
    if (object instanceof THREE.Mesh && !Array.isArray(object.material)) {
      parts.push({ geometry: object.geometry.clone().applyMatrix4(object.matrixWorld), material: object.material });
    }
  });
  return parts;
}

function scatter(group: THREE.Group, geometry: THREE.BufferGeometry, material: THREE.Material,
  placements: THREE.Matrix4[]): void {
  const mesh = new THREE.InstancedMesh(geometry, material, placements.length);
  placements.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
  mesh.computeBoundingSphere();
  mesh.receiveShadow = true;
  group.add(mesh);
}

/**
 * The dead forest around a map, beyond its walls and into the fog: standing dead trees, fallen logs and
 * broken stumps, all instanced. Without the bark model the trees still stand, in plain dark wood.
 */
export async function buildTreeline(scene: THREE.Scene, focus: { x: number; z: number; radius: number }): Promise<void> {
  const group = new THREE.Group(); group.name = 'treeline'; scene.add(group);
  const [log, stump] = await Promise.allSettled(TREELINE_ASSETS.map(id => loadModel(`props/${id}/model.glb`)));
  const logParts = log.status === 'fulfilled' ? modelParts(log.value.scene) : [];
  let bark: THREE.Material = new THREE.MeshStandardMaterial({ color: 0x2b2722, roughness: 1 });
  const logMaterial = logParts[0]?.material;
  if (logMaterial instanceof THREE.MeshStandardMaterial) {
    bark = logMaterial.clone();
    for (const map of [logMaterial.map, logMaterial.normalMap, logMaterial.roughnessMap, logMaterial.aoMap]) {
      if (map) { map.wrapS = map.wrapT = THREE.RepeatWrapping; map.needsUpdate = true; }
    }
  }
  const random = seeded(0x7ee5);
  const place = (radius: number, spread: number, scale: number, lying = false) => {
    const angle = random() * Math.PI * 2, distance = radius + random() * spread;
    const size = scale * (0.8 + random() * 0.45);
    return new THREE.Matrix4().compose(
      new THREE.Vector3(focus.x + Math.cos(angle) * distance, lying ? -0.05 : -0.1, focus.z + Math.sin(angle) * distance),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(lying ? 0 : (random() - 0.5) * 0.12, random() * Math.PI * 2, 0)),
      new THREE.Vector3(size, size, size));
  };
  // A close ring where trees show through windows, and a deep one that fades into the fog.
  const variants = Array.from({ length: 5 }, () => deadTreeGeometry(random));
  const trees: THREE.Matrix4[][] = variants.map(() => []);
  for (let i = 0; i < 18; i++) trees[i % variants.length].push(place(focus.radius * 1.3, 10, 1.1));
  for (let i = 0; i < 60; i++) trees[i % variants.length].push(place(focus.radius * 1.62, 28, 1.25));
  variants.forEach((geometry, index) => scatter(group, geometry, bark, trees[index]));
  if (logParts.length) {
    const logs = Array.from({ length: 12 }, () => place(focus.radius * 1.25, 30, 1.2, true));
    for (const part of logParts) scatter(group, part.geometry, part.material, logs);
  }
  if (stump.status === 'fulfilled') {
    const stumps = Array.from({ length: 14 }, () => place(focus.radius * 1.2, 30, 1.1, true));
    for (const part of modelParts(stump.value.scene)) scatter(group, part.geometry, part.material, stumps);
  }
}
