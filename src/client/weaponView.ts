import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { batchStaticMeshes } from './staticBatch.ts';
import { loadModel, WEAPON_ASSETS } from './runtimeAssets.ts';
import { WEAPON_DEFINITIONS } from '../core/weapon.ts';
import type { PlayerState } from '../core/types.ts';
import type { SimulationEvent } from '../core/simulation.ts';

export interface PreparedWeapon { root: THREE.Group; magazine: THREE.Group; muzzle: THREE.Vector3 }

// Bake the exported rest pose to ordinary meshes, keeping the magazine separate.
// BAR's 58 source parts then batch to two draws, without a needless gun skeleton.
export function prepareWeapon(source: THREE.Object3D, id: string): PreparedWeapon {
  source.updateMatrixWorld(true);
  const root = new THREE.Group(), body = new THREE.Group(), magazine = new THREE.Group();
  root.add(body, magazine);
  const rotation = new THREE.Matrix4().makeRotationY(id === 'bar' ? Math.PI / 2 : Math.PI);
  source.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    const geometry = object.geometry.index ? object.geometry.toNonIndexed() : object.geometry.clone();
    if (object instanceof THREE.SkinnedMesh) {
      const position = geometry.getAttribute('position'), point = new THREE.Vector3();
      // Indices were expanded above, so skin weights must come from that geometry too.
      const proxy = new THREE.SkinnedMesh(geometry, object.material);
      proxy.skeleton = object.skeleton; proxy.bindMatrix.copy(object.bindMatrix); proxy.bindMatrixInverse.copy(object.bindMatrixInverse);
      for (let i = 0; i < position.count; i++) {
        point.fromBufferAttribute(position, i); proxy.applyBoneTransform(i, point); position.setXYZ(i, point.x, point.y, point.z);
      }
    }
    geometry.applyMatrix4(object.matrixWorld);
    const isMagazine = /Magazine/i.test(object.name);
    // These source exports present their removable magazines alongside the guns.
    if (isMagazine && id === 'm1911') geometry.translate(-0.250698, 0, 0);
    if (isMagazine && id === 'bar') geometry.translate(0, 0, 0.29047);
    geometry.applyMatrix4(rotation);
    for (const attribute of Object.keys(geometry.attributes)) {
      if (!['position', 'normal', 'uv'].includes(attribute)) geometry.deleteAttribute(attribute);
    }
    const mesh = new THREE.Mesh(geometry, object.material); mesh.name = object.name;
    (isMagazine ? magazine : body).add(mesh);
  });
  const bounds = new THREE.Box3().setFromObject(root), size = bounds.getSize(new THREE.Vector3());
  const length = id === 'm1911' ? 0.36 : id === 'kar98k' ? 0.95 : 1.05;
  const scale = length / size.z;
  const offset = new THREE.Vector3(-(bounds.min.x + bounds.max.x) / 2, -bounds.max.y, -bounds.max.z);
  for (const group of [body, magazine]) {
    for (const object of group.children) {
      const mesh = object as THREE.Mesh;
      mesh.geometry.translate(offset.x, offset.y, offset.z); mesh.geometry.scale(scale, scale, scale);
    }
    batchStaticMeshes(group);
    group.traverse(object => {
      if (object instanceof THREE.Mesh) {
        const original = object.geometry; object.geometry = mergeVertices(original); original.dispose();
      }
    });
  }
  // Keep the rifle flash at barrel height rather than at the top of its scope.
  return { root, magazine, muzzle: new THREE.Vector3(0, id === 'kar98k' ? -0.065 : -0.035, -length) };
}

function placeholderWeapon(id: string): PreparedWeapon {
  const root = new THREE.Group(), magazine = new THREE.Group(); root.add(magazine);
  const metal = new THREE.MeshStandardMaterial({ color: 0x444a48, roughness: 0.6, metalness: 0.5 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x493526, roughness: 0.9 });
  const part = (parent: THREE.Group, x: number, y: number, z: number, w: number, h: number, d: number, material = metal) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material); mesh.position.set(x, y, z); parent.add(mesh);
  };
  part(root, 0, -0.045, -0.25, 0.065, 0.09, 0.5);
  part(root, 0, -0.1, -0.06, 0.055, 0.17, 0.09, wood);
  part(magazine, 0, -0.15, -0.23, 0.045, id === 'mp40' ? 0.23 : 0.17, 0.08);
  return { root, magazine, muzzle: new THREE.Vector3(0, -0.045, -0.5) };
}

