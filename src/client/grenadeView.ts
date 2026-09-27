import * as THREE from 'three';
import type { GrenadeState } from '../core/grenade.ts';
import type { SimulationEvent } from '../core/simulation.ts';

const BURST_COLOURS: Readonly<Record<string, number>> = { irrlicht: 0x7dff9a };

/**
 * Short-lived combat effects: grenade meshes, blast flashes (grenades, RPG, Irrlicht) and Molniya
 * lightning arcs. Authoritative positions come from the core.
 */
export class GrenadeView {
  private readonly projectiles = new Map<string, THREE.Mesh>();
  private readonly flashes: { mesh: THREE.Mesh; bornTick: number; size: number }[] = [];
  private readonly arcs: { line: THREE.Line; bornTick: number }[] = [];
  private readonly arcMaterial = new THREE.LineBasicMaterial({ color: 0xaee6ff, transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false });
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
      for (const arc of this.arcs) {
        arc.line.removeFromParent(); arc.line.geometry.dispose(); (arc.line.material as THREE.Material).dispose();
      }
      this.arcs.length = 0;
    }
    for (const event of events) {
      if (event.type === 'grenadeExploded') this.flash(event.position, 0xffa749, 1, tick);
      if (event.type === 'weaponExploded') {
        this.flash(event.position, BURST_COLOURS[event.weaponId] ?? 0xffa749, event.radius / 4, tick);
      }
      if (event.type === 'weaponChained') this.arc(event.points, tick);
    }
  }

  private flash(position: { x: number; y: number; z: number }, colour: number, size: number, tick: number): void {
    const material = new THREE.MeshBasicMaterial({ color: colour, transparent: true,
      opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending });
    const mesh = new THREE.Mesh(this.flashGeometry, material);
    mesh.position.set(position.x, position.y, position.z);
    this.scene.add(mesh); this.flashes.push({ mesh, bornTick: tick, size });
  }

  /** A jagged bolt through each struck zombie; the jitter is cosmetic and seeded by the tick. */
  private arc(points: readonly { x: number; y: number; z: number }[], tick: number): void {
    const vertices: THREE.Vector3[] = [];
    let seed = tick * 7919 + 1;
    const jitter = () => { seed = (seed * 16807) % 2147483647; return (seed / 2147483647 - 0.5) * 0.25; };
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i], b = points[i + 1];
      for (let step = 0; step < 6; step++) {
        const t = step / 6, edge = step === 0;
        vertices.push(new THREE.Vector3(a.x + (b.x - a.x) * t + (edge ? 0 : jitter()),
          a.y + (b.y - a.y) * t + (edge ? 0 : jitter()), a.z + (b.z - a.z) * t + (edge ? 0 : jitter())));
      }
    }
    const last = points[points.length - 1];
    vertices.push(new THREE.Vector3(last.x, last.y, last.z));
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(vertices), this.arcMaterial.clone());
    this.scene.add(line); this.arcs.push({ line, bornTick: tick });
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
      flash.mesh.scale.setScalar((0.3 + age * 0.28) * flash.size);
      (flash.mesh.material as THREE.MeshBasicMaterial).opacity = 0.42 * (1 - age / 12);
    }
    for (let index = this.arcs.length - 1; index >= 0; index--) {
      const arc = this.arcs[index], age = Math.max(0, tick - arc.bornTick);
      if (age >= 10) {
        arc.line.removeFromParent(); arc.line.geometry.dispose(); (arc.line.material as THREE.Material).dispose();
        this.arcs.splice(index, 1); continue;
      }
      (arc.line.material as THREE.LineBasicMaterial).opacity = 1 - age / 10;
    }
  }
}
