import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Bake world transforms once, retaining material/shadow flags and local culling.
// Mark animated objects (or their parents) dynamic before calling this.
export function batchStaticMeshes(root: THREE.Object3D): void {
  root.updateMatrixWorld(true);
  const inverse = root.matrixWorld.clone().invert();
  const buckets = new Map<string, THREE.Mesh<THREE.BufferGeometry, THREE.Material>[]>();
  const position = new THREE.Vector3();
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh) || Array.isArray(object.material) || object.material.transparent) return;
    for (let parent: THREE.Object3D | null = object; parent; parent = parent.parent) {
      if (parent.userData.dynamic || !parent.visible) return;
      if (parent === root) break;
    }
    object.getWorldPosition(position);
    const cell = [position.x, position.y, position.z].map(value => Math.floor(value / 12)).join(',');
    // Shared environment materials now span indexed boxes, non-indexed slabs and
    // imported GLBs. Only merge compatible vertex layouts; never drop tangents/UVs.
    const attributes = Object.entries((object.geometry as THREE.BufferGeometry).attributes).sort(([a], [b]) => a.localeCompare(b))
      .map(([name, attribute]) => `${name}:${attribute.itemSize}:${attribute.normalized}:${attribute.array.constructor.name}`).join('|');
    const key = `${object.material.uuid}:${object.castShadow}:${object.receiveShadow}:${cell}:${!!object.geometry.index}:${attributes}`;
    const bucket = buckets.get(key) ?? []; bucket.push(object); buckets.set(key, bucket);
  });
  for (const meshes of buckets.values()) {
    if (meshes.length < 2) continue;
    const geometries = meshes.map(mesh => mesh.geometry.clone().applyMatrix4(
      new THREE.Matrix4().multiplyMatrices(inverse, mesh.matrixWorld)));
    const geometry = mergeGeometries(geometries, false);
    geometries.forEach(item => item.dispose());
    if (!geometry) continue;
    geometry.computeBoundingSphere();
    const batch = new THREE.Mesh(geometry, meshes[0].material);
    batch.name = 'static-batch';
    batch.castShadow = meshes[0].castShadow; batch.receiveShadow = meshes[0].receiveShadow;
    meshes.forEach(mesh => mesh.removeFromParent());
    root.add(batch);
  }
}
