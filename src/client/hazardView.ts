import * as THREE from 'three';
import { HAZARD_KINDS, hazardSpec, type HazardDefinition, type HazardPhase, type HazardState } from '../core/hazard.ts';
import type { BlastEffects } from './blastEffects.ts';
import { prepareProp } from './environmentProps.ts';
import { loadModel } from './runtimeAssets.ts';

/** Below this share of its health a hazard smokes; below the second, it also sputters flame. */
const SMOKING = 0.66, SPUTTERING = 0.34;
/** How much of its colour a fully burnt hazard keeps. */
const CHARRED = 0.14;

interface Entry {
  definition: HazardDefinition;
  /** Loading stand-in, then the real model. */
  body: THREE.Object3D;
  materials: Array<{ material: THREE.MeshStandardMaterial; colour: THREE.Color; metalness: number }>;
  /** What is left where a barrel stood. */
  husk: THREE.Object3D | null;
  shown: HazardPhase | null;
  /** 0 as new to 1 burnt black. */
  char: number;
}

/**
 * Barrels and vehicles: the model in the world, smoking as it is shot up, burning and then either gone (a
 * barrel leaves a scorched husk) or left a blackened shell (a car). State comes from the core; the blast itself
 * is drawn by BlastEffects when the core reports it, so this only shows what is left.
 */
export class HazardView {
  readonly root = new THREE.Group();
  private readonly entries: Entry[] = [];
  private readonly huskMaterial = new THREE.MeshStandardMaterial({ color: 0x1b1918, roughness: 1, metalness: 0.35 });
  private readonly huskGeometry = new THREE.CylinderGeometry(0.29, 0.32, 0.1, 16);
  private readonly rimGeometry = new THREE.TorusGeometry(0.3, 0.025, 6, 20);
  private readonly loading = new THREE.MeshStandardMaterial({ color: 0x69543c, roughness: 1 });
  private failed = 0;
  private readonly loads: Promise<unknown>[] = [];
  /** Settles once every model has loaded or failed. */
  get ready(): Promise<unknown> { return Promise.allSettled(this.loads); }

  constructor(scene: THREE.Scene, private readonly definitions: readonly HazardDefinition[], private readonly effects: BlastEffects) {
    this.root.name = 'hazards';
    scene.add(this.root);
    for (const definition of definitions) this.entries.push(this.create(definition));
  }

  /** How many models failed to load (their plain stand-ins stay). */
  get failures(): number { return this.failed; }

