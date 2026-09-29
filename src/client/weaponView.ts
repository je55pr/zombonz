import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { batchStaticMeshes } from './staticBatch.ts';
import { HANDGUNS } from './aim.ts';
import { loadModel, WEAPON_ASSETS } from './runtimeAssets.ts';
import { WEAPON_DEFINITIONS, reloadTicksFor, weaponName } from '../core/weapon.ts';
import type { PlayerState } from '../core/types.ts';
import type { SimulationEvent } from '../core/simulation.ts';

/**
 * The sight picture in gun space (butt at z = 0, muzzle toward -z, highest point at y = 0): aiming puts the
 * top of the front sight (`height`) on the screen centre with the bore level, as with a real post-and-notch
 * or aperture sight, and holds the rear sight (`rearZ`) a fixed distance from the eye.
 */
export interface SightLine { height: number; x: number; rearZ: number }
export interface PreparedWeapon { root: THREE.Group; magazine: THREE.Group; muzzle: THREE.Vector3; sight: SightLine }

/**
 * Hand-tuned corrections, checked against screenshots of every gun aimed:
 * - `drop` lowers the aim point below the measured front sight (a hood's top down to the post inside it);
 * - `scope` aims along the top of a scope (the highest point along the receiver) instead;
 * - `height`/`x` place the gun outright where iron sights do not apply;
 * - `hide` drops model parts that block the aimed view.
 */
interface SightOverride { drop?: number; scope?: boolean; height?: number; x?: number; rearZ?: number; hide?: RegExp }
const SIGHT_OVERRIDES: Readonly<Record<string, SightOverride>> = {
  // WaW's Kar98k is unscoped; the model's scope (opaque lens) would black out the aimed view.
  kar98k: { hide: /Scope/ },
  mp40: { drop: 0.013 },
  // The Skorpion's front post stands three-quarters along; the muzzle band only holds the barrel nut.
  skorpion: { height: -0.004 },
  // The FAL's front sight sits on the gas block, three-quarters along, behind the searched muzzle band.
  fal: { height: -0.002, rearZ: -0.22 },
  // The launcher rides on the right shoulder; the eye sits above and left of the tube.
  rpg7: { height: 0.05, x: -0.08 },
  // A later-pattern folding carry handle; WaW's BAR has none, and it filled the left of the aimed view.
  bar: { hide: /^Handle/ },
};

/**
 * Finds the sight picture: the bore's centre line from the muzzle tip, the front post as the highest point
 * near the muzzle on that line (so protective ears either side are ignored), and the rear sight as the
 * highest point along the receiver (used only for eye distance).
 */
export function measureSightLine(geometries: readonly THREE.BufferGeometry[], length: number, id: string): SightLine {
  const point = new THREE.Vector3();
  const each = (visit: (p: THREE.Vector3, t: number) => void) => {
    for (const geometry of geometries) {
      const position = geometry.getAttribute('position');
      for (let i = 0; i < position.count; i++) { point.fromBufferAttribute(position, i); visit(point, -point.z / length); }
    }
  };
  let boreX = 0, muzzleVertices = 0;
  each((p, t) => { if (t >= 0.97) { boreX += p.x; muzzleVertices++; } });
  boreX = muzzleVertices ? boreX / muzzleVertices : 0;
  const post = { y: -Infinity }, rear = { x: 0, y: -Infinity, z: -length * 0.3 };
  each((p, t) => {
    if (t >= 0.8 && Math.abs(p.x - boreX) <= 0.004 && p.y > post.y) post.y = p.y;
    else if (t >= 0.04 && t <= 0.78 && p.y > rear.y) { rear.x = p.x; rear.y = p.y; rear.z = p.z; }
  });
  const override = SIGHT_OVERRIDES[id] ?? {};
  const measured = override.scope ? rear.y : Number.isFinite(post.y) ? post.y : 0;
  return {
    height: override.height ?? measured - (override.drop ?? 0),
    x: override.x ?? (override.scope ? rear.x : boreX),
    rearZ: override.rearZ ?? (Number.isFinite(rear.y) ? rear.z : -length * 0.3),
  };
}

