import * as THREE from 'three';
import { GRENADE_RULES, type GrenadeState } from '../core/grenade.ts';
import type { SimulationEvent } from '../core/simulation.ts';
import type { BlastEffects } from './blastEffects.ts';
import { createGrenadeModel } from './explosiveModels.ts';

/** How long before the blast the grenade's neck starts to glow, in ticks. */
const FUSE_GLOW_TICKS = 42;
/** Below this speed (m/s) a grenade has stopped rolling and settles onto its side. */
const RESTING_SPEED = 0.6;

interface Thrown {
  root: THREE.Group;
  fuse: THREE.MeshStandardMaterial;
  orientation: THREE.Quaternion;
  /** Where the neck is, for the fuse's sparks. */
  neck: THREE.Object3D;
}

const UP = new THREE.Vector3(0, 1, 0);

/**
 * Short-lived combat effects: thrown grenades (tumbling, with a sparking fuse), every explosion (grenade, rocket,
 * Betty, barrel, car, Irrlicht: see BlastEffects) and Molniya lightning arcs. Authoritative positions come from
 * the core; this only draws them.
 */
export class GrenadeView {
  private readonly projectiles = new Map<string, Thrown>();
  private readonly arcs: { line: THREE.Line; bornTick: number }[] = [];
  private readonly arcMaterial = new THREE.LineBasicMaterial({ color: 0xaee6ff, transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false });
  private readonly axis = new THREE.Vector3();
  private readonly velocity = new THREE.Vector3();
  private readonly spin = new THREE.Quaternion();
  private readonly target = new THREE.Vector3();
  private readonly lying = new THREE.Quaternion();
  private readonly heading = new THREE.Vector3();
  private readonly up = new THREE.Vector3();

  constructor(private readonly scene: THREE.Scene, private readonly effects: BlastEffects) {}

  events(events: readonly SimulationEvent[], tick: number): void {
    if (events.some(event => event.type === 'matchRestarted')) {
      for (const projectile of this.projectiles.values()) this.dispose(projectile);
      this.projectiles.clear();
      this.effects.clear();
      for (const arc of this.arcs) {
        arc.line.removeFromParent(); arc.line.geometry.dispose(); (arc.line.material as THREE.Material).dispose();
      }
      this.arcs.length = 0;
    }
    for (const event of events) {
      switch (event.type) {
        case 'grenadeExploded': this.effects.detonate('grenade', event.position, GRENADE_RULES.radius, tick); break;
        case 'weaponExploded': this.effects.detonate(event.weaponId === 'irrlicht' ? 'energy' : 'rocket', event.position, event.radius, tick); break;
        case 'mineExploded': this.effects.detonate('mine', event.position, event.radius, tick); break;
        case 'hazardExploded': this.effects.detonate(event.kind === 'barrel' ? 'barrel' : 'vehicle', event.position, event.radius, tick); break;
        case 'hazardHit': this.effects.strike(event.position, tick); break;
        case 'weaponChained': this.arc(event.points, tick); break;
      }
    }
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

  private dispose(thrown: Thrown): void {
    thrown.root.removeFromParent(); thrown.fuse.dispose();
  }

  /** Where a grenade is drawn, how it is turned, and its fuse: rolling grenades tumble, resting ones lie on their side. */
  private pose(thrown: Thrown, grenade: GrenadeState, dt: number, fresh: boolean): void {
    const { root } = thrown;
    this.velocity.set(grenade.velocity.x, grenade.velocity.y, grenade.velocity.z);
    const speed = this.velocity.length(), resting = speed < RESTING_SPEED;
    // A client sees a new position every few ticks; ease toward it rather than jump.
    this.target.set(grenade.position.x, grenade.position.y - (resting ? 0.055 : 0), grenade.position.z);
    if (fresh || root.position.distanceTo(this.target) > 2) root.position.copy(this.target);
    else root.position.lerp(this.target, 1 - Math.exp(-26 * dt));
    if (!resting) {
      // Tumbling end over end about the axis across its line of flight, faster the faster it goes.
      this.axis.crossVectors(this.velocity, UP);
      if (this.axis.lengthSq() < 1e-6) this.axis.set(1, 0, 0);
      this.axis.normalize();
      thrown.orientation.premultiply(this.spin.setFromAxisAngle(this.axis, Math.min(17, speed * 1.5) * dt));
    } else {
      // Come to rest with its long axis flat: turn the body's up-axis into the ground plane.
      this.up.copy(UP).applyQuaternion(thrown.orientation);
      this.heading.set(this.up.x, 0, this.up.z);
      if (this.heading.lengthSq() < 1e-4) this.heading.set(1, 0, 0);
      this.heading.normalize();
      this.lying.setFromUnitVectors(this.up, this.heading);
      thrown.orientation.premultiply(this.spin.identity().slerp(this.lying, 1 - Math.exp(-7 * dt)));
    }
    thrown.orientation.normalize();
    root.quaternion.copy(thrown.orientation);
    // The neck glows red and flickers faster as the fuse runs out.
    const left = grenade.fuseTicksRemaining;
    thrown.fuse.emissiveIntensity = left < FUSE_GLOW_TICKS ? 1.2 + Math.sin(left * (0.9 + (FUSE_GLOW_TICKS - left) * 0.08)) * 0.9 : 0;
  }

  update(grenades: readonly GrenadeState[], tick: number, dt = 1 / 60): void {
    const active = new Set(grenades.map(grenade => grenade.id));
    for (const [id, projectile] of this.projectiles) if (!active.has(id)) {
      this.dispose(projectile); this.projectiles.delete(id);
    }
    for (const grenade of grenades) {
      let thrown = this.projectiles.get(grenade.id);
      const fresh = !thrown;
      if (!thrown) {
        const { root, fuse } = createGrenadeModel();
        // Each one starts turned differently, so a volley doesn't tumble in step.
        const seed = Number(grenade.id.slice(2)) * 2.399;
        const orientation = new THREE.Quaternion().setFromEuler(new THREE.Euler(seed, seed * 1.7, seed * 0.6));
        thrown = { root, fuse, orientation, neck: root.children[1] };
        this.scene.add(root); this.projectiles.set(grenade.id, thrown);
      }
      this.pose(thrown, grenade, Math.min(0.1, dt), fresh);
      if (grenade.fuseTicksRemaining > 0) {
        thrown.neck.getWorldPosition(this.target);
        this.effects.fuse(grenade.id, this.target, tick);
      }
    }
    // Arcs fade over ten ticks.
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
