import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { batchStaticMeshes } from './staticBatch.ts';
import { HANDGUNS, VIEWMODEL_HIP_FOV, adsZoom, viewmodelFov } from './aim.ts';
import { MIN_EYE_RELIEF, adsPose, eyeRelief, sightPoints, type AimPose, type SightPoints } from './weaponSights.ts';
import { loadModel, WEAPON_ASSETS } from './runtimeAssets.ts';
import { createGrenadeModel, createMineModel } from './explosiveModels.ts';
import { WEAPON_DEFINITIONS, reloadTicksFor, weaponName } from '../core/weapon.ts';
import { GRENADE_RULES } from '../core/grenade.ts';
import type { PlayerState } from '../core/types.ts';
import type { SimulationEvent } from '../core/simulation.ts';

/** `sights` and how to hold the gun to aim them (`ads`) are worked out when the model is prepared, so nothing is measured while playing. */
export interface PreparedWeapon { root: THREE.Group; magazine: THREE.Group; muzzle: THREE.Vector3; sights: SightPoints; ads: AimPose }

/** Model parts that block the aimed view: WaW's Kar98k is unscoped, so its opaque scope lens would black it out; the BAR has no carry handle. */
const HIDDEN_PARTS: Readonly<Record<string, RegExp>> = { kar98k: /Scope/, bar: /^Handle/ };

/** Sights for a gun with none listed: along the top of the model, from a third of the way to the muzzle. */
function defaultSights(length: number, zoom: number): SightPoints {
  const rear = new THREE.Vector3(0, 0, -length * 0.3), front = new THREE.Vector3(0, 0, -length * 0.95);
  const size = { at: 'front', width: 14 } as const;
  return { rear, front, size, relief: eyeRelief(rear, front, size, zoom) };
}

/** The gun this model belongs to: the models are named for the gun, except the starting pistol's (`m1911`). */
export const gunForModel = (model: string) => Object.keys(WEAPON_ASSETS).find(gun => WEAPON_ASSETS[gun] === model) ?? model;

// Viewmodel lengths in metres, roughly 0.86x each gun's real length.
export const VIEWMODEL_LENGTHS: Readonly<Record<string, number>> = {
  m1911: 0.36, kar98k: 0.95, bar: 1.05, mp40: 0.72, ppsh41: 0.73, mg42: 1.05, 'm1-garand': 0.95,
  springfield: 0.95, mosin: 1.1, 'double-barrel': 0.98, 'trench-gun': 0.86, thompson: 0.74, stg44: 0.81,
  fg42: 0.84, 'm1-carbine': 0.78, m14: 0.96, fal: 0.94, rpk: 0.92, commando: 0.66, ak74u: 0.63, spas12: 0.9,
  ithaca37: 0.86, rpg7: 0.95,
  // Handguns are drawn larger than life, like the M1911, so they read on screen.
  mp5k: 0.45, skorpion: 0.52, 'magnum-357': 0.42, python: 0.4, irrlicht: 0.42, molniya: 0.4,
};
/**
 * Hip-fire offsets from the aimed position (right, down, forward). They were tuned when the rear sight was always this
 * far in front of the eye when aimed; a gun with a longer eye relief keeps the same hip pose.
 */
const HIP_POSE_RELIEF = MIN_EYE_RELIEF;
const HIP_OFFSET_LONG_GUN = { x: 0.1, y: -0.07, z: -0.1 };
const HIP_OFFSET_HANDGUN = { x: 0.1, y: -0.085, z: -0.24 };
/**
 * Guns whose hip pose is neither a handgun's nor a long gun's: the launcher's aimed pose sits high over
 * the shoulder (its sights are on the left of the tube, so the hip offset is measured from there), and the
 * machine pistols are drawn oversized like the handguns.
 */
const HIP_OFFSET_OVERRIDES: Readonly<Record<string, { x: number; y: number; z: number }>> = {
  rpg7: { x: 0.214, y: -0.049, z: -0.2 },
  skorpion: { x: 0.1, y: -0.075, z: -0.2 },
  mp5k: { x: 0.1, y: -0.075, z: -0.2 },
};
const FLASH_COLOURS: Readonly<Record<string, number>> = { irrlicht: 0x7dff9a, molniya: 0x8fd8ff };

