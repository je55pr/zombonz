import * as THREE from 'three';
import type { PowerupDrop, PowerupKind } from '../core/powerups.ts';

/** BO1 timeout blink: 15 half-second, 10 quarter-second, then 15 tenth-second flashes. */
const BLINK_STEPS: readonly number[] = [
  ...Array<number>(15).fill(30), ...Array<number>(10).fill(15), ...Array<number>(15).fill(6),
];
const BLINK_TICKS = BLINK_STEPS.reduce((total, ticks) => total + ticks, 0);

export function powerupBlinkVisible(ticksRemaining: number): boolean {
  let elapsed = BLINK_TICKS - ticksRemaining;
  if (elapsed < 0) return true;
  for (let step = 0; step < BLINK_STEPS.length; step += 1) {
    if (elapsed < BLINK_STEPS[step]) return step % 2 === 0;
    elapsed -= BLINK_STEPS[step];
  }
  return false;
}

const PICKUP_COLOURS: Record<PowerupKind, number> = {
  maxAmmo: 0xb4e38c, doublePoints: 0xffd473, instaKill: 0xff816b,
  nuke: 0x87d7ff, carpenter: 0xf0b070,
};

/** Original geometry keeps every pickup recognizable without external model or texture licences. */
export function buildPowerupModel(kind: PowerupKind): THREE.Group {
  const root = new THREE.Group();
  const mat = (colour: number, metalness = 0.15) => new THREE.MeshStandardMaterial({
    color: colour, roughness: 0.57, metalness,
  });
  const dark = mat(0x30352c, 0.55), steel = mat(0xaab1a3, 0.7);
  const wood = mat(0x765336), gold = mat(0xc7a045, 0.68), bone = mat(0xd9c9a9);
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material, x = 0, y = 0, z = 0) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z); root.add(mesh); return mesh;
  };
  if (kind === 'maxAmmo') {
    // Strapped ammunition crate with brass rounds above the lid.
    const olive = mat(0x4d5a3c);
    add(new THREE.BoxGeometry(0.7, 0.36, 0.46), olive);
    add(new THREE.BoxGeometry(0.73, 0.07, 0.49), dark, 0, 0.21);
    for (const x of [-0.29, 0.29]) add(new THREE.BoxGeometry(0.08, 0.35, 0.48), steel, x);
    add(new THREE.BoxGeometry(0.14, 0.11, 0.035), gold, 0, 0.05, 0.25);
    for (const x of [-0.18, 0, 0.18]) {
      const round = add(new THREE.CylinderGeometry(0.037, 0.037, 0.18, 8), gold, x, 0.27);
      round.rotation.z = Math.PI / 2;
    }
  } else if (kind === 'nuke') {
    // Finned aerial bomb with a pointed nose and a band around the casing.
    const casing = mat(0x3c493d, 0.45);
    add(new THREE.CylinderGeometry(0.19, 0.2, 0.72, 12), casing);
    add(new THREE.ConeGeometry(0.19, 0.28, 12), casing, 0, 0.5);
    add(new THREE.CylinderGeometry(0.12, 0.12, 0.13, 12), dark, 0, -0.41);
    add(new THREE.TorusGeometry(0.198, 0.02, 6, 16), gold, 0, 0.12).rotation.x = Math.PI / 2;
    for (let i = 0; i < 4; i++) {
      const angle = i * Math.PI / 2;
      const fin = add(new THREE.BoxGeometry(0.34, 0.26, 0.035), casing,
        Math.cos(angle) * 0.19, -0.38, -Math.sin(angle) * 0.19);
      fin.rotation.y = angle;
    }
  } else if (kind === 'doublePoints') {
    // Two staggered standing coins with raised marks.
    for (const [x, z] of [[-0.16, 0.07], [0.16, -0.07]]) {
      add(new THREE.CylinderGeometry(0.26, 0.26, 0.065, 20), gold, x, 0, z).rotation.z = Math.PI / 2;
      add(new THREE.TorusGeometry(0.19, 0.018, 6, 20), steel, x + 0.037, 0, z).rotation.y = Math.PI / 2;
      add(new THREE.BoxGeometry(0.018, 0.24, 0.045), steel, x + 0.04, 0, z);
    }
  } else if (kind === 'instaKill') {
    // Skull silhouette with dark eye sockets and a separate jaw.
    add(new THREE.SphereGeometry(0.3, 12, 10), bone, 0, 0.06);
    add(new THREE.BoxGeometry(0.34, 0.16, 0.25), bone, 0, -0.22, 0.08);
    for (const x of [-0.12, 0.12]) add(new THREE.SphereGeometry(0.09, 8, 6), dark, x, 0.05, 0.25);
    add(new THREE.ConeGeometry(0.055, 0.11, 6), dark, 0, -0.1, 0.3).rotation.z = Math.PI;
    for (const x of [-0.09, 0, 0.09]) add(new THREE.BoxGeometry(0.018, 0.065, 0.018), dark, x, -0.27, 0.215);
  } else {
    // Carpenter: crossed repair boards with a steel hammer.
    for (const tilt of [-0.55, 0.55]) {
      add(new THREE.BoxGeometry(0.16, 0.72, 0.075), wood).rotation.z = tilt;
      for (const y of [-0.23, 0.23]) add(new THREE.SphereGeometry(0.018, 6, 4), steel,
        -y * Math.sin(tilt), y * Math.cos(tilt), 0.052);
    }
    add(new THREE.CylinderGeometry(0.025, 0.03, 0.5, 8), wood, 0.1, 0.02, 0.09).rotation.z = -0.7;
    add(new THREE.BoxGeometry(0.32, 0.1, 0.11), steel, 0.25, 0.21, 0.09).rotation.z = -0.7;
  }
  for (const material of [dark, steel, wood, gold, bone]) {
    if (!root.children.some(child => child instanceof THREE.Mesh && child.material === material)) material.dispose();
  }
  return root;
}

