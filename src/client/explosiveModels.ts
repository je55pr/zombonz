import * as THREE from 'three';

/**
 * Hand-built models of the game's explosives, so they need no downloaded assets: the Mk 2 "pineapple"
 * frag grenade and the Bouncing Betty (a German S-mine). Sizes are a little over life so they read on screen.
 */

/** A canvas-drawn texture, or null where there is no canvas (tests, servers). */
export function canvasTexture(width: number, height: number, draw: (context: CanvasRenderingContext2D) => void,
  colour = true): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return null;
  draw(context);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  if (colour) texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** The pineapple's cast-in grid of notches: one diamond per tile, painted olive with the notches dark. */
function grooveTile(context: CanvasRenderingContext2D, base: string, groove: string, size: number): void {
  context.fillStyle = base; context.fillRect(0, 0, size, size);
  context.strokeStyle = groove; context.lineWidth = size / 9; context.lineCap = 'square';
  for (const offset of [-size, 0, size]) {
    context.beginPath(); context.moveTo(offset, 0); context.lineTo(offset + size, size); context.stroke();
    context.beginPath(); context.moveTo(offset + size, 0); context.lineTo(offset, size); context.stroke();
  }
}

interface GrenadeParts {
  body: THREE.BufferGeometry; neck: THREE.BufferGeometry; spoon: THREE.BufferGeometry; ring: THREE.BufferGeometry;
  pinStem: THREE.BufferGeometry;
  paint: THREE.MeshStandardMaterial; steel: THREE.MeshStandardMaterial;
}
let grenadeParts: GrenadeParts | null = null;

/** Height of the grenade's body in metres (the neck and lever add a little more). */
export const GRENADE_HEIGHT = 0.13;

function grenadeResources(): GrenadeParts {
  if (grenadeParts) return grenadeParts;
  // The pineapple's egg-shaped profile, bottom to top: (radius, height) about the centre of the body.
  const profile = [[0, -0.066], [0.024, -0.063], [0.036, -0.046], [0.041, -0.018], [0.04, 0.012], [0.034, 0.038], [0.023, 0.056],
    [0.014, 0.064]].map(([radius, y]) => new THREE.Vector2(radius, y));
  const colour = canvasTexture(64, 64, context => grooveTile(context, '#56603a', '#2b3320', 64));
  const bump = canvasTexture(64, 64, context => grooveTile(context, '#d8d8d8', '#303030', 64), false);
  for (const texture of [colour, bump]) texture?.repeat.set(12, 5);
  grenadeParts = {
    body: new THREE.LatheGeometry(profile, 20),
    neck: new THREE.CylinderGeometry(0.0125, 0.016, 0.02, 12),
    // The lever (spoon) bends over the neck and runs down the body's side.
    spoon: (() => {
      const shape = new THREE.BoxGeometry(0.016, 0.092, 0.0035); shape.translate(0.0, -0.046, 0); return shape;
    })(),
    ring: new THREE.TorusGeometry(0.0125, 0.0026, 6, 16),
    pinStem: new THREE.CylinderGeometry(0.0022, 0.0022, 0.034, 6),
    paint: new THREE.MeshStandardMaterial({ color: colour ? 0xffffff : 0x56603a, map: colour, bumpMap: bump, bumpScale: 1.6,
      roughness: 0.62, metalness: 0.35 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x8d8f88, roughness: 0.4, metalness: 0.85 }),
  };
  return grenadeParts;
}

/**
 * A Mk 2 grenade, upright and centred on its body. `armed: false` (the default) is the one in the hand:
 * pin in and lever held down. A thrown one has lost both (the lever flies off as it leaves the hand).
 * `fuse` is the neck's material, which glows for the last moments of the fuse.
 */