  private create(definition: HazardDefinition): Entry {
    const spec = hazardSpec(definition);
    const stand = new THREE.Mesh(new THREE.BoxGeometry(spec.size.x, spec.size.y, spec.size.z), this.loading);
    stand.position.set(definition.position.x, definition.position.y + spec.size.y / 2, definition.position.z);
    stand.rotation.y = definition.yaw;
    this.root.add(stand);
    const entry: Entry = { definition, body: stand, materials: [], husk: null, shown: null, char: 0 };
    this.loads.push(loadModel(`props/${spec.asset}/model.glb`).then(gltf => {
      const model = prepareProp(gltf.scene, { id: definition.id, asset: spec.asset, position: definition.position, size: spec.size,
        yaw: definition.yaw, solid: false, background: true });
      // Each hazard owns its materials, so one can burn black without darkening the rest of its kind.
      model.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return;
        object.castShadow = false;
        const own = (Array.isArray(object.material) ? object.material : [object.material]).map(material => material.clone());
        object.material = Array.isArray(object.material) ? own : own[0];
        for (const material of own) {
          if (material instanceof THREE.MeshStandardMaterial) entry.materials.push({ material, colour: material.color.clone(), metalness: material.metalness });
        }
      });
      const visible = entry.body.visible;
      stand.removeFromParent(); stand.geometry.dispose();
      entry.body = model; model.visible = visible; this.root.add(model);
      this.burnBlack(entry, entry.char, true);
    }).catch(error => { this.failed++; console.warn(`Hazard model unavailable: ${spec.asset}`, error); }));
    return entry;
  }

  /** Sets how burnt a hazard's paint and metal look (0 as new, 1 black). */
  private burnBlack(entry: Entry, level: number, force = false): void {
    if (!force && Math.abs(level - entry.char) < 0.01) return;
    entry.char = level;
    const keep = 1 - (1 - CHARRED) * level;
    for (const { material, colour, metalness } of entry.materials) {
      material.color.copy(colour).multiplyScalar(keep);
      material.roughness = Math.min(1, material.roughness + level * 0.4); material.metalness = metalness * (1 - level * 0.6);
    }
  }

  /** What is left where a barrel stood: a scorched ring of steel on the floor. */
  private makeHusk(entry: Entry): THREE.Object3D {
    const { definition } = entry, husk = new THREE.Group();
    husk.add(new THREE.Mesh(this.huskGeometry, this.huskMaterial));
    const rim = new THREE.Mesh(this.rimGeometry, this.huskMaterial); rim.rotation.x = Math.PI / 2; rim.position.y = 0.05; husk.add(rim);
    husk.position.set(definition.position.x, definition.position.y + 0.05, definition.position.z);
    husk.rotation.y = definition.yaw; this.root.add(husk);
    return husk;
  }

  update(states: readonly HazardState[]): void {
    this.definitions.forEach((definition, index) => {
      const state = states[index], entry = this.entries[index];
      if (!state || !entry) return;
      const spec = HAZARD_KINDS[definition.kind], key = `hazard:${definition.id}`;
      const top = { x: definition.position.x, y: definition.position.y + spec.size.y * (definition.kind === 'barrel' ? 1 : 0.8), z: definition.position.z };
      if (entry.shown !== state.phase) {
        if (state.phase === 'intact') {
          entry.husk?.removeFromParent(); entry.husk = null; entry.body.visible = true;
        } else if (state.phase === 'exploded') {
          this.effects.extinguish(key); this.effects.extinguish(`${key}:cabin`);
          if (!spec.wreck) { entry.body.visible = false; entry.husk ??= this.makeHusk(entry); }
        }
        entry.shown = state.phase;
      }
      const health = state.health / spec.health, progress = state.phase === 'burning' ? 1 - state.burnTicks / spec.burnTicks : 0;
      if (spec.wreck) {
        this.burnBlack(entry, state.phase === 'exploded' ? 1 : state.phase === 'burning' ? 0.3 + 0.5 * progress : (1 - health) * 0.25);
      }
      if (state.phase === 'intact') {
        // Hit hard, it smokes; hit harder, it sputters flame.
        if (health < SMOKING) this.effects.burn(key, top, Math.max(spec.size.x, spec.size.z) * 0.25, health < SPUTTERING ? 0.55 : 0.35, 0, health < SPUTTERING ? 0.5 : 0);
        else this.effects.extinguish(key);
      } else if (state.phase === 'burning') {
        // Flames from the top of a barrel; from the engine and cabin of a car, growing as it nears going up.
        const size = Math.max(spec.size.x, spec.size.z), strength = 0.7 + 0.3 * progress;
        if (definition.kind === 'barrel') this.effects.burn(key, top, 0.3, strength);
        else {
          const forward = { x: -Math.sin(definition.yaw), z: -Math.cos(definition.yaw) }, length = spec.size.z;
          this.effects.burn(key, { x: top.x + forward.x * length * 0.28, y: top.y, z: top.z + forward.z * length * 0.28 }, size * 0.28, strength);
          this.effects.burn(`${key}:cabin`, { x: top.x - forward.x * length * 0.1, y: top.y + 0.1, z: top.z - forward.z * length * 0.1 },
            size * 0.22, strength * (0.4 + 0.6 * progress));
        }
      }
    });
  }

  /** Forgets what was shown, so the next update sets everything as its state says (a new match, or a late joiner). */
  reset(): void {
    for (const entry of this.entries) {
      entry.husk?.removeFromParent(); entry.husk = null; entry.body.visible = true;
      entry.shown = null; this.burnBlack(entry, 0);
      this.effects.extinguish(`hazard:${entry.definition.id}`); this.effects.extinguish(`hazard:${entry.definition.id}:cabin`);
    }
  }
}
