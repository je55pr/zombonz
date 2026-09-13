import * as THREE from 'three';
import type { GreyboxBox, GreyboxMaterial } from '../maps/nacht.ts';

const COLORS: Record<GreyboxMaterial, number> = {
  wall: 0x55534d,
  floor: 0x282824,
  upperFloor: 0x33332f,
  stair: 0x494842,
  barrier: 0x5a4030,
};

function materialFor(kind: GreyboxMaterial): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: COLORS[kind],
    roughness: 0.95,
    metalness: 0.02,
  });
}

export function buildGreybox(boxes: readonly GreyboxBox[]): THREE.Group {
  const group = new THREE.Group();
  group.name = 'nacht-greybox';

  for (const entry of boxes) {
    const geometry = new THREE.BoxGeometry(entry.size.x, entry.size.y, entry.size.z);
    const mesh = new THREE.Mesh(geometry, materialFor(entry.material));
    mesh.position.set(entry.center.x, entry.center.y, entry.center.z);
    mesh.rotation.z = entry.rotationZ ?? 0;
    mesh.receiveShadow = true;
    mesh.castShadow = entry.material !== 'floor' && entry.material !== 'upperFloor';
    group.add(mesh);
  }

  return group;
}
