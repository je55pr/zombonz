import * as THREE from 'three';
import type { GreyboxBox, GreyboxPrism } from '../maps/gameMap.ts';
import { bunkerMaterial, environmentMaterial, materialForBox, projectWorldUvs } from './environmentMaterials.ts';
export { bunkerMaterial } from './environmentMaterials.ts';

export function buildGreybox(boxes: readonly GreyboxBox[], prisms: readonly GreyboxPrism[] = []): THREE.Group {
  const group = new THREE.Group(); group.name = 'map-greybox';
  for (const entry of boxes) {
    if (entry.visible === false) continue;
    const geometry = new THREE.BoxGeometry(entry.size.x, entry.size.y, entry.size.z);
    projectWorldUvs(geometry, new THREE.Vector3(entry.center.x, entry.center.y, entry.center.z));
    const mesh = new THREE.Mesh(geometry, environmentMaterial(materialForBox(entry)));
    mesh.position.set(entry.center.x, entry.center.y, entry.center.z);
    mesh.rotation.z = entry.rotationZ ?? 0;
    mesh.receiveShadow = true; mesh.castShadow = entry.material !== 'floor' && entry.material !== 'upperFloor';
    group.add(mesh);
  }
  for (const entry of prisms) {
    const shape = new THREE.Shape(entry.points.map(([x, z]) => new THREE.Vector2(x, -z)));
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: entry.top - entry.bottom, bevelEnabled: false, steps: 1 });
    geometry.rotateX(-Math.PI / 2); geometry.translate(0, entry.bottom, 0);
    projectWorldUvs(geometry);
    const mesh = new THREE.Mesh(geometry, bunkerMaterial(entry.material));
    mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh);
  }
  return group;
}
