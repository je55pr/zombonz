import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { loadModel } from './runtimeAssets.ts';
import type { GameMap } from '../maps/gameMap.ts';

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
export function deadTreeGeometry(random: () => number, radialSegments = 7, heightSegments = 3, maxDepth = 3): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  const limb = (start: THREE.Vector3, direction: THREE.Vector3, length: number, radius: number, depth: number) => {
    const geometry = new THREE.CylinderGeometry(radius * 0.62, radius, length, radialSegments, heightSegments, true);
    geometry.translate(0, length / 2, 0);
    // Kink the middle rings sideways so no limb is ruler-straight.
    const position = geometry.attributes.position;
    const kinks = Array.from({ length: heightSegments + 1 }, (_, index) =>
      index === 0 || index === heightSegments ? 0 : (random() - 0.5) * radius * 1.6);
    for (let i = 0; i < position.count; i++) {
      const ring = Math.max(0, Math.min(heightSegments, Math.round(position.getY(i) / length * heightSegments)));
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
    const children = depth === maxDepth ? 3 : 2 + Math.floor(random() * 2);
    for (let child = 0; child < children; child++) {
      // Branches lean out from their parent and a little upward; the first carries the trunk on.
      const leader = child === 0 && depth >= 2;
      const tilt = leader ? 0.12 + random() * 0.15 : 0.45 + random() * 0.5;
      const axis = new THREE.Vector3(random() - 0.5, 0, random() - 0.5).normalize();
      const next = direction.clone().applyAxisAngle(axis, tilt).lerp(up, leader ? 0.1 : 0.15).normalize();
      limb(end, next, length * (leader ? 0.78 : 0.55 + random() * 0.2), radius * (leader ? 0.72 : 0.5), depth - 1);
    }
  };
  limb(new THREE.Vector3(0, -0.3, 0), up.clone(), 3 + random() * 1.5, 0.22 + random() * 0.1, maxDepth);
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

/** Partition each ring into local arcs so an off-camera arc does not draw every instance. */
export function scatterTreeSectors(group: THREE.Group, geometry: THREE.BufferGeometry, material: THREE.Material,
  placements: readonly THREE.Matrix4[], focus: { x: number; z: number }): void {
  const sectors: THREE.Matrix4[][] = Array.from({ length: 4 }, () => []);
  const position = new THREE.Vector3();
  for (const matrix of placements) {
    position.setFromMatrixPosition(matrix);
    const angle = Math.atan2(position.z - focus.z, position.x - focus.x);
    const index = Math.min(3, Math.floor((angle + Math.PI) / (2 * Math.PI) * sectors.length));
    sectors[index].push(matrix);
  }
  sectors.forEach((matrices, sector) => {
    if (!matrices.length) return;
    const mesh = new THREE.InstancedMesh(geometry, material, matrices.length);
    mesh.name = `treeline-sector-${sector}`;
    matrices.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
    mesh.computeBoundingSphere();
    mesh.receiveShadow = true;
    group.add(mesh);
  });
}

/**
 * The dead forest around a map, beyond its walls and into the fog: standing dead trees, fallen logs and
 * broken stumps, all instanced, plus the map's own planted trees. A map with walled grounds keeps its
 * forest outside them. Without the bark model the trees still stand, in plain dark wood.
 */
export async function buildTreeline(scene: THREE.Scene, map: Pick<GameMap, 'focus' | 'grounds' | 'trees'>): Promise<void> {
  const { focus, grounds } = map;
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
  // How far out from the focus, in a direction, the grounds end (with a margin for branches).
  const groundsEdge = (dx: number, dz: number): number => {
    if (!grounds) return 0;
    const edge = (min: number, max: number, from: number, d: number) => d > 0 ? (max - from) / d : d < 0 ? (min - from) / d : Infinity;
    return Math.min(edge(grounds.minX - 3, grounds.maxX + 3, focus.x, dx), edge(grounds.minZ - 3, grounds.maxZ + 3, focus.z, dz));
  };
  const place = (radius: number, spread: number, scale: number, lying = false) => {
    const angle = random() * Math.PI * 2;
    // Pushed beyond the grounds (and scattered again out there), rather than through the boundary wall.
    const edge = groundsEdge(Math.cos(angle), Math.sin(angle));
    const distance = Math.max(radius, edge + random() * 3) + random() * spread;
    const size = scale * (0.8 + random() * 0.45);
    return new THREE.Matrix4().compose(
      new THREE.Vector3(focus.x + Math.cos(angle) * distance, lying ? -0.05 : -0.1, focus.z + Math.sin(angle) * distance),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(lying ? 0 : (random() - 0.5) * 0.12, random() * Math.PI * 2, 0)),
      new THREE.Vector3(size, size, size));
  };
  // A close ring where trees show through windows, and a deep one that fades into the fog.
  const variants = Array.from({ length: 5 }, () => deadTreeGeometry(random));
  const near: THREE.Matrix4[][] = variants.map(() => []);
  for (let i = 0; i < 18; i++) near[i % variants.length].push(place(focus.radius * 1.3, 10, 1.1));
  (map.trees ?? []).forEach((tree, index) => near[index % variants.length].push(new THREE.Matrix4().compose(
    new THREE.Vector3(tree.x, (tree.y ?? 0) - 0.1, tree.z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler((random() - 0.5) * 0.1, random() * Math.PI * 2, 0)),
    new THREE.Vector3(tree.scale, tree.scale, tree.scale))));
  // The deep ring is seen through fog: retain its placement/silhouette but use fewer limb faces.
  const far: THREE.Matrix4[][] = [[], []];
  for (let i = 0; i < 60; i++) far[i % far.length].push(place(focus.radius * 1.62, 28, 1.25));
  variants.forEach((geometry, index) => scatterTreeSectors(group, geometry, bark, near[index], focus));
  far.forEach((placements, index) => scatterTreeSectors(group,
    deadTreeGeometry(seeded(0x7ee6 + index), 5, 2, 2), bark, placements, focus));
  if (logParts.length) {
    const logs = Array.from({ length: 12 }, () => place(focus.radius * 1.25, 30, 1.2, true));
    for (const part of logParts) scatterTreeSectors(group, part.geometry, part.material, logs, focus);
  }
  if (stump.status === 'fulfilled') {
    const stumps = Array.from({ length: 14 }, () => place(focus.radius * 1.2, 30, 1.1, true));
    for (const part of modelParts(stump.value.scene)) scatterTreeSectors(group, part.geometry, part.material, stumps, focus);
  }
}
