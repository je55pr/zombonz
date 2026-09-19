import * as THREE from 'three';
import { bunkerMaterial } from './greybox.ts';
import { NACHT_DOORS, NACHT_WINDOWS, NACHT_WALL_WEAPONS, UPPER_HEIGHT } from '../maps/nacht.ts';
import type { SimulationState } from '../core/simulation.ts';

export function buildBunkerDetails(scene: THREE.Scene): { update(state: SimulationState): void } {
  const group = new THREE.Group();
  group.name = 'nacht-bunker-details';
  scene.add(group);
  const wood = bunkerMaterial('barrier');
  const concrete = bunkerMaterial('wall');
  const iron = bunkerMaterial('metal');
  const dark = new THREE.MeshStandardMaterial({ color: 0x25251f, roughness: 1 });
  const box = (parent: THREE.Object3D, material: THREE.Material, x: number, y: number, z: number,
    sx: number, sy: number, sz: number) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), material);
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
  const barrierViews = new Map<string, THREE.Mesh[]>();
  for (const opening of NACHT_WINDOWS) {
    const frame = new THREE.Group();
    frame.position.set(opening.x, opening.y, opening.z);
    if (opening.axis === 'z') frame.rotation.y = Math.PI / 2;
    group.add(frame);
    box(frame, concrete, 0, 0.88, 0, 2.25, 0.15, 0.65);
    box(frame, iron, -1, 1.75, 0, 0.09, 1.75, 0.25);
    box(frame, iron, 1, 1.75, 0, 0.09, 1.75, 0.25);
    const planks: THREE.Mesh[] = [];
    barrierViews.set(opening.id, planks);
    for (let i = 0; i < 3; i++) {
      const plank = box(frame, wood, i === 1 ? -0.12 : 0.1, 1.16 + i * 0.46, 0.03, 1.9, 0.16, 0.09);
      plank.rotation.z = i === 1 ? -0.16 : 0.07;
      planks.push(plank);
    }
  }
  // Overhead structure. Broken roof strips leave the upstairs open to the moon.
  for (const y of [3.05, 6.65]) {
    for (const z of [-5.9, -2.4, 1.3, 5.8]) box(group, iron, 0, y, z, 15.6, 0.25, 0.18);
  }
  for (const x of [-6.4, -2.3, 3.8, 6.8]) box(group, dark, x, 6.85, 0, 1.5, 0.12, 13.7);
  // Exposed wall bases and structural columns emphasize the room proportions.
  for (const x of [-7.74, 7.74]) {
    for (const z of [-6.7, -0.2, 6.7]) box(group, concrete, x, 3.3, z, 0.34, 6.6, 0.4);
  }
  const doorViews = new Map<string, THREE.Group>();
  for (const door of NACHT_DOORS) {
    const view = new THREE.Group(); group.add(view); doorViews.set(door.id, view);
    if (door.id === 'help-room') {
      for (let i = 0; i < 6; i++) box(view, wood, 0, 1.4, -1 + i * 0.4, 0.24, 2.8, 0.38);
      box(view, iron, -0.14, 0.65, 0, 0.06, 0.12, 2.3);
      box(view, iron, -0.14, 2.05, 0, 0.06, 0.12, 2.3);
      const help = writing('HELP', 1.7, 0.62, '#d9d0ba');
      help.rotation.y = -Math.PI / 2; help.position.set(-0.17, 1.5, 0); view.add(help);
    } else {
      const { x, z } = door.position;
      // A sofa and stacked crates, matching the silhouette of Nacht's debris.
      box(view, wood, x, 2.05, z, 2.1, 0.55, 0.95);
      box(view, dark, x, 2.55, z + 0.3, 2.1, 0.7, 0.25);
      box(view, wood, x - 0.78, 2.5, z, 0.3, 0.65, 0.95);
      box(view, wood, x + 0.78, 2.5, z, 0.3, 0.65, 0.95);
      const crate = box(view, wood, x + 0.2, 3.1, z, 0.9, 0.7, 0.8); crate.rotation.y = 0.23;
    }
  }
  label('HELP  →', -0.215, 2.35, -2.5, -Math.PI / 2, 1.7, 0.45);
  label('YOU MUST ASCEND', -5.08, 2.65, 2.7, Math.PI / 2, 2.7, 0.38);
  label('FROM DARKNESS', -5.08, 2.25, 2.7, Math.PI / 2, 2.5, 0.38);
  label('DIE TOTEN', 0.2, 5.1, -4.7, Math.PI / 2, 2.3, 0.5, '#8e5140');
  for (const weapon of NACHT_WALL_WEAPONS) {
    const sign = new THREE.Group();
    sign.position.set(weapon.position.x, 1.4, weapon.position.z);
    sign.rotation.y = weapon.position.x < 0 ? Math.PI / 2 : -Math.PI / 2;
    group.add(sign);
    // Chalk outline with a simple wall-mounted rifle silhouette.
    const chalk = new THREE.MeshBasicMaterial({ color: 0xc9c7a7 });
    box(sign, chalk, 0, 0, 0, 1.75, 0.17, 0.015);
    box(sign, wood, -0.5, -0.015, 0.025, 0.55, 0.18, 0.055);
    box(sign, iron, 0.25, 0.025, 0.025, 1.15, 0.065, 0.055);
    const name = writing(weapon.weaponId.toUpperCase(), 1.65, 0.24);
    name.position.set(0, -0.38, 0.03); sign.add(name);
  }
  // One fixed, iron-bound random box. Its authoritative state drives the lid.
  for (const z of [-5.2, -3.6]) box(group, iron, 1.1, 0.55, z, 1.01, 1.12, 0.12);
  const lid = new THREE.Group(); lid.position.set(0.61, 1.06, -4.4); group.add(lid);
  box(lid, wood, 0.49, 0, 0, 1.06, 0.13, 2.4);
  const question = writing('?  ?  ?', 1.9, 0.6, '#f6d893');
  question.position.set(0.5, 0.075, 0); question.rotation.x = -Math.PI / 2; question.rotation.z = Math.PI / 2; lid.add(question);
  const glow = new THREE.PointLight(0xffbf57, 4, 6, 2); glow.position.set(1.2, 1.3, -4.4); group.add(glow);
  const rewardLabel = writing('MYSTERY BOX', 2, 0.3, '#f6d893');
  rewardLabel.position.set(0.24, 1.8, -4.4); rewardLabel.rotation.y = Math.PI / 2; group.add(rewardLabel);
  // Warm practical lights against cold exterior moonlight.
  for (const [x, y, z] of [[-3, 2.8, -1], [3, 2.8, 2], [-3, 6.1, 1]] as const) {
    box(group, iron, x, y + 0.05, z, 0.3, 0.16, 0.3);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffd398 }));
    bulb.position.set(x, y - 0.07, z); group.add(bulb);
    const light = new THREE.PointLight(0xffb66d, 13, 10, 1.6); light.position.set(x, y - 0.15, z); group.add(light);
  }
  // Low rubble stays below the collision step height and out of navigation lanes.
  let seed = 753;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < 100; i++) {
    const x = -7 + random() * 14, z = (i % 2 ? -1 : 1) * (5.8 + random() * 0.8);
    const y = i % 3 === 0 ? UPPER_HEIGHT : 0;
    const rubble = box(group, i % 3 ? concrete : wood, x, y + 0.045, z, 0.12 + random() * 0.3, 0.09, 0.1 + random() * 0.25);
    rubble.rotation.y = random() * Math.PI;
  }
  // A foggy treeline is visible through every opening, with no external assets.
  box(group, dark, 0, -0.25, 0, 160, 0.1, 160);
  const bark = new THREE.MeshStandardMaterial({ color: 0x1d2422, roughness: 1 });
  for (let i = 0; i < 55; i++) {
    const angle = random() * Math.PI * 2, radius = 15 + random() * 35;
    const tree = new THREE.Group(); tree.position.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.27, 7 + random() * 6, 5), bark);
    trunk.position.y = 4; tree.add(trunk);
    for (let j = 0; j < 3; j++) {
      const branch = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.11, 2.7, 4), bark);
      branch.position.set(j % 2 ? 0.8 : -0.8, 3 + j * 1.5, 0);
      branch.rotation.z = j % 2 ? -0.7 : 0.7; tree.add(branch);
    }
    tree.rotation.y = angle; group.add(tree);
  }
  const moon = new THREE.Mesh(new THREE.SphereGeometry(1.4, 20, 12), new THREE.MeshBasicMaterial({ color: 0xc9dad5, fog: false }));
  moon.position.set(-22, 30, -42); group.add(moon);
  return { update(state) {
    for (const barrier of state.barriers) {
      const planks = barrierViews.get(barrier.id);
      if (!planks) continue;
      for (let i = 0; i < planks.length; i++) {
        const plank = planks[i];
        const intact = i < barrier.boards;
        // The newest torn plank tumbles out before disappearing; repairs restore it.
        const elapsed = (state.world.tick - barrier.lastTornTick) / 60;
        const falling = !intact && i === barrier.boards && barrier.lastTornTick >= 0 && elapsed < 0.8;
        plank.visible = intact || falling;
        plank.position.y = 1.16 + i * 0.46 - (falling ? elapsed * elapsed * 4 : 0);
        plank.rotation.z = (i === 1 ? -0.16 : 0.07) + (falling ? elapsed * 2 : 0);
        plank.rotation.x = falling ? elapsed * 1.5 : 0;
      }
    }
    for (const door of state.doors) { const view = doorViews.get(door.id); if (view) view.visible = !door.open; }
    const active = (state.mysteryBoxes[0]?.cooldownTicks ?? 0) > 0;
    lid.rotation.z = active ? 1.05 : 0;
    glow.intensity = active ? 12 : 3;
  } };
}
