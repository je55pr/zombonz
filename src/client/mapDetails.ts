import * as THREE from 'three';
import { bunkerMaterial } from './greybox.ts';
import { assetUrl, environmentMaterial, lookScale, projectWorldUvs } from './environmentMaterials.ts';
import { getAsset } from './assetStore.ts';
import { loadModel } from './runtimeAssets.ts';
import type { GameMap } from '../maps/gameMap.ts';
import type { SimulationState } from '../core/simulation.ts';
import { weaponName } from '../core/weapon.ts';
import { lampFlicker } from './atmosphere.ts';
import { prepareWeaponModel, readyWeaponModel, type PreparedWeapon } from './weaponView.ts';
import { BOX_RULES } from '../core/mysteryBox.ts';
import { PERKS, type PerkId } from '../core/perks.ts';
import { WindowBoards } from './windowBoards.ts';
import { LightSource, type LightPool } from './lightPool.ts';

// Wall guns are shown life-size; viewmodels are modelled at roughly 0.86x.
const WALL_GUN_SCALE = 1.15;
const CHALK = 0xc9c7a7;

/**
 * Hangs a copy of the gun's model on a wall-buy sign, muzzle to the right, over a chalk silhouette
 * drawn slightly larger on the wall behind it, as WaW's chalk outlines frame their guns.
 */
function mountWallGun(sign: THREE.Group, weapon: PreparedWeapon, chalk: THREE.Material): void {
  const model = weapon.root.clone(true);
  model.position.set(0, 0, 0); model.rotation.set(0, 0, 0); model.scale.set(1, 1, 1);
  model.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(model);
  const centre = bounds.getCenter(new THREE.Vector3()), size = bounds.getSize(new THREE.Vector3());
  // Gun space has the muzzle toward -z and the gun's side along x; turning -90 degrees lays it along the wall.
  const place = (object: THREE.Object3D, scale: THREE.Vector3, wallDepth: number) => {
    object.rotation.y = -Math.PI / 2; object.scale.copy(scale);
    const offset = centre.clone().multiply(scale).applyAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2);
    object.position.set(-offset.x, -offset.y, wallDepth - offset.z);
    sign.add(object);
  };
  place(model, new THREE.Vector3().setScalar(WALL_GUN_SCALE), 0.015 + size.x * WALL_GUN_SCALE / 2);
  const outline = weapon.root.clone(true);
  outline.traverse(object => { if (object instanceof THREE.Mesh) object.material = chalk; });
  // Flattened onto the wall, and grown so a chalk rim shows around the gun.
  const rim = (size.z * WALL_GUN_SCALE + 0.07) / size.z;
  place(outline, new THREE.Vector3(0.002, (size.y * WALL_GUN_SCALE + 0.05) / size.y, rim), 0.004);
}

/** The perk machine model, and each perk's paint for it (see scripts/weapon-convert/import-vending.mjs). */
export const VENDING_MODEL = 'props/vending-machine/model.glb';
export const VENDING_PAINTS: Record<PerkId, string> = {
  juggernog: '/assets/props/vending-machine/paint-juggernog.webp', 'double-tap': '/assets/props/vending-machine/paint-double-tap.webp',
  'speed-cola': '/assets/props/vending-machine/paint-speed-cola.webp', 'quick-revive': '/assets/props/vending-machine/paint-quick-revive.webp',
};
const paints = new Map<string, Promise<THREE.Texture>>();
/** A glTF base-colour replacement: sRGB, and not flipped, as glTF textures aren't. */
function loadPaint(path: string): Promise<THREE.Texture> {
  let pending = paints.get(path);
  if (!pending) {
    const options: ImageBitmapOptions = { imageOrientation: 'none', premultiplyAlpha: 'none', colorSpaceConversion: 'none' };
    const downloaded = getAsset(assetUrl(path));
    pending = (downloaded ? createImageBitmap(downloaded, options)
      : new THREE.ImageBitmapLoader().setOptions(options).loadAsync(assetUrl(path))).then(bitmap => {
      const texture = new THREE.Texture(bitmap);
      texture.colorSpace = THREE.SRGBColorSpace; texture.flipY = false; texture.needsUpdate = true;
      return texture;
    });
    paints.set(path, pending);
  }
  return pending;
}

