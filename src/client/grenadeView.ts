import * as THREE from 'three';
import type { GrenadeState } from '../core/grenade.ts';
import type { SimulationEvent } from '../core/simulation.ts';

/** Short-lived grenade meshes and flashes; authoritative positions come from the core. */
export class GrenadeView {
  private readonly projectiles = new Map<string, THREE.Mesh>();
  private readonly flashes: { mesh: THREE.Mesh; bornTick: number }[] = [];
  private readonly grenadeGeometry = new THREE.SphereGeometry(0.11, 8, 6);
  private readonly grenadeMaterial = new THREE.MeshStandardMaterial({ color: 0x353c2a, metalness: 0.4 });
  private readonly flashGeometry = new THREE.SphereGeometry(1, 12, 8);

  constructor(private readonly scene: THREE.Scene) {}

  events(events: readonly SimulationEvent[], tick: number): void {
    if (events.some(event => event.type === 'matchRestarted')) {
      for (const projectile of this.projectiles.values()) projectile.removeFromParent();
      this.projectiles.clear();
      for (const flash of this.flashes) { flash.mesh.removeFromParent(); (flash.mesh.material as THREE.Material).dispose(); }
      this.flashes.length = 0;
    }
    for (const event of events) if (event.type === 'grenadeExploded') {
      const material = new THREE.MeshBasicMaterial({ color: 0xffa749, transparent: true,
        opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending });
      const mesh = new THREE.Mesh(this.flashGeometry, material);
      mesh.position.set(event.position.x, event.position.y, event.position.z);
      this.scene.add(mesh); this.flashes.push({ mesh, bornTick: tick });
    }
  }

  update(grenades: readonly GrenadeState[], tick: number): void {
    const active = new Set(grenades.map(grenade => grenade.id));
    for (const [id, mesh] of this.projectiles) if (!active.has(id)) {
      mesh.removeFromParent(); this.projectiles.delete(id);
    }
    for (const grenade of grenades) {
      let mesh = this.projectiles.get(grenade.id);
      if (!mesh) {
        mesh = new THREE.Mesh(this.grenadeGeometry, this.grenadeMaterial);
        this.scene.add(mesh); this.projectiles.set(grenade.id, mesh);
      }
      mesh.position.set(grenade.position.x, grenade.position.y, grenade.position.z);
      mesh.rotation.x = tick * 0.18; mesh.rotation.z = tick * 0.13;
    }
    for (let index = this.flashes.length - 1; index >= 0; index--) {
      const flash = this.flashes[index], age = Math.max(0, tick - flash.bornTick);
      if (age >= 12) {
        flash.mesh.removeFromParent(); (flash.mesh.material as THREE.Material).dispose();
        this.flashes.splice(index, 1); continue;
      }
      flash.mesh.scale.setScalar(0.3 + age * 0.28);
      (flash.mesh.material as THREE.MeshBasicMaterial).opacity = 0.42 * (1 - age / 12);
    }
  }
}