export type TossKind = 'grenade' | 'mine';
/** How long each toss lasts, in seconds: the gun dips out of the way, the thing is thrown or set down, the gun comes back. */
export const TOSS_SECONDS: Readonly<Record<TossKind, number>> = { grenade: 0.55, mine: 0.72 };

const smooth = (from: number, to: number, t: number) => { const x = Math.max(0, Math.min(1, (t - from) / (to - from))); return x * x * (3 - 2 * x); };
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * The hand's toss, `seconds` after it began: how far the gun has dipped (0 to 1) and where the grenade or mine in the
 * hand is (in view space, x right, y up, z forward is negative), or null when it is not in view. A grenade is
 * raised, then whipped away just as the real one leaves; a mine is held out, then lowered to the floor.
 */
export function handToss(kind: TossKind, seconds: number): { dip: number; item: { x: number; y: number; z: number; spin: number; scale: number } | null } {
  if (seconds < 0 || seconds >= TOSS_SECONDS[kind]) return { dip: 0, item: null };
  if (kind === 'grenade') {
    const dip = smooth(0, 0.14, seconds) * (1 - smooth(0.3, 0.55, seconds));
    if (seconds >= 0.3) return { dip, item: null };
    const rise = smooth(0, 0.18, seconds), whip = smooth(0.18, 0.3, seconds);
    return { dip, item: { x: lerp(lerp(0.17, 0.12, rise), 0.03, whip), y: lerp(lerp(-0.2, -0.09, rise), 0.05, whip),
      z: lerp(lerp(-0.6, -0.64, rise), -1.9, whip), spin: rise * 0.5 + whip * 5, scale: lerp(1, 0.7, whip) } };
  }
  const dip = smooth(0, 0.2, seconds) * (1 - smooth(0.46, 0.72, seconds));
  if (seconds >= 0.46) return { dip, item: null };
  const lower = smooth(0.24, 0.46, seconds);
  return { dip, item: { x: lerp(0.1, 0.03, lower), y: lerp(-0.13, -0.34, lower), z: lerp(-0.7, -1.05, lower), spin: 0.4, scale: 1 } };
}

// Bake the exported rest pose to ordinary meshes, keeping the magazine separate.
// BAR's 58 source parts then batch to two draws, without a needless gun skeleton.
export function prepareWeapon(source: THREE.Object3D, id: string): PreparedWeapon {
  source.updateMatrixWorld(true);
  const root = new THREE.Group(), body = new THREE.Group(), magazine = new THREE.Group();
  root.add(body, magazine);
  const rotation = new THREE.Matrix4().makeRotationY(id === 'bar' ? Math.PI / 2 : Math.PI);
  const hidden = HIDDEN_PARTS[id];
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
  const length = VIEWMODEL_LENGTHS[id] ?? 1.05;
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
  const zoom = adsZoom(gunForModel(id));
  const sights = sightPoints(id, zoom) ?? defaultSights(length, zoom);
  return { root, magazine, muzzle: new THREE.Vector3(0, -0.035, -length), sights, ads: adsPose(sights) };
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
  const sights = defaultSights(0.5, adsZoom(id));
  return { root, magazine, muzzle: new THREE.Vector3(0, -0.045, -0.5), sights, ads: adsPose(sights) };
}

