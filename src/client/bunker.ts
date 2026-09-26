import * as THREE from 'three';
import { bunkerMaterial } from './greybox.ts';
import { environmentMaterial, projectWorldUvs } from './environmentMaterials.ts';
import { NACHT_DOORS, NACHT_WINDOWS, NACHT_WALL_WEAPONS, NACHT_BOX_CENTER, NACHT_RAILS, UPPER_HEIGHT } from '../maps/nacht.ts';
import type { SimulationState } from '../core/simulation.ts';

export function buildBunkerDetails(scene: THREE.Scene): { update(state: SimulationState): void } {
  const group = new THREE.Group();
  group.name = 'nacht-bunker-details';
  scene.add(group);
  const wood = bunkerMaterial('barrier');
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
  const barrierViews = new Map<string, THREE.Mesh[]>();
  for (const opening of NACHT_WINDOWS) {
    const frame = new THREE.Group();
    frame.position.set(opening.x, opening.y, opening.z);
    if (opening.axis === 'z') frame.rotation.y = Math.PI / 2;
    group.add(frame);
    box(frame, concrete, 0, 0.83, 0, opening.width + 0.25, 0.15, 0.65);
    box(frame, iron, -opening.width / 2, 1.75, 0, 0.09, 1.8, 0.25);
    box(frame, iron, opening.width / 2, 1.75, 0, 0.09, 1.8, 0.25);
    const planks: THREE.Mesh[] = [];
    barrierViews.set(opening.id, planks);
    for (let i = 0; i < 3; i++) {
      const plank = box(frame, wood, 0, 1.16 + i * 0.46, 0.03, opening.width + 0.1, 0.16, 0.09);
      plank.rotation.z = i === 1 ? -0.16 : 0.07;
      plank.userData.dynamic = true;
      planks.push(plank);
    }
  }
  // Architecture lives in shared map data, so the visuals and collision agree.
  // Short exposed reinforcing bars hang across the surviving roof edges.
  for (let i = 0; i < 12; i++) box(group, iron, -4.7 + i * 0.34, 6.66, -9.2, 0.025, 0.035, 1.5);
  for (const rail of NACHT_RAILS) {
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
  for (const door of NACHT_DOORS) {
    const view = new THREE.Group(); group.add(view); doorViews.set(door.id, view);
    view.userData.dynamic = true;
    if (door.id === 'help-room') {
      for (let i = 0; i < 6; i++) box(view, wood, 0, 1.4, -1 + i * 0.4, 0.24, 2.8, 0.38);
      box(view, iron, -0.14, 0.65, 0, 0.06, 0.12, 2.3);
      box(view, iron, -0.14, 2.05, 0, 0.06, 0.12, 2.3);
      const help = writing('HELP', 1.7, 0.62, '#d9d0ba');
      help.rotation.y = Math.PI / 2; help.position.set(0.17, 1.5, 0); view.add(help);
    } else {
      const { x, y, z } = door.position;
      view.position.set(x, y, z);
      if (door.id === 'start-stairs') view.rotation.y = Math.PI / 2;
      // A sofa and stacked crates, matching the silhouette of Nacht's debris.
      const width = door.id === 'start-stairs' ? 1.85 : 1.45;
      box(view, upholstery, 0, 0.35, 0, width, 0.55, 0.75);
      box(view, upholstery, 0, 0.85, 0.3, width, 0.7, 0.25);
      for (const side of [-1, 1]) box(view, upholstery, side * (width / 2 - 0.12), 0.8, 0, 0.24, 0.65, 0.75);
      const crate = box(view, wood, 0.2, 1.4, 0, 0.8, 0.7, 0.7); crate.rotation.y = 0.23;
    }
  }
  label('HELP', 0.215, 2.3, 2.2, Math.PI / 2, 1.6, 0.45);
  label('YOU MUST ASCEND', 5.6, 2.4, -2.385, 0, 2.7, 0.38);
  label('FROM DARKNESS', 5.6, 2, -2.385, 0, 2.5, 0.38);
  for (const weapon of NACHT_WALL_WEAPONS) {
    const sign = new THREE.Group();
    sign.position.set(weapon.position.x, 1.4, weapon.position.z);
    sign.rotation.y = weapon.position.x < 0 ? Math.PI / 2 : Math.PI;
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
  const chest = new THREE.Group(); chest.position.set(NACHT_BOX_CENTER.x, 0, NACHT_BOX_CENTER.z);
  chest.rotation.y = Math.PI / 2; group.add(chest);
  for (const z of [-0.8, 0.8]) box(chest, iron, 0, 0.55, z, 1.01, 1.12, 0.12);
  const lid = new THREE.Group(); lid.position.set(-0.49, 1.06, 0); chest.add(lid);
  lid.userData.dynamic = true;
  box(lid, wood, 0.49, 0, 0, 1.06, 0.13, 2.4);
  const question = writing('?  ?  ?', 1.9, 0.6, '#f6d893');
  question.position.set(0.5, 0.075, 0); question.rotation.x = -Math.PI / 2; question.rotation.z = Math.PI / 2; lid.add(question);
  const glow = new THREE.PointLight(0xffbf57, 4, 6, 2); glow.position.set(0, 1.3, 0); chest.add(glow);
  let rewardLabel = writing('MYSTERY BOX', 2, 0.3, '#f6d893');
  rewardLabel.position.set(0.7, 1.8, 0); rewardLabel.rotation.y = Math.PI / 2; chest.add(rewardLabel);
  let rewardText = 'MYSTERY BOX';
  // Warm practical lights against cold exterior moonlight.
  for (const [x, y, z] of [[-0.7, 2.35, -2], [5, 2.65, 2], [-0.7, 5.75, 2.5]] as const) {
    const light = new THREE.PointLight(0xffc38b, 11, 10, 1.6); light.position.set(x, y, z); group.add(light);
  }
  // Low rubble stays below the collision step height and out of navigation lanes.
  let seed = 753;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < 100; i++) {
    const x = -5.7 + random() * 4.8, z = -10.5 + random() * 15;
    const y = i % 3 === 0 ? UPPER_HEIGHT : 0;
    const rubble = box(group, i % 3 ? debris : wood, x, y + 0.045, z, 0.12 + random() * 0.3, 0.09, 0.1 + random() * 0.25);
    rubble.rotation.y = random() * Math.PI;
  }
  // A foggy treeline is visible through every opening, with no external assets.
  box(group, environmentMaterial('dirt'), 0, -0.25, 0, 160, 0.1, 160);
  const bark = new THREE.MeshStandardMaterial({ color: 0x1d2422, roughness: 1 });
  for (let i = 0; i < 55; i++) {
    const angle = random() * Math.PI * 2, radius = 27 + random() * 25;
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
    const currentBox = state.mysteryBoxes[0];
    const active = !!currentBox && currentBox.phase !== 'idle';
    lid.rotation.z = active ? 1.05 : 0;
    glow.intensity = currentBox?.phase === 'offering' ? 14 : active ? 8 : 3;
    const nextText = currentBox?.phase === 'offering' ? currentBox.lastWeapon?.toUpperCase() ?? 'WEAPON'
      : currentBox?.phase === 'rolling' ? '?  ?  ?' : 'MYSTERY BOX';
    if (rewardText !== nextText) {
      const oldMaterial = rewardLabel.material as THREE.MeshBasicMaterial;
      oldMaterial.map?.dispose(); oldMaterial.dispose(); rewardLabel.geometry.dispose();
      rewardLabel.removeFromParent();
      rewardLabel = writing(nextText, 2, 0.3, '#f6d893');
      rewardLabel.position.set(0.7, 1.8, 0); rewardLabel.rotation.y = Math.PI / 2;
      chest.add(rewardLabel); rewardText = nextText;
    }
  } };
}