// Viewmodel lengths in metres, roughly 0.86x each gun's real length.
export const VIEWMODEL_LENGTHS: Readonly<Record<string, number>> = {
  m1911: 0.36, kar98k: 0.95, bar: 1.05, mp40: 0.72, ppsh41: 0.73, mg42: 1.05, 'm1-garand': 0.95,
  springfield: 0.95, mosin: 1.1, 'double-barrel': 0.98, 'trench-gun': 0.86, thompson: 0.74, stg44: 0.81,
  fg42: 0.84, 'm1-carbine': 0.78, m14: 0.96, fal: 0.94, rpk: 0.92, commando: 0.66, ak74u: 0.63, spas12: 0.9,
  ithaca37: 0.86, rpg7: 0.95,
  // Handguns are drawn larger than life, like the M1911, so they read on screen.
  mp5k: 0.45, skorpion: 0.52, 'magnum-357': 0.42, python: 0.4, irrlicht: 0.42, molniya: 0.4,
};
/** Rear sight distance in front of the eye when aimed, and how far the sights sit below dead centre. */
const ADS_EYE_RELIEF = 0.13;
const ADS_SIGHT_DROP = 0.0015;
/** Hip-fire offsets from the aimed position (right, down, forward). */
const HIP_OFFSET_LONG_GUN = { x: 0.1, y: -0.07, z: -0.1 };
const HIP_OFFSET_HANDGUN = { x: 0.1, y: -0.085, z: -0.24 };
/**
 * Guns whose hip pose is neither a handgun's nor a long gun's: the launcher's aimed pose sits high over
 * the shoulder, and the machine pistols are drawn oversized like the handguns.
 */
const HIP_OFFSET_OVERRIDES: Readonly<Record<string, { x: number; y: number; z: number }>> = {
  rpg7: { x: 0.16, y: 0, z: -0.2 },
  skorpion: { x: 0.1, y: -0.075, z: -0.2 },
  mp5k: { x: 0.1, y: -0.075, z: -0.2 },
};
const FLASH_COLOURS: Readonly<Record<string, number>> = { irrlicht: 0x7dff9a, molniya: 0x8fd8ff };