export function createGrenadeModel(options: { pinned?: boolean } = {}): { root: THREE.Group; fuse: THREE.MeshStandardMaterial } {
  const parts = grenadeResources();
  const root = new THREE.Group(); root.name = 'grenade';
  const fuse = parts.steel.clone();
  fuse.emissive = new THREE.Color(0xff3a10); fuse.emissiveIntensity = 0;
  root.add(new THREE.Mesh(parts.body, parts.paint));
  const neck = new THREE.Mesh(parts.neck, fuse); neck.position.y = 0.074; root.add(neck);
  if (options.pinned) {
    // The lever hangs from the top of the neck and lies along the body, held down by the pin.
    const spoon = new THREE.Mesh(parts.spoon, parts.steel); spoon.position.set(0.018, 0.079, 0); spoon.rotation.z = 0.26; root.add(spoon);
    const stem = new THREE.Mesh(parts.pinStem, parts.steel); stem.rotation.x = Math.PI / 2; stem.position.set(0, 0.076, 0.018); root.add(stem);
    const ring = new THREE.Mesh(parts.ring, parts.steel); ring.position.set(0, 0.076, 0.045); root.add(ring);
  }
  return { root, fuse };
}

export type MinePose = 'arming' | 'armed' | 'popping';

interface MineParts {
  tube: THREE.BufferGeometry; canister: THREE.BufferGeometry; shoulder: THREE.BufferGeometry; rib: THREE.BufferGeometry;
  well: THREE.BufferGeometry; prong: THREE.BufferGeometry; tip: THREE.BufferGeometry; lamp: THREE.BufferGeometry;
  paint: THREE.MeshStandardMaterial; dark: THREE.MeshStandardMaterial; steel: THREE.MeshStandardMaterial;
}
let mineParts: MineParts | null = null;

/** How far a Betty's canister is above its tube when it sits armed, and its overall size in metres. */
export const MINE_CANISTER_HEIGHT = 0.19;
export const MINE_RADIUS = 0.06;

function mineResources(): MineParts {
  if (mineParts) return mineParts;
  const paintTexture = canvasTexture(128, 128, context => {
    context.fillStyle = '#565b41'; context.fillRect(0, 0, 128, 128);
    // Weathered olive paint: fine dark speckle, a few rust flecks and streaks running down from the seams.
    let seed = 91;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    for (let i = 0; i < 40; i++) {
      context.fillStyle = 'rgba(70,52,30,0.16)'; context.fillRect(random() * 128, random() * 60, 1 + random() * 2, 20 + random() * 60);
    }
    for (let i = 0; i < 420; i++) {
      context.fillStyle = random() < 0.7 ? 'rgba(38,34,24,0.28)' : 'rgba(128,74,34,0.28)';
      context.beginPath(); context.arc(random() * 128, random() * 128, 0.5 + random() * 1.3, 0, Math.PI * 2); context.fill();
    }
  });
  mineParts = {
    tube: new THREE.CylinderGeometry(MINE_RADIUS + 0.012, MINE_RADIUS + 0.016, 0.07, 20, 1, true),
    canister: new THREE.CylinderGeometry(MINE_RADIUS, MINE_RADIUS, MINE_CANISTER_HEIGHT - 0.03, 20),
    shoulder: new THREE.CylinderGeometry(0.042, MINE_RADIUS, 0.03, 20),
    rib: new THREE.TorusGeometry(MINE_RADIUS + 0.001, 0.004, 6, 24),
    well: new THREE.CylinderGeometry(0.026, 0.03, 0.024, 14),
    prong: new THREE.CylinderGeometry(0.004, 0.006, 0.05, 6),
    tip: new THREE.SphereGeometry(0.0075, 8, 6),
    lamp: new THREE.SphereGeometry(0.009, 8, 6),
    paint: new THREE.MeshStandardMaterial({ color: paintTexture ? 0xffffff : 0x5a5f44, map: paintTexture, roughness: 0.75, metalness: 0.3 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x2d2a21, roughness: 0.9, metalness: 0.4, side: THREE.DoubleSide }),
    steel: new THREE.MeshStandardMaterial({ color: 0x77776f, roughness: 0.5, metalness: 0.8 }),
  };
  return mineParts;
}