/** The box's beam: brightest low down and in the middle, fading overhead and to both sides. */
function beamFade(): THREE.Texture {
  const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 256;
  const context = canvas.getContext('2d')!;
  const along = context.createLinearGradient(0, 256, 0, 0);
  along.addColorStop(0, 'rgba(255,255,255,0)'); along.addColorStop(0.03, 'rgba(255,255,255,0.9)');
  along.addColorStop(0.3, 'rgba(255,255,255,0.35)'); along.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = along; context.fillRect(0, 0, 64, 256);
  // Keep only a soft core across the width.
  context.globalCompositeOperation = 'destination-in';
  const across = context.createLinearGradient(0, 0, 64, 0);
  across.addColorStop(0, 'rgba(0,0,0,0)'); across.addColorStop(0.5, 'rgba(0,0,0,1)'); across.addColorStop(1, 'rgba(0,0,0,0)');
  context.fillStyle = across; context.fillRect(0, 0, 64, 256);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * Everything drawn on top of a map's greybox from its definition: window boards and frames, stair
 * rails, purchasable doors and debris, painted labels, chalk wall guns, the mystery box, practical
 * lamps, rubble and the surrounding treeline. `update` follows the authoritative simulation state, and
 * says whether anything that casts a moon shadow moved (a door, a board, the box or the power lever).
 * The map's lights are sources for the shared light pool, which draws the nearest of them.
 */
export function buildMapDetails(scene: THREE.Scene, map: GameMap, lightPool: LightPool):
  { update(state: SimulationState): boolean; ready: Promise<unknown> } {
  const group = new THREE.Group();
  group.name = `${map.id}-details`;
  scene.add(group);
  const wood = bunkerMaterial('barrier');
  const boards = environmentMaterial('old-planks');
  const nailGeometry = new THREE.CylinderGeometry(0.011, 0.011, 0.012, 6);
  const concrete = bunkerMaterial('wall');
  const iron = bunkerMaterial('metal');
  const upholstery = environmentMaterial('sofa-upholstery');
  const debris = environmentMaterial('concrete-rubble');
  const box = (parent: THREE.Object3D, material: THREE.Material, x: number, y: number, z: number,
    sx: number, sy: number, sz: number) => {
    const geometry = new THREE.BoxGeometry(sx, sy, sz);
    if (material.name) projectWorldUvs(geometry, new THREE.Vector3(x, y, z));
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true;
    parent.add(mesh); return mesh;
  };
  function writing(text: string, width: number, height: number, color = '#d6cdb0'): THREE.Mesh {
    const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    ctx.font = 'bold 125px Georgia'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = color; ctx.fillText(text, 512, 128, 990);
    for (let i = 0; i < 800; i++) { ctx.clearRect((i * 131) % 1024, (i * 37) % 256, 2, 3); }
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    return new THREE.Mesh(new THREE.PlaneGeometry(width, height),
      new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
  }
  function label(text: string, x: number, y: number, z: number, rotation: number,
    width: number, height: number, color?: string): void {
    const mesh = writing(text, width, height, color); mesh.position.set(x, y, z); mesh.rotation.y = rotation; group.add(mesh);
  }
  // Broken wooden window boards, deep frames, and projecting stone sills.
  const barrierViews = new Map<string, WindowBoards>();
  for (const opening of map.windows) {
    const frame = new THREE.Group();
    frame.position.set(opening.x, opening.y, opening.z);
    if (opening.axis === 'z') frame.rotation.y = Math.PI / 2;
    group.add(frame);
    box(frame, concrete, 0, 0.83, 0, opening.width + 0.25, 0.15, 0.65);
    box(frame, iron, -opening.width / 2, 1.75, 0, 0.09, 1.8, 0.25);
    box(frame, iron, opening.width / 2, 1.75, 0, 0.09, 1.8, 0.25);
    barrierViews.set(opening.id, new WindowBoards(frame, opening.width, map.windowBoards, boards, iron, nailGeometry));
  }
  // Architecture lives in shared map data, so the visuals and collision agree.
  for (const rail of map.rails) {
    const a = new THREE.Vector3(rail.from.x, rail.from.y, rail.from.z);
    const b = new THREE.Vector3(rail.to.x, rail.to.y, rail.to.z);
    const direction = b.clone().sub(a);
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, direction.length(), 6), iron);
    tube.position.copy(a).add(b).multiplyScalar(0.5);
    tube.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
    group.add(tube);
    box(group, iron, a.x, a.y - 0.44, a.z, 0.035, 0.88, 0.035);
  }
  const doorViews = new Map<string, THREE.Group>();
  for (const door of map.doors) {
    const view = new THREE.Group(); group.add(view); doorViews.set(door.id, view);
    view.userData.dynamic = true;
    const style = map.doorStyles[door.id] ?? { kind: 'planks', yaw: 0, width: 2.4 };
    view.position.set(door.position.x, door.position.y, door.position.z);
    view.rotation.y = style.yaw;
    if (style.kind === 'planks') {
      // Vertical boards across the doorway, two iron straps, and an optional painted word.
      const boards = Math.max(2, Math.round(style.width / 0.4));
      for (let i = 0; i < boards; i++) box(view, wood, 0, 1.4, -style.width / 2 + (i + 0.5) * style.width / boards, 0.24, 2.8, style.width / boards - 0.02);
      box(view, iron, -0.14, 0.65, 0, 0.06, 0.12, style.width - 0.1);
      box(view, iron, -0.14, 2.05, 0, 0.06, 0.12, style.width - 0.1);
      if (style.label) {
        const label = writing(style.label, 1.7, 0.62, '#d9d0ba');
        label.rotation.y = Math.PI / 2; label.position.set(0.17, 1.5, 0); view.add(label);
      }
    } else {
      // A sofa and stacked crates across the stair.
      const width = style.width;
      box(view, upholstery, 0, 0.35, 0, width, 0.55, 0.75);
      box(view, upholstery, 0, 0.85, 0.3, width, 0.7, 0.25);
      for (const side of [-1, 1]) box(view, upholstery, side * (width / 2 - 0.12), 0.8, 0, 0.24, 0.65, 0.75);
      const crate = box(view, wood, 0.2, 1.4, 0, 0.8, 0.7, 0.7); crate.rotation.y = 0.23;
    }
  }
  for (const text of map.labels) label(text.text, text.x, text.y, text.z, text.yaw, text.width, text.height, text.color);
  const chalk = new THREE.MeshBasicMaterial({ color: CHALK });
  const wallGuns: Promise<unknown>[] = [];
  for (const weapon of map.wallWeapons) {
    const sign = new THREE.Group();
    sign.position.set(weapon.position.x, weapon.position.y + 0.4, weapon.position.z);
    sign.rotation.y = map.wallWeaponFacing[weapon.id] ?? 0;
    group.add(sign);
    // The real gun over its chalk outline; a chalk bar with a blocky rifle only if the model can't load.
    const pending = prepareWeaponModel(weapon.weaponId);
    const fallback = () => {
      box(sign, chalk, 0, 0, 0, 1.75, 0.17, 0.015);
      box(sign, wood, -0.5, -0.015, 0.025, 0.55, 0.18, 0.055);
      box(sign, iron, 0.25, 0.025, 0.025, 1.15, 0.065, 0.055);
    };
    if (pending) wallGuns.push(pending.then(model => mountWallGun(sign, model, chalk), error => {
      console.warn(`Unable to load the ${weapon.weaponId} wall gun`, error); fallback();
    }));
    else fallback();
    const name = writing(weaponName(weapon.weaponId).toUpperCase(), 1.65, 0.24);
    name.position.set(0, -0.38, 0.03); sign.add(name);
  }
  // The iron-bound random box. Its authoritative state drives the lid, where it stands and the bear.
  // The chest stands on its floor: a box centre is the middle of its 1.04 m-tall collision box.
  const chest = new THREE.Group(); chest.position.set(map.boxCenter.x, map.boxCenter.y - 0.52, map.boxCenter.z);
  chest.rotation.y = map.boxYaw; group.add(chest);
  const moves = (map.mysteryBoxes[0]?.locations?.length ?? 0) > 1;
  // A fixed box's body is part of the greybox; one that moves carries its own.
  if (moves) { chest.userData.dynamic = true; box(chest, wood, 0, 0.52, 0, 0.95, 1.04, 2.35); }
  // A map can mark a box that moves with a pale beam of light, so players can find it (Verrückt does not).
  if (moves && map.boxLocatorBeam) {
    // A soft glow that always faces the viewer, so it never shows the edges of a solid.
    const beam = new THREE.Sprite(new THREE.SpriteMaterial({ map: beamFade(), color: 0xcfe0ff, transparent: true, opacity: 0.5,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    beam.center.set(0.5, 0); beam.scale.set(1.8, 24, 1); beam.position.set(0, 0.6, 0); chest.add(beam);
  }
  // The teddy bear that comes up instead of a gun, before the box leaves.
  const fur = new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 1 });
  const teddy = new THREE.Group(); teddy.visible = false; chest.add(teddy);
  for (const [x, y, z, r] of [[0, 0, 0, 0.2], [0, 0.3, 0, 0.14], [0, 0.42, 0.1, 0.05], [0, 0.42, -0.1, 0.05],
    [0.05, -0.12, 0.2, 0.07], [0.05, -0.12, -0.2, 0.07], [0.1, 0.05, 0.2, 0.06], [0.1, 0.05, -0.2, 0.06]]) {
    const ball = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), fur); ball.position.set(x, y, z); teddy.add(ball);
  }
  for (const z of [-0.8, 0.8]) box(chest, iron, 0, 0.55, z, 1.01, 1.12, 0.12);
  const lid = new THREE.Group(); lid.position.set(-0.49, 1.06, 0); chest.add(lid);
  lid.userData.dynamic = true;
  box(lid, wood, 0.49, 0, 0, 1.06, 0.13, 2.4);
  const question = writing('?  ?  ?', 1.9, 0.6, '#f6d893');
  question.position.set(0.5, 0.075, 0); question.rotation.x = -Math.PI / 2; question.rotation.z = Math.PI / 2; lid.add(question);
  const glow = lightPool.add(new LightSource(0xffbf57, 4, 6, 2)); glow.position.set(0, 1.3, 0); chest.add(glow);
  let rewardLabel = writing('MYSTERY BOX', 2, 0.3, '#f6d893');
  rewardLabel.position.set(0.7, 1.8, 0); rewardLabel.rotation.y = Math.PI / 2; chest.add(rewardLabel);
  let rewardText = 'MYSTERY BOX';
  // WaW's roll: guns flick past above the open box, slowing until the prize settles, then sink back in.
  const boxGun = new THREE.Group(); boxGun.userData.dynamic = true; chest.add(boxGun);
  const boxGunModels = new Map<string, THREE.Object3D>();
  const boxGunModel = (id: string): THREE.Object3D | null => {
    let model = boxGunModels.get(id);
    if (!model) {
      const weapon = readyWeaponModel(id);
      if (!weapon) { void prepareWeaponModel(id)?.catch(() => {}); return null; }
      model = weapon.root.clone(true);
      model.position.set(0, 0, 0); model.rotation.set(0, 0, 0); model.scale.setScalar(1.1);
      model.updateMatrixWorld(true);
      // Centre the gun over the box; its side faces the front, its muzzle runs along the box.
      const centre = new THREE.Box3().setFromObject(model).getCenter(new THREE.Vector3());
      model.position.sub(centre);
      model.visible = false; boxGun.add(model); boxGunModels.set(id, model);
    }
    return model;
  };
  let shownGun: THREE.Object3D | null = null;
  const showBoxGun = (id: string | null, height: number) => {
    const model = id ? boxGunModel(id) : null;
    if (shownGun && shownGun !== model) shownGun.visible = false;
    if (model) model.visible = true;
    shownGun = model;
    boxGun.position.set(0, height, 0);
  };
  // The power switch: a lever on its panel and a lamp that turns from red to green.
  const lever = new THREE.Group(); lever.userData.dynamic = true;
  const powerLamp = new THREE.MeshBasicMaterial({ color: 0xc02010 });
  if (map.powerSwitch) {
    const { x, y, z } = map.powerSwitch.position;
    lever.position.set(x + 0.18, y, z - 0.02); group.add(lever);
    box(lever, iron, 0, 0.18, 0, 0.07, 0.36, 0.07);
    box(lever, wood, 0, 0.38, 0, 0.1, 0.1, 0.1);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), powerLamp);
    lamp.position.set(x - 0.2, y + 0.35, z); group.add(lamp);
  }
  // Perk-a-cola machines: a vintage vending machine painted in each perk's colour, with its name on a
  // sign across the top and a glow, lit once the power is on.
  const PERK_COLOURS: Record<PerkId, number> = { juggernog: 0xa01818, 'double-tap': 0xb86e14, 'speed-cola': 0x1f9038, 'quick-revive': 0x2860c0 };
  const perkLights: { materials: THREE.MeshStandardMaterial[]; light: LightSource; colour: number }[] = [];
  const machines = (map.perkMachines ?? []).map(machine => {
    const facing = map.perkMachineFacing?.[machine.id] ?? 0;
    const view = new THREE.Group(); group.add(view);
    view.position.set(machine.position.x - Math.sin(facing), machine.position.y - 1, machine.position.z - Math.cos(facing));
    view.rotation.y = facing;
    const sign = new THREE.MeshStandardMaterial({ color: 0x1a1512, emissive: PERK_COLOURS[machine.perk], emissiveIntensity: 0, roughness: 0.5 });
    box(view, sign, 0, 2.2, 0.28, 1.0, 0.24, 0.1);
    const name = writing(PERKS[machine.perk].name.toUpperCase(), 0.95, 0.22, '#fff4dc');
    name.position.set(0, 2.2, 0.34); view.add(name);
    const light = lightPool.add(new LightSource(PERK_COLOURS[machine.perk], 0, 5, 2)); light.position.set(0, 1.4, 1); view.add(light);
    view.userData.dynamic = true;
    const lights = { materials: [sign], light, colour: PERK_COLOURS[machine.perk] };
    perkLights.push(lights);
    return { machine, view, lights };
  });
  const vending = machines.length ? loadModel(VENDING_MODEL).then(async gltf => {
    for (const { machine, view, lights } of machines) {
      const model = gltf.scene.clone(true);
      const paint = await loadPaint(VENDING_PAINTS[machine.perk]).catch(() => null);
      model.traverse(object => {
        if (!(object instanceof THREE.Mesh) || !(object.material instanceof THREE.MeshStandardMaterial)) return;
        object.castShadow = true; object.receiveShadow = true;
        if (object.material.transparent) return;
        const material = object.material.clone();
        if (paint) material.map = paint;
        material.emissive.setHex(lights.colour); material.emissiveIntensity = 0;
        object.material = material; lights.materials.push(material);
      });
      view.add(model);
    }
  }).catch(error => console.warn('Perk machine model unavailable', error)) : Promise.resolve();
  // Electric traps: iron pylons at either end of the live strip, a grate between, and a switch box.
  const trapViews = new Map<string, { arcs: THREE.LineSegments; light: LightSource; lamp: THREE.MeshBasicMaterial;
    from: THREE.Vector3; to: THREE.Vector3 }>();
  for (const trap of map.traps ?? []) {
    const { min, max } = trap.zone;
    const floor = min.y + 0.5, alongX = max.x - min.x >= max.z - min.z;
    const mid = { x: (min.x + max.x) / 2, z: (min.z + max.z) / 2 };
    const from = alongX ? new THREE.Vector3(min.x + 0.15, floor, mid.z) : new THREE.Vector3(mid.x, floor, min.z + 0.15);
    const to = alongX ? new THREE.Vector3(max.x - 0.15, floor, mid.z) : new THREE.Vector3(mid.x, floor, max.z - 0.15);
    for (const end of [from, to]) {
      box(group, iron, end.x, floor + 1.1, end.z, 0.14, 2.2, 0.14);
      for (const h of [0.5, 1.1, 1.7]) box(group, iron, end.x, floor + h, end.z, 0.26, 0.1, 0.26);
    }
    box(group, iron, mid.x, floor + 0.01, mid.z, alongX ? max.x - min.x - 0.3 : 0.5, 0.02, alongX ? 0.5 : max.z - min.z - 0.3);
    const arcs = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xbfe4ff }));
    arcs.visible = false; arcs.userData.dynamic = true; group.add(arcs);
    const light = lightPool.add(new LightSource(0x8fc8ff, 0, 9, 2)); light.position.set(mid.x, floor + 1.4, mid.z); group.add(light);
    const lamp = new THREE.MeshBasicMaterial({ color: 0x401010 });
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), lamp);
    bulb.position.set(trap.switchPosition.x, trap.switchPosition.y + 0.28, trap.switchPosition.z); group.add(bulb);
    trapViews.set(trap.id, { arcs, light, lamp, from, to });
  }
  // Warm practical lights against cold exterior moonlight.
  const practicalLights: LightSource[] = [];
  for (const { x, y, z } of map.lights) {
    const light = lightPool.add(new LightSource(0xffc38b, 11, 10, 1.6)); light.position.set(x, y, z); group.add(light);
    practicalLights.push(light);
  }
  // Low rubble stays below the collision step height and out of navigation lanes.
  let seed = 753;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const lumps = Array.from({ length: 6 }, () => {
    // A few broken-chunk shapes: a squashed, dented polyhedron each.
    const geometry = new THREE.DodecahedronGeometry(0.5, 0);
    const position = geometry.attributes.position;
    for (let i = 0; i < position.count; i++) {
      const scale = 0.7 + random() * 0.6;
      position.setXYZ(i, position.getX(i) * scale, position.getY(i) * scale * 0.55, position.getZ(i) * scale);
    }
    geometry.computeVertexNormals();
    return geometry;
  });
  for (const area of map.rubble) for (let i = 0; i < area.count; i++) {
    const x = area.minX + random() * (area.maxX - area.minX), z = area.minZ + random() * (area.maxZ - area.minZ);
    if (i % 4 === 0) {
      const splinter = box(group, boards, x, area.y + 0.012, z, 0.35 + random() * 0.5, 0.025, 0.07 + random() * 0.06);
      splinter.rotation.y = random() * Math.PI;
      continue;
    }
    const size = 0.08 + random() * 0.2;
    const lump = new THREE.Mesh(lumps[i % lumps.length], i % 3 ? debris : concrete);
    lump.position.set(x, area.y + size * 0.2, z); lump.scale.setScalar(size);
    lump.rotation.set(random() * 0.4, random() * Math.PI * 2, random() * 0.4);
    lump.castShadow = true; lump.receiveShadow = true; group.add(lump);
  }
  // Leaf litter all around; the treeline (src/client/treeline.ts) and night sky (sky.ts) stand beyond it.
  const ground = new THREE.PlaneGeometry(180, 180);
  ground.rotateX(-Math.PI / 2);
  // Just below floor level, so zombies and scenery outside stand on it (floors and cobbles cover it indoors).
  projectWorldUvs(ground, new THREE.Vector3(map.focus.x, -0.02, map.focus.z), lookScale('forest-floor'));
  const outside = new THREE.Mesh(ground, environmentMaterial('forest-floor'));
  outside.position.set(map.focus.x, -0.02, map.focus.z); outside.receiveShadow = true; group.add(outside);
  // A round stone fountain: a basin with a lip, still dark water, and a pillar with a bowl.
  if (map.fountain) {
    const stone = environmentMaterial('weathered-concrete-a');
    const fountain = new THREE.Group(); fountain.position.set(map.fountain.x, 0, map.fountain.z); group.add(fountain);
    const lathe = (points: Array<[number, number]>) => {
      const geometry = new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), 32);
      const uv = geometry.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 6, uv.getY(i));
      const mesh = new THREE.Mesh(geometry, stone); mesh.castShadow = true; mesh.receiveShadow = true;
      fountain.add(mesh); return mesh;
    };
    lathe([[2.2, 0], [2.65, 0.02], [2.7, 0.5], [2.62, 0.62], [2.35, 0.62], [2.3, 0.3], [0, 0.3]]);
    const water = new THREE.Mesh(new THREE.CircleGeometry(2.3, 32),
      new THREE.MeshStandardMaterial({ color: 0x10181a, roughness: 0.08, metalness: 0.2 }));
    water.rotation.x = -Math.PI / 2; water.position.y = 0.42; fountain.add(water);
    lathe([[0.3, 0.3], [0.24, 0.6], [0.2, 1.3], [0.28, 1.4], [0.75, 1.45], [0.8, 1.6], [0.7, 1.62], [0.25, 1.55], [0.18, 1.9], [0.1, 2.1], [0, 2.12]]);
  }
  let shadowPose = '';
  return { ready: Promise.allSettled([...wallGuns, vending]), update(state) {
    let moved = false;
    // On a map with a switch, the lamps burn low until the power comes on.
    const lampLevel = map.powerSwitch && !state.power.on ? 0.4 : 1;
    for (let i = 0; i < practicalLights.length; i++) {
      practicalLights[i].intensity = 11 * lampLevel * lampFlicker(state.world.tick, i * 137 + 47);
    }
    lever.rotation.z = state.power.on ? -2.3 : 0;
    powerLamp.color.setHex(state.power.on ? 0x30e060 : 0xc02010);
    for (const { materials, light } of perkLights) {
      // The sign lights up fully; the machine's paint only takes a faint glow of its colour.
      materials.forEach((material, index) => { material.emissiveIntensity = state.power.on ? index === 0 ? 0.9 : 0.06 : 0; });
      light.intensity = state.power.on ? 3 : 0;
    }
    for (const trap of state.traps) {
      const view = trapViews.get(trap.id);
      if (!view) continue;
      const live = trap.activeTicks > 0;
      view.lamp.color.setHex(!state.power.on ? 0x401010 : live ? 0xffd040 : trap.cooldownTicks > 0 ? 0xc02010 : 0x30e060);
      view.arcs.visible = live;
      view.light.intensity = live ? 6 + 5 * Math.sin(state.world.tick * 1.7) ** 2 : 0;
      // Fresh jagged arcs every few ticks, at three heights between the pylons.
      if (live && state.world.tick % 3 === 0) {
        const points: number[] = [];
        let jitter = state.world.tick * 2654435761 >>> 0;
        const next = () => { jitter = (Math.imul(jitter, 1664525) + 1013904223) >>> 0; return jitter / 4294967296 - 0.5; };
        for (const height of [0.5, 1.1, 1.7]) {
          let last = view.from.clone().setY(view.from.y + height);
          for (let step = 1; step <= 10; step++) {
            const point = view.from.clone().lerp(view.to, step / 10);
            point.y += height + (step < 10 ? next() * 0.4 : 0);
            if (step < 10) { point.x += next() * 0.3; point.z += next() * 0.3; }
            points.push(last.x, last.y, last.z, point.x, point.y, point.z);
            last = point;
          }
        }
        view.arcs.geometry.dispose();
        view.arcs.geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
      }
    }
    for (const barrier of state.barriers) {
      const planks = barrierViews.get(barrier.id);
      if (!planks) continue;
      const elapsed = barrier.lastTornTick >= 0 ? (state.world.tick - barrier.lastTornTick) / 60 : null;
      if (planks.setState(barrier.boards, elapsed)) moved = true;
    }
    for (const door of state.doors) {
      const view = doorViews.get(door.id);
      if (view && view.visible === door.open) { view.visible = !door.open; moved = true; }
    }
    const currentBox = state.mysteryBoxes[0];
    const spot = currentBox?.locations[currentBox.locationIndex];
    // The bear rises out of the open box, then the box lifts away and is gone until it lands elsewhere.
    const leaving = currentBox?.phase === 'teddy' ? 1 - currentBox.cooldownTicks / BOX_RULES.teddyTicks : 0;
    if (spot) {
      chest.position.set(spot.center.x, spot.center.y - 0.52 + Math.max(0, leaving - 0.55) * 7, spot.center.z);
      chest.rotation.y = spot.yaw;
    }
    chest.visible = currentBox?.phase !== 'away';
    teddy.visible = currentBox?.phase === 'teddy';
    teddy.position.set(0, 0.9 + Math.min(1, leaving * 2) * 0.55, 0);
    const active = !!currentBox && currentBox.phase !== 'idle';
    lid.rotation.z = active ? 1.05 : 0;
    glow.intensity = currentBox?.phase === 'offering' ? 14 : active ? 8 : 3;
    if (currentBox?.phase === 'rolling') {
      const progress = 1 - currentBox.cooldownTicks / BOX_RULES.rollTicks;
      // Easing out: many switches early, fewer as the roll ends; the prize holds for the last stretch.
      const step = Math.floor((1 - (1 - progress) ** 2) * 22);
      const pool = currentBox.weapons;
      let id: string | null = currentBox.lastWeapon;
      if (progress < 0.86 && pool.length) {
        id = null;
        for (let probe = 0; probe < pool.length && !id; probe++) {
          const candidate = pool[(Math.imul(step + probe, 2654435761) + currentBox.rolls * 7 >>> 0) % pool.length];
          if (readyWeaponModel(candidate)) id = candidate;
        }
      }
      showBoxGun(id, 0.95 + 0.5 * Math.min(1, progress * 1.8));
    } else if (currentBox?.phase === 'offering') {
      showBoxGun(currentBox.lastWeapon, 1.45 - 0.45 * (1 - currentBox.cooldownTicks / BOX_RULES.claimTicks));
    } else showBoxGun(null, 0);
    rewardLabel.visible = currentBox?.phase !== 'rolling';
    const nextText = currentBox?.phase === 'offering' && currentBox.lastWeapon
      ? weaponName(currentBox.lastWeapon).toUpperCase()
      : currentBox?.phase === 'rolling' ? '?  ?  ?' : 'MYSTERY BOX';
    if (rewardText !== nextText) {
      const oldMaterial = rewardLabel.material as THREE.MeshBasicMaterial;
      oldMaterial.map?.dispose(); oldMaterial.dispose(); rewardLabel.geometry.dispose();
      rewardLabel.removeFromParent();
      rewardLabel = writing(nextText, 2, 0.3, '#f6d893');
      rewardLabel.position.set(0.7, 1.8, 0); rewardLabel.rotation.y = Math.PI / 2;
      chest.add(rewardLabel); rewardText = nextText; rewardLabel.visible = currentBox?.phase !== 'rolling';
    }
    // The chest, its lid and the lever cast shadows too.
    const pose = `${chest.visible && chest.position.toArray().join()},${chest.rotation.y},${lid.rotation.z},${lever.rotation.z}`;
    if (pose !== shadowPose) { shadowPose = pose; moved = true; }
    return moved;
  } };
}
