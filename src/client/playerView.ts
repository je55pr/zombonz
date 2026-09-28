import * as THREE from 'three';
import type { PlayerState, Vec3 } from '../core/types.ts';
import { interpolatePosition } from './interpolation.ts';
import { readyWeaponModel } from './weaponView.ts';

/** Uniform colours by slot, so teammates are easy to tell apart. */
const UNIFORMS = [0x4b5a36, 0x3e4a5c, 0x7a6a48, 0x55443d];

function label(text: string, color: string, height: number, depthTest: boolean): THREE.Sprite {
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 128;
  const context = canvas.getContext('2d')!;
  context.font = '600 64px Oswald, sans-serif'; context.textAlign = 'center'; context.textBaseline = 'middle';
  context.lineWidth = 10; context.strokeStyle = 'rgba(0,0,0,0.75)'; context.strokeText(text, 256, 64, 490);
  context.fillStyle = color; context.fillText(text, 256, 64, 490);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest, depthWrite: false, transparent: true }));
  sprite.scale.set(height * 4, height, 1);
  sprite.renderOrder = depthTest ? 0 : 10;
  return sprite;
}

/**
 * A teammate: a helmeted soldier built from simple shapes, carrying a copy of their current gun, with
 * their name overhead. Downed, they lie on the floor under a red REVIVE marker seen through walls.
 */
export class PlayerView {
  readonly root = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly legs: THREE.Mesh[] = [];
  private readonly gunMount = new THREE.Group();
  private readonly revive: THREE.Sprite;
  private gunId: string | null = null;
  private stride = 0;
  private last: Vec3 | null = null;

  constructor(name: string, slot: number) {
    const uniform = new THREE.MeshStandardMaterial({ color: UNIFORMS[slot % UNIFORMS.length], roughness: 0.9 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x2a2a26, roughness: 0.8 });
    const skin = new THREE.MeshStandardMaterial({ color: 0xc49a7c, roughness: 0.8 });
    const part = (material: THREE.Material, geometry: THREE.BufferGeometry, x: number, y: number, z: number, parent: THREE.Object3D = this.body) => {
      const mesh = new THREE.Mesh(geometry, material); mesh.position.set(x, y, z); mesh.castShadow = true; parent.add(mesh); return mesh;
    };
    for (const side of [-0.11, 0.11]) {
      // Legs hang from the hip so they can swing.
      const hip = new THREE.Group(); hip.position.set(side, 0.86, 0); this.body.add(hip);
      this.legs.push(part(dark, new THREE.BoxGeometry(0.17, 0.84, 0.2), 0, -0.42, 0, hip));
    }
    part(uniform, new THREE.BoxGeometry(0.5, 0.62, 0.3), 0, 1.18, 0);
    part(skin, new THREE.SphereGeometry(0.13, 12, 10), 0, 1.62, 0);
    part(uniform, new THREE.SphereGeometry(0.16, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), 0, 1.66, 0);
    // Both arms reach forward to the gun.
    for (const side of [-0.2, 0.2]) {
      const arm = part(uniform, new THREE.BoxGeometry(0.12, 0.12, 0.5), side * 0.8, 1.32, -0.22);
      arm.rotation.y = side * -0.5;
    }
    this.gunMount.position.set(0.1, 1.32, -0.42); this.body.add(this.gunMount);
    this.root.add(this.body);
    const nameTag = label(name, '#e5ddc8', 0.22, true); nameTag.position.y = 2.05; this.root.add(nameTag);
    this.revive = label('REVIVE', '#e0402f', 0.3, false); this.revive.position.y = 1.1; this.revive.visible = false;
    this.root.add(this.revive);
  }

  update(player: PlayerState, previous: Vec3 | undefined, alpha: number): void {
    this.root.visible = player.alive;
    if (!player.alive) return;
    const position = interpolatePosition(previous, player.position, alpha);
    this.root.position.set(position.x, position.y, position.z);
    this.root.rotation.y = player.yaw;
    const downed = player.downed !== null;
    // Down: flat on the floor, facing up; the marker shows where to go.
    this.body.rotation.x = downed ? -Math.PI / 2 : 0;
    this.body.position.set(0, downed ? 0.2 : 0, downed ? 0.9 : 0);
    this.revive.visible = downed;
    const moved = this.last ? Math.hypot(position.x - this.last.x, position.z - this.last.z) : 0;
    this.last = { ...position };
    this.stride = downed || moved < 0.001 ? this.stride * 0.8 : this.stride + moved * 4.2;
    const swing = Math.sin(this.stride) * Math.min(0.6, moved * 40);
    this.legs[0].parent!.rotation.x = swing; this.legs[1].parent!.rotation.x = -swing;
    if (this.gunId !== player.weapon.weaponId) {
      const model = readyWeaponModel(player.weapon.weaponId);
      if (model) {
        this.gunMount.clear();
        const gun = model.root.clone(true);
        gun.position.set(0, 0, 0); gun.rotation.set(0, 0, 0); gun.scale.setScalar(1.05);
        this.gunMount.add(gun); this.gunId = player.weapon.weaponId;
      }
    }
  }

  dispose(): void {
    this.root.traverse(object => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Sprite) {
        object.geometry.dispose();
        const material = object.material as THREE.Material & { map?: THREE.Texture | null };
        material.map?.dispose(); material.dispose();
      }
    });
    this.root.removeFromParent();
  }
}