export interface MineModel {
  root: THREE.Group;
  /** The part that jumps: the canister, its fuse well and the three prongs. */
  canister: THREE.Group;
  lamp: THREE.Mesh;
  lampMaterial: THREE.MeshBasicMaterial;
}

/**
 * A Bouncing Betty as it lies half-buried: an outer tube in the ground and the canister sitting in it, with three
 * trigger prongs on top and a small lamp beside them. The origin is on the ground, under the canister.
 */
export function createMineModel(): MineModel {
  const parts = mineResources();
  const root = new THREE.Group(); root.name = 'bouncing-betty';
  const tube = new THREE.Mesh(parts.tube, parts.dark); tube.position.y = 0.035; root.add(tube);
  const canister = new THREE.Group(); canister.position.y = 0.04; root.add(canister);
  const body = new THREE.Mesh(parts.canister, parts.paint); body.position.y = (MINE_CANISTER_HEIGHT - 0.03) / 2; canister.add(body);
  for (const y of [0.035, 0.09, 0.14]) {
    const rib = new THREE.Mesh(parts.rib, parts.dark); rib.rotation.x = Math.PI / 2; rib.position.y = y; canister.add(rib);
  }
  const shoulder = new THREE.Mesh(parts.shoulder, parts.paint); shoulder.position.y = MINE_CANISTER_HEIGHT - 0.045; canister.add(shoulder);
  const well = new THREE.Mesh(parts.well, parts.steel); well.position.y = MINE_CANISTER_HEIGHT - 0.018; canister.add(well);
  for (let i = 0; i < 3; i++) {
    const angle = i * Math.PI * 2 / 3 + Math.PI / 6;
    const prong = new THREE.Group();
    const stalk = new THREE.Mesh(parts.prong, parts.steel); stalk.position.y = 0.025; prong.add(stalk);
    const tip = new THREE.Mesh(parts.tip, parts.steel); tip.position.y = 0.052; prong.add(tip);
    prong.position.set(Math.cos(angle) * 0.015, MINE_CANISTER_HEIGHT - 0.008, Math.sin(angle) * 0.015);
    // Leaning a little outward, as the real ones do.
    prong.rotation.set(Math.sin(angle) * 0.22, 0, -Math.cos(angle) * 0.22);
    canister.add(prong);
  }
  const lampMaterial = new THREE.MeshBasicMaterial({ color: 0x000000 });
  const lamp = new THREE.Mesh(parts.lamp, lampMaterial); lamp.position.set(0.034, MINE_CANISTER_HEIGHT - 0.03, 0); canister.add(lamp);
  return { root, canister, lamp, lampMaterial };
}

/** Where along its 0..1 jump the canister is `progress` of the way through: fast off the ground, slowing at the top. */
export function mineRise(progress: number): number {
  const p = Math.max(0, Math.min(1, progress));
  return 1 - (1 - p) * (1 - p) * (1 - p);
}

/**
 * Poses a mine for the moment. Arming, its lamp blinks amber; armed, it glows a steady red (dim, so it can be
 * missed at a glance); once sprung, the canister leaps `rise` metres and spins as it goes.
 */
export function poseMine(model: MineModel, phase: MinePose, progress: number, seconds: number, rise: number): void {
  const jump = phase === 'popping' ? mineRise(progress) : 0;
  model.canister.position.y = 0.04 + jump * rise;
  model.canister.rotation.y = jump * Math.PI * 3;
  if (phase === 'arming') model.lampMaterial.color.setHex(Math.sin(seconds * 12) > 0 ? 0xffa030 : 0x2a1a08);
  else if (phase === 'armed') model.lampMaterial.color.setHex(0x8a1410);
  else model.lampMaterial.color.setHex(0xff3018);
}
