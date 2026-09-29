import * as THREE from 'three';
import type { PowerupDrop } from '../core/powerups.ts';

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

/** Shared geometry/materials keep a small number of pickups cheap to render. */
export class PowerupView {
  private readonly objects = new Map<string, THREE.Group>();
  private readonly box = new THREE.BoxGeometry(0.52, 0.32, 0.36);
  private readonly ring = new THREE.TorusGeometry(0.43, 0.035, 6, 16);
  private readonly body = {
    maxAmmo: new THREE.MeshStandardMaterial({ color: 0x425c32, roughness: 0.48,
      metalness: 0.32, emissive: 0x285e1c, emissiveIntensity: 1.3 }),
    doublePoints: new THREE.MeshStandardMaterial({ color: 0x806922, roughness: 0.48,
      metalness: 0.32, emissive: 0xc17b13, emissiveIntensity: 1.3 }),
    instaKill: new THREE.MeshStandardMaterial({ color: 0x832e28, roughness: 0.48,
      metalness: 0.32, emissive: 0xc3261b, emissiveIntensity: 1.3 }),
    nuke: new THREE.MeshStandardMaterial({ color: 0x3e5671, roughness: 0.48,
      metalness: 0.32, emissive: 0x1d6494, emissiveIntensity: 1.3 }),
    carpenter: new THREE.MeshStandardMaterial({ color: 0x6e4a26, roughness: 0.48,
      metalness: 0.32, emissive: 0xa8611c, emissiveIntensity: 1.3 }),
  };
  private readonly glow = {
    maxAmmo: new THREE.MeshBasicMaterial({ color: 0xb4e38c }),
    doublePoints: new THREE.MeshBasicMaterial({ color: 0xffd473 }),
    instaKill: new THREE.MeshBasicMaterial({ color: 0xff816b }),
    nuke: new THREE.MeshBasicMaterial({ color: 0x87d7ff }),
    carpenter: new THREE.MeshBasicMaterial({ color: 0xf0b070 }),
  };

  constructor(private readonly scene: THREE.Scene) {}

  update(drops: readonly PowerupDrop[], tick: number): void {
    const active = new Set(drops.map(drop => drop.id));
    for (const [id, object] of this.objects) if (!active.has(id)) {
      object.removeFromParent(); this.objects.delete(id);
    }
    for (const drop of drops) {
      let object = this.objects.get(drop.id);
      if (!object) {
        object = new THREE.Group();
        object.add(new THREE.Mesh(this.box, this.body[drop.kind]));
        const halo = new THREE.Mesh(this.ring, this.glow[drop.kind]);
        halo.rotation.x = Math.PI / 2; object.add(halo);
        this.scene.add(object); this.objects.set(drop.id, object);
      }
      object.position.set(drop.position.x, drop.position.y + 0.8 + Math.sin(tick * 0.07) * 0.1, drop.position.z);
      object.rotation.y = tick * 0.025;
      object.visible = powerupBlinkVisible(drop.ticksRemaining);
    }
  }

  dispose(): void {
    for (const object of this.objects.values()) object.removeFromParent();
    this.objects.clear();
    this.box.dispose(); this.ring.dispose();
    for (const material of Object.values(this.body)) material.dispose();
    for (const material of Object.values(this.glow)) material.dispose();
  }
}
