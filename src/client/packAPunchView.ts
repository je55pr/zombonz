import * as THREE from 'three';
import type { GameMap } from '../maps/gameMap.ts';
import type { SimulationState } from '../core/simulation.ts';
import { PACK_A_PUNCH_BODY, PACK_A_PUNCH_RULES } from '../core/packAPunch.ts';
import { baseWeaponId } from '../core/upgrades.ts';
import { LightSource, type LightPool } from './lightPool.ts';
import { prepareWeaponModel, readyWeaponModel } from './weaponView.ts';

/** The machine's glow: cool while it waits, forge-hot while it works, green when the gun is out. */
export const PACK_A_PUNCH_GLOW = { idle: 0x4db8ff, upgrading: 0xffa030, ready: 0x9dff6a } as const;
/** Where the gun hovers, in the machine's own space (+z is out of its front), and how it lies (along the front). */
const DISPLAY = { x: 0, y: 1.2, z: 0.95 };
const GUN_SCALE = 0.95;

/** A canvas of glowing words on black, for the signboard's emissive map. */
function signTexture(text: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 192;
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#000'; context.fillRect(0, 0, 1024, 192);
  context.font = '700 118px Oswald, Impact, sans-serif'; context.textAlign = 'center'; context.textBaseline = 'middle';
  context.fillStyle = '#fff'; context.fillText('PACK-A-PUNCH', 512, 100, 960);
  context.strokeStyle = '#fff'; context.lineWidth = 6; context.strokeRect(14, 14, 996, 164);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

const smooth = (from: number, to: number, t: number) => { const x = Math.max(0, Math.min(1, (t - from) / (to - from))); return x * x * (3 - 2 * x); };

interface MachineView {
  root: THREE.Group;
  shell: THREE.Group;
  glowMaterials: THREE.MeshStandardMaterial[];
  light: LightSource;
  needles: THREE.Object3D[];
  /** Status lamps down the right of the front: off (no power), working, and ready or waiting. */
  lamps: { off: THREE.MeshBasicMaterial; working: THREE.MeshBasicMaterial; ready: THREE.MeshBasicMaterial };
  wheel: THREE.Object3D;
  display: THREE.Group;
  guns: Map<string, THREE.Object3D>;
  shown: THREE.Object3D | null;
  lastKey: string;
}

/**
 * Each Pack-a-Punch machine of a map: a riveted steel cabinet with a glowing intake and a tray, whose glow, gauges
 * and hovering gun follow its authoritative state. Built from primitives, so it needs no asset. `update` says
 * whether anything that casts a moon shadow appeared or vanished.
 */
export function buildPackAPunchMachines(parent: THREE.Group, map: GameMap, lightPool: LightPool): { update(state: SimulationState): boolean } {
  const steel = new THREE.MeshStandardMaterial({ color: 0x353c40, metalness: 0.55, roughness: 0.62 });
  const iron = new THREE.MeshStandardMaterial({ color: 0x1b1e20, metalness: 0.5, roughness: 0.7 });
  const brass = new THREE.MeshStandardMaterial({ color: 0xa27b2e, metalness: 0.8, roughness: 0.4 });
  const glass = () => new THREE.MeshStandardMaterial({ color: 0x0b1518, emissive: PACK_A_PUNCH_GLOW.idle, emissiveIntensity: 0, roughness: 0.2, metalness: 0.1 });
  const signMap = map.packAPunch?.length ? signTexture('PACK-A-PUNCH') : null;
  const rivets = new THREE.SphereGeometry(0.02, 6, 4);
  const views: MachineView[] = [];

  for (const definition of map.packAPunch ?? []) {
    const root = new THREE.Group(); root.name = `pack-a-punch-${definition.id}`;
    root.position.set(definition.position.x, definition.position.y, definition.position.z);
    root.rotation.y = definition.yaw;
    parent.add(root);
    // The body and everything on it that stays put; its shake is the shell's alone, so the display and the light keep still.
    const shell = new THREE.Group(); shell.userData.dynamic = true; root.add(shell);
    const part = (material: THREE.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number, cast = true) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), material);
      mesh.position.set(x, y, z); mesh.castShadow = cast; mesh.receiveShadow = true; shell.add(mesh); return mesh;
    };
    const { width, depth, height } = PACK_A_PUNCH_BODY;
    part(iron, 0, 0.06, 0, width + 0.1, 0.12, depth + 0.1);
    part(steel, 0, 0.12 + 0.75, -0.04, width - 0.1, 1.5, depth - 0.14);
    part(iron, 0, 1.62 + 0.03, -0.04, width - 0.02, 0.06, depth - 0.06);
    part(steel, 0, 1.68 + 0.27, -0.04, width - 0.16, 0.54, depth - 0.2);
    part(iron, 0, height - 0.03, -0.04, width - 0.04, 0.06, depth - 0.04);
    // A stack, two pipes down the sides with brass collars, and a bracket for the valve wheel.
    const pipe = (x: number, z: number, low: number, high: number, radius: number) => {
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, high - low, 10), iron);
      mesh.position.set(x, (low + high) / 2, z); mesh.castShadow = true; shell.add(mesh); return mesh;
    };
    pipe(0.5, -0.1, height, height + 0.42, 0.09);
    for (const side of [-1, 1]) {
      pipe(side * (width / 2 - 0.02), -0.3, 0.12, 2.02, 0.05);
      for (const y of [0.4, 1.0, 1.6]) {
        const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.068, 0.068, 0.05, 10), brass);
        collar.position.set(side * (width / 2 - 0.02), y, -0.3); shell.add(collar);
      }
    }
    // The front: a dark recess with the glowing intake slot, and the tray under it.
    const front = depth / 2 - 0.04 - 0.07;
    part(iron, 0, 0.98, front + 0.005, 1.0, 0.6, 0.08);
    const slot = glass(); part(slot, 0, 1.08, front + 0.05, 0.78, 0.09, 0.03, false);
    part(brass, 0, 0.93, front + 0.09, 0.9, 0.05, 0.22);
    part(iron, 0, 0.9, front + 0.2, 0.96, 0.03, 0.34);
    // The signboard: an emissive plate across the top of the front, lettered.
    const sign = new THREE.MeshStandardMaterial({ color: 0x080d10, emissive: PACK_A_PUNCH_GLOW.idle, emissiveMap: signMap ?? undefined,
      emissiveIntensity: 0, roughness: 0.4 });
    part(sign, 0, 2.02, front + 0.05, 1.46, 0.27, 0.06);
    // Two gauges down the left of the front, each a glass face and a needle on its pivot; three lamps down the right.
    const needles: THREE.Object3D[] = [];
    const glowMaterials = [slot, sign];
    for (const y of [1.46, 1.16]) {
      const x = -0.635;
      const face = glass(); glowMaterials.push(face);
      const dial = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.04, 20), face);
      dial.rotation.x = Math.PI / 2; dial.position.set(x, y, front + 0.05); shell.add(dial);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.115, 0.012, 6, 20), brass);
      rim.position.set(x, y, front + 0.07); shell.add(rim);
      const pivot = new THREE.Group(); pivot.position.set(x, y, front + 0.08); shell.add(pivot);
      const needle = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.09, 0.006), new THREE.MeshBasicMaterial({ color: 0xe8d9b0 }));
      needle.position.y = 0.04; pivot.add(needle); needles.push(pivot);
    }
    const lamps = { off: new THREE.MeshBasicMaterial({ color: 0x400808 }), working: new THREE.MeshBasicMaterial({ color: 0x402808 }),
      ready: new THREE.MeshBasicMaterial({ color: 0x0c3a12 }) };
    [lamps.off, lamps.working, lamps.ready].forEach((material, i) => {
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), material);
      lamp.position.set(0.635, 1.48 - i * 0.16, front + 0.06); shell.add(lamp);
    });
    // The valve wheel on the machine's right side: a ring and four spokes, turned while it works.
    const wheel = new THREE.Group(); wheel.userData.dynamic = true;
    wheel.position.set(width / 2 + 0.06, 1.05, 0.05); shell.add(wheel);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.02, 6, 20), brass); ring.rotation.y = Math.PI / 2; wheel.add(ring);
    for (let i = 0; i < 4; i++) {
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.32, 0.02), brass);
      spoke.rotation.x = i * Math.PI / 4; wheel.add(spoke);
    }
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.14, 8), iron); hub.rotation.z = Math.PI / 2; hub.position.x = -0.03; wheel.add(hub);
    // Rivets along the housing's top and bottom edges.
    const positions: THREE.Vector3[] = [];
    for (let i = 0; i < 12; i++) for (const y of [0.2, 1.55]) positions.push(new THREE.Vector3(-width / 2 + 0.16 + i * (width - 0.32) / 11, y, front + 0.045));
    const studs = new THREE.InstancedMesh(rivets, brass, positions.length);
    positions.forEach((position, index) => studs.setMatrixAt(index, new THREE.Matrix4().setPosition(position)));
    shell.add(studs);

    const light = lightPool.add(new LightSource(PACK_A_PUNCH_GLOW.idle, 0, 6, 2));
    light.position.set(0, 2.0, 1.5); root.add(light);
    const display = new THREE.Group(); display.name = 'pack-a-punch-display'; display.userData.dynamic = true; display.visible = false;
    display.position.set(DISPLAY.x, DISPLAY.y, DISPLAY.z); root.add(display);
    views.push({ root, shell, glowMaterials, light, needles, lamps, wheel, display, guns: new Map(), shown: null, lastKey: '' });
  }

  /** The gun lying across the front of the machine, centred on the display point, made when its model is ready. */
  function gunModel(view: MachineView, id: string): THREE.Object3D | null {
    let model = view.guns.get(id);
    if (!model) {
      const weapon = readyWeaponModel(id);
      if (!weapon) { void prepareWeaponModel(id)?.catch(() => {}); return null; }
      const holder = new THREE.Group(); holder.rotation.y = -Math.PI / 2;
      const gun = weapon.root.clone(true); gun.scale.setScalar(GUN_SCALE);
      holder.add(gun); holder.updateMatrixWorld(true);
      const centre = holder.worldToLocal(new THREE.Box3().setFromObject(holder).getCenter(new THREE.Vector3()));
      gun.position.sub(centre);
      holder.visible = false; view.display.add(holder); view.guns.set(id, holder); model = holder;
    }
    return model;
  }

  return { update(state) {
    let moved = false;
    state.packAPunch.forEach((machine, index) => {
      const view = views[index];
      if (!view) return;
      const powered = state.power.on, tick = state.world.tick;
      const colour = machine.phase === 'upgrading' ? PACK_A_PUNCH_GLOW.upgrading : machine.phase === 'ready' ? PACK_A_PUNCH_GLOW.ready : PACK_A_PUNCH_GLOW.idle;
      const progress = machine.phase === 'upgrading' ? 1 - machine.cooldownTicks / PACK_A_PUNCH_RULES.upgradeTicks : machine.phase === 'ready' ? 1 : 0;
      const pulse = 0.5 + 0.5 * Math.sin(tick * (machine.phase === 'upgrading' ? 0.55 : 0.09));
      const level = !powered ? 0 : machine.phase === 'upgrading' ? 1.4 + pulse * 1.4 : machine.phase === 'ready' ? 2 : 0.55 + pulse * 0.2;
      for (const material of view.glowMaterials) { material.emissive.setHex(colour); material.emissiveIntensity = level; }
      view.light.color.setHex(colour);
      view.light.intensity = !powered ? 0 : machine.phase === 'upgrading' ? 5 + pulse * 5 : machine.phase === 'ready' ? 4 : 2;
      // Working: the body shudders, the wheel spins and the needles climb; idle, they rest.
      view.lamps.off.color.setHex(powered ? 0x400808 : 0xff2a18);
      view.lamps.working.color.setHex(powered && machine.phase === 'upgrading' ? (pulse > 0.5 ? 0xffb030 : 0xa06010) : 0x402808);
      view.lamps.ready.color.setHex(powered && machine.phase !== 'upgrading' ? 0x50ff70 : 0x0c3a12);
      const shake = machine.phase === 'upgrading' ? 0.006 : 0;
      view.shell.position.set(Math.sin(tick * 1.9) * shake, 0, Math.cos(tick * 2.3) * shake);
      if (machine.phase === 'upgrading') view.wheel.rotation.x = tick * 0.25;
      view.needles.forEach((needle, i) => {
        needle.rotation.z = 0.9 - (machine.phase === 'idle' ? 0 : progress * 1.8) + (powered ? Math.sin(tick * 0.05 + i) * 0.03 : 0);
      });
      // The gun: the one put in slides into the face, the upgraded one is pushed out of it and hovers until taken.
      let shown: THREE.Object3D | null = null, sink = 0, bob = 0;
      if (machine.weaponId) {
        if (machine.phase === 'upgrading' && progress < 0.2) { shown = gunModel(view, baseWeaponId(machine.weaponId)); sink = smooth(0, 0.2, progress); }
        else if (machine.phase === 'upgrading' && progress > 0.8) { shown = gunModel(view, machine.weaponId); sink = 1 - smooth(0.8, 1, progress); }
        else if (machine.phase === 'ready') { shown = gunModel(view, machine.weaponId); bob = Math.sin(tick * 0.06) * 0.03; }
      }
      view.display.visible = !!shown;
      view.display.position.set(DISPLAY.x, DISPLAY.y + bob, DISPLAY.z - sink * 0.7);
      view.display.rotation.z = machine.phase === 'ready' ? Math.sin(tick * 0.04) * 0.04 : 0;
      if (shown !== view.shown) { if (view.shown) view.shown.visible = false; if (shown) shown.visible = true; view.shown = shown; }
      const key = `${machine.phase}|${machine.weaponId}|${!!shown}`;
      if (key !== view.lastKey) { view.lastKey = key; moved = true; }
    });
    return moved;
  } };
}