export class WeaponView {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(52, 1, 0.01, 10);
  private readonly pose = new THREE.Group();
  private readonly flash = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xffd57a, transparent: true, opacity: 0.9, depthWrite: false }));
  private readonly prepared = new Map<string, Promise<PreparedWeapon>>();
  private readonly fallbacks = new Map<string, PreparedWeapon>();
  private current?: PreparedWeapon;
  private id = '';
  private firedTick = -100;
  private active = true;
  private aimBlend = 0;
  private sprintBlend = 0;
  private generation = 0;
  notice: string | null = null;

  constructor() {
    this.pose.name = 'weapon-pose'; this.flash.name = 'muzzle-flash';
    this.scene.add(new THREE.HemisphereLight(0xdde8f4, 0x655747, 2.8));
    const light = new THREE.DirectionalLight(0xffe3ba, 3.5); light.position.set(-2, 3, 2); this.scene.add(light);
    this.scene.add(this.pose); this.pose.add(this.flash); this.flash.visible = false;
  }
  private equip(id: string): void {
    this.id = id; this.firedTick = -100;
    const generation = ++this.generation;
    this.current?.root.removeFromParent();
    let fallback = this.fallbacks.get(id);
    if (!fallback) { fallback = placeholderWeapon(id); this.fallbacks.set(id, fallback); }
    this.current = fallback; this.pose.add(fallback.root);
    const asset = WEAPON_ASSETS[id];
    if (!asset) { this.notice = `${id.toUpperCase()}: placeholder model`; return; }
    this.notice = `Loading ${asset.toUpperCase()} model…`;
    let pending = this.prepared.get(asset);
    if (!pending) { pending = loadModel(`weapons/${asset}/model.glb`).then(gltf => prepareWeapon(gltf.scene, asset)); this.prepared.set(asset, pending); }
    void pending.then(weapon => {
      if (this.generation !== generation) return;
      this.current?.root.removeFromParent(); this.current = weapon; this.pose.add(weapon.root); this.notice = null;
    }).catch(error => {
      if (this.generation === generation) this.notice = `${asset.toUpperCase()} failed to load; using placeholder`;
      console.warn(`Unable to load ${asset} viewmodel`, error);
    });
  }
  events(events: readonly SimulationEvent[], playerId: string, tick: number): void {
    if (events.some(event => event.type === 'matchRestarted')) this.firedTick = -100;
    for (const event of events) if (event.type === 'weaponFired' && event.playerId === playerId) this.firedTick = tick;
  }
  update(player: PlayerState, tick: number, deltaSeconds = 1 / 60): void {
    if (player.weapon.weaponId !== this.id) this.equip(player.weapon.weaponId);
    this.active = player.alive;
    if (!this.current) return;
    const sinceShot = Math.max(0, (tick - this.firedTick) / 60);
    const kick = Math.exp(-sinceShot * 24);
    const definition = WEAPON_DEFINITIONS[this.id];
    const progress = player.weapon.reloadTicksRemaining > 0 ? 1 - player.weapon.reloadTicksRemaining / definition.reloadTicks : 0;
    const reload = Math.sin(progress * Math.PI);
    const blend = 1 - Math.exp(-13 * Math.min(0.1, Math.max(0, deltaSeconds)));
    this.aimBlend += ((player.aiming ? 1 : 0) - this.aimBlend) * blend;
    this.sprintBlend += ((player.sprinting ? 1 : 0) - this.sprintBlend) * blend;
    const moving = Math.min(1, Math.hypot(player.velocity.x, player.velocity.z) / 3);
    const bob = Math.sin(tick * (player.sprinting ? 0.22 : 0.13)) * moving
      * (player.sprinting ? 0.014 : 0.006) * (1 - this.aimBlend * 0.85);
    this.pose.position.set(0.19 * (1 - this.aimBlend) + bob,
      (this.id === 'starter-pistol' ? -0.10 : -0.15) + this.aimBlend * 0.065 - this.sprintBlend * 0.16 - reload * 0.32 + Math.abs(bob),
      -0.24 - this.aimBlend * 0.075 + kick * 0.045);
    this.pose.rotation.set(kick * 0.10 + reload * 0.35 - this.sprintBlend * 0.22,
      0.12 * (1 - this.aimBlend), -reload * 0.45 + this.sprintBlend * 0.12);
    this.current.magazine.position.y = -reload * 0.18;
    this.flash.position.copy(this.current.muzzle); this.flash.position.z -= 0.04;
    this.flash.scale.set(0.025, 0.025, 0.065);
    this.flash.visible = sinceShot < 0.055;
  }
  render(renderer: THREE.WebGLRenderer, aspect: number): void {
    if (!this.active) return;
    if (this.camera.aspect !== aspect) { this.camera.aspect = aspect; this.camera.updateProjectionMatrix(); }
    renderer.clearDepth(); renderer.render(this.scene, this.camera);
  }
}
