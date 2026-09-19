import * as THREE from 'three';

// Skeleton transforms still animate independently; shared parts draw once per material.
export class ActorBatch {
  private readonly batches = new Map<string, THREE.InstancedMesh>();
  constructor(private readonly scene: THREE.Scene) {}

  update(roots: Iterable<THREE.Object3D>): void {
    const parts = new Map<string, THREE.Mesh<THREE.BufferGeometry, THREE.Material>[]>();
    for (const root of roots) {
      root.updateMatrixWorld(true);
      root.traverse(object => {
        if (!(object instanceof THREE.Mesh) || Array.isArray(object.material)) return;
        const key = `${object.geometry.uuid}:${object.material.uuid}:${object.castShadow}:${object.receiveShadow}`;
        const list = parts.get(key) ?? []; list.push(object); parts.set(key, list);
      });
    }
    for (const batch of this.batches.values()) batch.count = 0;
    for (const [key, meshes] of parts) {
      let batch = this.batches.get(key);
      if (!batch || batch.instanceMatrix.count < meshes.length) {
        if (batch) { this.scene.remove(batch); batch.dispose(); }
        const first = meshes[0];
        batch = new THREE.InstancedMesh(first.geometry, first.material, 2 ** Math.ceil(Math.log2(meshes.length)));
        batch.name = 'zombie-batch';
        batch.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        batch.castShadow = first.castShadow; batch.receiveShadow = first.receiveShadow;
        // This small map's actors share a batch; don't use stale bounds as they move.
        batch.frustumCulled = false;
        this.scene.add(batch); this.batches.set(key, batch);
      }
      batch.count = meshes.length;
      meshes.forEach((mesh, index) => batch!.setMatrixAt(index, mesh.matrixWorld));
      batch.instanceMatrix.needsUpdate = true;
    }
  }
}