export class WeaponView {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(VIEWMODEL_HIP_FOV, 1, 0.01, 10);
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
  private readonly euler = new THREE.Euler();
  private readonly aimTurn = new THREE.Quaternion();
  private tossTick = -100;
  private tossKind: TossKind = 'grenade';
  /** What is in the hand during a toss, built when first needed. */
  private held: Record<TossKind, THREE.Group | null> = { grenade: null, mine: null };
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
    for (const event of events) {
      if (event.type === 'weaponFired' && event.playerId === playerId) this.firedTick = tick;
      if (event.type === 'grenadeThrown' && event.playerId === playerId) { this.tossTick = tick; this.tossKind = 'grenade'; }
      if (event.type === 'minePlaced' && event.playerId === playerId) { this.tossTick = tick; this.tossKind = 'mine'; }
    }
  }

  /** The grenade (pin in, lever down) or mine in the hand, added to the viewmodel scene on first use. */
  private heldItem(kind: TossKind): THREE.Group {
    let item = this.held[kind];
    if (!item) {
      item = kind === 'grenade' ? createGrenadeModel({ pinned: true }).root : createMineModel().root;
      item.name = `held-${kind}`; item.visible = false; this.scene.add(item); this.held[kind] = item;
    }
    return item;
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
    // Aimed: rear sight, front sight and eye on one line down the middle of the screen (see `adsPose`).
    const { ads } = this.current;
    // Hip: the same gun held lower-right and a little further out, turned slightly inwards.
    const hip = HIP_OFFSET_OVERRIDES[this.id] ?? (HANDGUNS.has(this.id) ? HIP_OFFSET_HANDGUN : HIP_OFFSET_LONG_GUN);
    const away = 1 - this.aimBlend;
    // Throwing a grenade or setting a mine: the gun dips out of the way while the thing is in the hand.
    const winding = player.alive && !player.downed && player.grenadeWindupTicks > 0;
    const tossKind = winding ? 'grenade' : this.tossKind;
    const toss = !player.alive || player.downed ? { dip: 0, item: null }
      : winding ? handToss('grenade', Math.min(0.299,
        (GRENADE_RULES.windupTicks - player.grenadeWindupTicks) / GRENADE_RULES.windupTicks * 0.29))
        : handToss(tossKind, this.tossKind === 'grenade' ? 0.3 + Math.max(0, (tick - this.tossTick) / 60)
          : Math.max(0, (tick - this.tossTick) / 60));
    this.pose.position.set(ads.position.x + hip.x * away + bob + toss.dip * 0.08,
      ads.position.y + hip.y * away - this.sprintBlend * 0.16 - reload * 0.32 + Math.abs(bob) - toss.dip * 0.32,
      // A longer eye relief moves the aimed gun forward; the hip pose stays where it was.
      ads.position.z + (hip.z + this.current.sights.relief - HIP_POSE_RELIEF) * away + kick * (0.045 - this.aimBlend * 0.025));
    this.pose.quaternion.setFromEuler(this.euler.set(
      kick * (0.10 - this.aimBlend * 0.06) + reload * 0.35 - this.sprintBlend * 0.22 - toss.dip * 0.35,
      0.12 * away, -reload * 0.45 + this.sprintBlend * 0.12 - toss.dip * 0.2))
      .multiply(this.aimTurn.identity().slerp(ads.quaternion, this.aimBlend));
    for (const kind of ['grenade', 'mine'] as const) {
      const shown = kind === tossKind && toss.item !== null;
      if (!shown && !this.held[kind]) continue;
      const item = this.heldItem(kind);
      item.visible = shown;
      if (shown && toss.item) {
        item.position.set(toss.item.x, toss.item.y, toss.item.z); item.scale.setScalar(toss.item.scale);
        item.rotation.set(-0.3 + toss.item.spin * 0.6, 0.6 + toss.item.spin, 0.25 - toss.item.spin * 0.4);
      }
    }
    this.current.magazine.position.y = -reload * 0.18;
    this.flash.position.copy(this.current.muzzle); this.flash.position.z -= 0.04;
    this.flash.scale.set(0.025, 0.025, 0.065);
    this.flash.visible = sinceShot < 0.055 && toss.dip < 0.5;
  }
  /** Compiles the viewmodel's shaders and uploads its textures before the game is shown. */
  async warm(renderer: THREE.WebGLRenderer): Promise<void> {
    // The grenade and mine held during a toss are made now, so their shaders compile with the rest.
    for (const kind of ['grenade', 'mine'] as const) this.heldItem(kind).visible = true;
    await renderer.compileAsync(this.scene, this.camera);
    for (const kind of ['grenade', 'mine'] as const) this.heldItem(kind).visible = false;
    this.scene.traverse(object => {
      const material = (object as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      for (const texture of [material?.map, material?.normalMap, material?.roughnessMap, material?.aoMap, material?.emissiveMap]) {
        if (texture) renderer.initTexture(texture);
      }
    });
  }

  render(renderer: THREE.WebGLRenderer, aspect: number): void {
    if (!this.active) return;
    // The gun's own lens narrows as it is raised (see `viewmodelFov`), which is what makes its sights large when aimed.
    const fov = viewmodelFov(this.aimBlend, adsZoom(this.id), aspect);
    if (this.camera.aspect !== aspect || this.camera.fov !== fov) { this.camera.aspect = aspect; this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
    renderer.clearDepth(); renderer.render(this.scene, this.camera);
  }
}