// Bake the exported rest pose to ordinary meshes, keeping the magazine separate.
// BAR's 58 source parts then batch to two draws, without a needless gun skeleton.
export function prepareWeapon(source: THREE.Object3D, id: string): PreparedWeapon {
  source.updateMatrixWorld(true);
  const root = new THREE.Group(), body = new THREE.Group(), magazine = new THREE.Group();
  root.add(body, magazine);
  const rotation = new THREE.Matrix4().makeRotationY(id === 'bar' ? Math.PI / 2 : Math.PI);
  const hidden = SIGHT_OVERRIDES[id]?.hide;
  source.traverse(object => {
    if (!(object instanceof THREE.Mesh) || hidden?.test(object.name)) return;
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
  let sight: SightLine = { height: 0, x: 0, rearZ: -0.3 };
  const length = VIEWMODEL_LENGTHS[id] ?? 1.05;
  const scale = length / size.z;
  const offset = new THREE.Vector3(-(bounds.min.x + bounds.max.x) / 2, -bounds.max.y, -bounds.max.z);
  for (const group of [body, magazine]) {
    for (const object of group.children) {
      const mesh = object as THREE.Mesh;
      mesh.geometry.translate(offset.x, offset.y, offset.z); mesh.geometry.scale(scale, scale, scale);
    }
    if (group === body) sight = measureSightLine(group.children.map(object => (object as THREE.Mesh).geometry), length, id);
    batchStaticMeshes(group);
    group.traverse(object => {
      if (object instanceof THREE.Mesh) {
        const original = object.geometry; object.geometry = mergeVertices(original); original.dispose();
      }
    });
  }
  return { root, magazine, muzzle: new THREE.Vector3(0, -0.035, -length), sight };
}

const preparedWeapons = new Map<string, Promise<PreparedWeapon>>();
const readyWeapons = new Map<string, PreparedWeapon>();

/**
 * Parses and bakes a gun's viewmodel once per page. The start screen and the game call this ahead of
 * time (starting pistol, box rolls, nearby wall buys) so equipping never shows the placeholder block.
 */
export function prepareWeaponModel(id: string): Promise<PreparedWeapon> | null {
  const asset = WEAPON_ASSETS[id];
  if (!asset) return null;
  let pending = preparedWeapons.get(asset);
  if (!pending) {
    pending = loadModel(`weapons/${asset}/model.glb`).then(gltf => prepareWeapon(gltf.scene, asset));
    pending.then(weapon => readyWeapons.set(asset, weapon), () => {});
    preparedWeapons.set(asset, pending);
  }
  return pending;
}

/** The prepared model if it has already finished loading, without starting or waiting for a load. */
export function readyWeaponModel(id: string): PreparedWeapon | null {
  const asset = WEAPON_ASSETS[id];
  return asset ? readyWeapons.get(asset) ?? null : null;
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
  return { root, magazine, muzzle: new THREE.Vector3(0, -0.045, -0.5), sight: { height: 0, x: 0, rearZ: -0.1 } };
}

export class WeaponView {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(52, 1, 0.01, 10);
  private readonly pose = new THREE.Group();
  private readonly flash = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xffd57a, transparent: true, opacity: 0.9, depthWrite: false }));
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
    (this.flash.material as THREE.MeshBasicMaterial).color.setHex(FLASH_COLOURS[id] ?? 0xffd57a);
    const generation = ++this.generation;
    this.current?.root.removeFromParent();
    let fallback = this.fallbacks.get(id);
    if (!fallback) { fallback = placeholderWeapon(id); this.fallbacks.set(id, fallback); }
    this.current = fallback; this.pose.add(fallback.root);
    const asset = WEAPON_ASSETS[id];
    if (!asset) { this.notice = `${weaponName(id).toUpperCase()}: placeholder model`; return; }
    const ready = readyWeapons.get(asset);
    if (ready) {
      this.current.root.removeFromParent(); this.current = ready; this.pose.add(ready.root); this.notice = null;
      return;
    }
    this.notice = `Loading ${asset.toUpperCase()} model…`;
    const pending = prepareWeaponModel(id)!;
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
    const progress = player.weapon.reloadTicksRemaining > 0 ? 1 - player.weapon.reloadTicksRemaining / reloadTicksFor(player, definition) : 0;
    const reload = Math.sin(progress * Math.PI);
    const blend = 1 - Math.exp(-13 * Math.min(0.1, Math.max(0, deltaSeconds)));
    this.aimBlend += ((player.aiming ? 1 : 0) - this.aimBlend) * blend;
    this.sprintBlend += ((player.sprinting ? 1 : 0) - this.sprintBlend) * blend;
    const moving = Math.min(1, Math.hypot(player.velocity.x, player.velocity.z) / 3);
    const bob = Math.sin(tick * (player.sprinting ? 0.22 : 0.13)) * moving
      * (player.sprinting ? 0.014 : 0.006) * (1 - this.aimBlend * 0.85);
    // Aimed: bore level, front sight on the screen centre, rear sight a fixed distance from the eye.
    const { height, x, rearZ } = this.current.sight;
    const aimed = { x: -x, y: -height - ADS_SIGHT_DROP, z: -ADS_EYE_RELIEF - rearZ };
    // Hip: the same gun held lower-right and a little further out, turned slightly inwards.
    const hip = HIP_OFFSET_OVERRIDES[this.id] ?? (HANDGUNS.has(this.id) ? HIP_OFFSET_HANDGUN : HIP_OFFSET_LONG_GUN);
    const away = 1 - this.aimBlend;
    this.pose.position.set(aimed.x + hip.x * away + bob,
      aimed.y + hip.y * away - this.sprintBlend * 0.16 - reload * 0.32 + Math.abs(bob),
      aimed.z + hip.z * away + kick * (0.045 - this.aimBlend * 0.025));
    this.pose.rotation.set(kick * (0.10 - this.aimBlend * 0.06) + reload * 0.35 - this.sprintBlend * 0.22,
      0.12 * away, -reload * 0.45 + this.sprintBlend * 0.12);
    this.current.magazine.position.y = -reload * 0.18;
    this.flash.position.copy(this.current.muzzle); this.flash.position.z -= 0.04;
    this.flash.scale.set(0.025, 0.025, 0.065);
    this.flash.visible = sinceShot < 0.055;
  }
  /** Compiles the viewmodel's shaders and uploads its textures before the game is shown. */
  async warm(renderer: THREE.WebGLRenderer): Promise<void> {
    await renderer.compileAsync(this.scene, this.camera);
    this.scene.traverse(object => {
      const material = (object as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      for (const texture of [material?.map, material?.normalMap, material?.roughnessMap, material?.aoMap, material?.emissiveMap]) {
        if (texture) renderer.initTexture(texture);
      }
    });
  }

  render(renderer: THREE.WebGLRenderer, aspect: number): void {
    if (!this.active) return;
    if (this.camera.aspect !== aspect) { this.camera.aspect = aspect; this.camera.updateProjectionMatrix(); }
    renderer.clearDepth(); renderer.render(this.scene, this.camera);
  }
}
