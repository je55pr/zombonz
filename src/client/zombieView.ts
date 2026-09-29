import * as THREE from 'three';
import type { BarrierState } from '../core/barrier.ts';
import type { ZombieState } from '../core/types.ts';
import type { Vec3 } from '../core/types.ts';
import { interpolatePosition } from './interpolation.ts';

// Shared low-poly parts; animation consumes simulation state and never changes it.
const cloth = new THREE.MeshStandardMaterial({ color: 0x465144, roughness: 1 });
const skin = new THREE.MeshStandardMaterial({ color: 0x8b9574, roughness: 1 });
const boots = new THREE.MeshStandardMaterial({ color: 0x282a24, roughness: 1 });
const eye = new THREE.MeshBasicMaterial({ color: 0xe6a640 });
const cube = new THREE.BoxGeometry(1, 1, 1);
export interface ZombieView {
  root: THREE.Group;
  update(zombie: ZombieState, tick: number, barrier?: BarrierState, previous?: Vec3, alpha?: number): void;
}
export function createZombieView(): ZombieView {
  const root = new THREE.Group();
  const body = new THREE.Group(); root.add(body);
  const part = (parent: THREE.Object3D, material: THREE.Material,
    x: number, y: number, z: number, sx: number, sy: number, sz: number) => {
    const mesh = new THREE.Mesh(cube, material);
    mesh.position.set(x, y, z); mesh.scale.set(sx, sy, sz);
    mesh.receiveShadow = true; parent.add(mesh); return mesh;
  };
  part(body, cloth, 0, 1.1, 0, 0.48, 0.61, 0.3);
  part(body, skin, 0, 1.53, 0, 0.3, 0.34, 0.3);
  for (const x of [-0.075, 0.075]) part(body, eye, x, 1.58, 0.153, 0.045, 0.025, 0.018);
  const arms: THREE.Group[] = [], legs: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const arm = new THREE.Group(); arm.position.set(side * 0.31, 1.36, 0); body.add(arm); arms.push(arm);
    part(arm, cloth, 0, -0.2, 0, 0.15, 0.4, 0.16);
    part(arm, skin, 0, -0.43, 0, 0.14, 0.12, 0.16);
    const leg = new THREE.Group(); leg.position.set(side * 0.14, 0.8, 0); body.add(leg); legs.push(leg);
    part(leg, cloth, 0, -0.32, 0, 0.19, 0.64, 0.22);
    part(leg, boots, 0, -0.73, 0.035, 0.2, 0.16, 0.29);
  }
  return { root, update(zombie, tick, barrier, previous, alpha = 1) {
    const position = interpolatePosition(previous, zombie.position, alpha);
    root.position.set(position.x, position.y, position.z);
    const phase = zombie.entry?.phase;
    const moving = Math.hypot(zombie.velocity.x, zombie.velocity.z) > 0.05;
    root.rotation.y = zombie.yaw;
    const walk = Math.sin(tick * 0.12 + Number(zombie.id.slice(2)));
    body.scale.y = phase === 'vaulting' ? 0.85 : 1;
    for (let i = 0; i < 2; i++) {
      legs[i].rotation.x = moving && phase !== 'vaulting' ? walk * (i ? -0.28 : 0.28) : 0;
      arms[i].rotation.x = phase === 'breaking'
        ? -1.3 + Math.sin((zombie.entry!.phaseTicks + i * 15) * 0.14) * 0.5
        : phase === 'vaulting' ? -1.7 : -0.65 + (moving ? walk * (i ? 0.12 : -0.12) : 0);
    }
  } };
}