function disposeModel(root: THREE.Group): void {
  const materials = new Set<THREE.Material>();
  root.traverse(child => {
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose(); materials.add(child.material as THREE.Material);
    }
  });
  for (const material of materials) material.dispose();
}

export class PowerupView {
  private readonly objects = new Map<string, THREE.Group>();
  private readonly ring = new THREE.TorusGeometry(0.48, 0.025, 6, 20);
  private readonly glow = Object.fromEntries(Object.entries(PICKUP_COLOURS).map(([kind, colour]) => [kind,
    new THREE.MeshBasicMaterial({ color: colour })])) as Record<PowerupKind, THREE.MeshBasicMaterial>;

  constructor(private readonly scene: THREE.Scene) {}

  update(drops: readonly PowerupDrop[], tick: number): void {
    const active = new Set(drops.map(drop => drop.id));
    for (const [id, object] of this.objects) if (!active.has(id)) {
      object.removeFromParent(); disposeModel(object.children[0] as THREE.Group); this.objects.delete(id);
    }
    for (const drop of drops) {
      let object = this.objects.get(drop.id);
      if (!object) {
        object = new THREE.Group();
        object.add(buildPowerupModel(drop.kind));
        const halo = new THREE.Mesh(this.ring, this.glow[drop.kind]);
        halo.rotation.x = Math.PI / 2; halo.position.y = -0.42; object.add(halo);
        this.scene.add(object); this.objects.set(drop.id, object);
      }
      object.position.set(drop.position.x, drop.position.y + 0.8 + Math.sin(tick * 0.07) * 0.1, drop.position.z);
      object.rotation.y = tick * 0.025;
      object.visible = powerupBlinkVisible(drop.ticksRemaining);
    }
  }

  dispose(): void {
    for (const object of this.objects.values()) { object.removeFromParent(); disposeModel(object.children[0] as THREE.Group); }
    this.objects.clear();
    this.ring.dispose();
    for (const material of Object.values(this.glow)) material.dispose();
  }
}
