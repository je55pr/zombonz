import * as THREE from 'three';
import type { PowerupDrop } from '../core/powerups.ts';

/** Shared geometry/materials keep a small number of pickups cheap to render. */
export class PowerupView {
  private readonly objects = new Map<string, THREE.Group>();
  private readonly box = new THREE.BoxGeometry(0.52, 0.32, 0.36);
  private readonly ring = new THREE.TorusGeometry(0.43, 0.035, 6, 16);
  private readonly body = new THREE.MeshStandardMaterial({ color: 0x425c32, roughness: 0.48,
    metalness: 0.32, emissive: 0x285e1c, emissiveIntensity: 1.3 });
  private readonly glow = new THREE.MeshBasicMaterial({ color: 0xb4e38c });

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
        object.add(new THREE.Mesh(this.box, this.body));
        const halo = new THREE.Mesh(this.ring, this.glow);
        halo.rotation.x = Math.PI / 2; object.add(halo);
        this.scene.add(object); this.objects.set(drop.id, object);
      }
      object.position.set(drop.position.x, drop.position.y + 0.8 + Math.sin(tick * 0.07) * 0.1, drop.position.z);
      object.rotation.y = tick * 0.025;
    }
  }

  dispose(): void {
    for (const object of this.objects.values()) object.removeFromParent();
    this.objects.clear();
    this.box.dispose(); this.ring.dispose(); this.body.dispose(); this.glow.dispose();
  }
}
