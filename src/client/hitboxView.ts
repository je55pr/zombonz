import * as THREE from 'three';
import { zombieBody, type BodyPart, type ZombieState } from '../core/index.ts';

const COLOURS: Record<BodyPart, number> = { head: 0xff3030, torso: 0xffd030, armL: 0x30d0ff, armR: 0x30d0ff, legL: 0x50e070, legR: 0x50e070 };
const sphere = new THREE.SphereGeometry(1, 10, 7);

/**
 * A development aid (`?hitboxes=1`): draws the capsules the simulation tests shots against over each living zombie, so
 * they can be checked against the model as it walks, swings, vaults and crawls. Not part of the game.
 */
export class HitboxView {
  private readonly group = new THREE.Group();
  private readonly pool: THREE.Group[] = [];
  private readonly materials = new Map<number, THREE.MeshBasicMaterial>();
  private readonly lineMaterials = new Map<number, THREE.LineBasicMaterial>();

  constructor(scene: THREE.Scene) { this.group.renderOrder = 999; scene.add(this.group); }

  private material(colour: number): THREE.MeshBasicMaterial {
    let material = this.materials.get(colour);
    if (!material) {
      material = new THREE.MeshBasicMaterial({ color: colour, wireframe: true, depthTest: false, transparent: true, opacity: 0.55 });
      this.materials.set(colour, material);
    }
    return material;
  }

  private lineMaterial(colour: number): THREE.LineBasicMaterial {
    let material = this.lineMaterials.get(colour);
    if (!material) { material = new THREE.LineBasicMaterial({ color: colour, depthTest: false }); this.lineMaterials.set(colour, material); }
    return material;
  }

  update(zombies: Iterable<ZombieState>): void {
    let used = 0;
    for (const zombie of zombies) {
      if (!zombie.alive) continue;
      for (const volume of zombieBody(zombie).volumes()) {
        let item = this.pool[used];
        if (!item) {
          item = new THREE.Group();
          item.add(new THREE.Mesh(sphere), new THREE.Mesh(sphere), new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()])));
          this.pool.push(item); this.group.add(item);
        }
        used++;
        item.visible = true;
        const colour = COLOURS[volume.part];
        const [first, second, line] = item.children as [THREE.Mesh, THREE.Mesh, THREE.Line];
        first.material = second.material = this.material(colour); line.material = this.lineMaterial(colour);
        first.position.set(volume.a.x, volume.a.y, volume.a.z); second.position.set(volume.b.x, volume.b.y, volume.b.z);
        first.scale.setScalar(volume.radius); second.scale.setScalar(volume.radius);
        const positions = line.geometry.attributes.position as THREE.BufferAttribute;
        positions.setXYZ(0, volume.a.x, volume.a.y, volume.a.z); positions.setXYZ(1, volume.b.x, volume.b.y, volume.b.z);
        positions.needsUpdate = true;
      }
    }
    for (let i = used; i < this.pool.length; i++) this.pool[i].visible = false;
  }
}
