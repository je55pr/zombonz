import * as THREE from 'three';
import { walkSurfaceHeight, type WalkSurface } from '../core/collision.ts';
import { canvasTexture } from './explosiveModels.ts';
import { LightSource, type LightPool } from './lightPool.ts';

/**
 * How an explosion looks, whatever set it off. All presentation: the core decides what a blast hurts, this
 * decides what it looks like (a flash, a fireball, smoke, sparks, flying debris, a shockwave, a scorch mark,
 * a burst of light and a shake of the camera). Everything is drawn from a few instanced meshes, so a chain of
 * barrels costs a handful of draw calls however many particles it throws.
 */
export type BlastKind = 'grenade' | 'rocket' | 'mine' | 'barrel' | 'vehicle' | 'energy';

interface Look {
  /** Radius of the fireball, in metres, before the blast's own radius scales it. */
  core: number;
  fire: number; column: number; smoke: number; sparks: number; debris: number;
  /** Debris colours (hex) and biggest chunk in metres. */
  chunks: readonly number[]; chunk: number;
  /** Smoke colour fresh from the fire and once cooled, and how long it hangs about (seconds). */
  warm: number; cooled: number; hang: number;
  /** How far above the point of the blast the fire starts: a car's engine sits inside its body, and fire seen through metal is lost. */
  lift: number;
  light: number; glow: number; shake: number; scorch: number;
  /** A fire left burning where it stood, for this many seconds (0 for none), and how big. */
  embers: number;
}

const DIRT = [0x4a3d2c, 0x5c4a35, 0x6b6558, 0x3b3226, 0x77715f];
const RUST = [0x5a2f1c, 0x3f2a20, 0x2a2a2c, 0x6f4426, 0x1f1f21];
const PAINT = [0x4b5238, 0x2b2d2a, 0x565a4a, 0x1d1d1f, 0x6a4a2a];

const LOOKS: Readonly<Record<BlastKind, Look>> = {
  grenade: { core: 1.7, fire: 15, column: 0, smoke: 14, sparks: 26, debris: 14, chunks: DIRT, chunk: 0.07, warm: 0x8a6a48, cooled: 0x3c3934, hang: 3.6, lift: 0,
    light: 75, glow: 0xffa860, shake: 0.5, scorch: 1.1, embers: 0 },
  rocket: { core: 2, fire: 20, column: 0, smoke: 18, sparks: 32, debris: 18, chunks: DIRT, chunk: 0.09, warm: 0x8a6a48, cooled: 0x3c3934, hang: 4, lift: 0,
    light: 95, glow: 0xffa25a, shake: 0.7, scorch: 1.5, embers: 0 },
  mine: { core: 1.6, fire: 12, column: 0, smoke: 16, sparks: 22, debris: 30, chunks: DIRT, chunk: 0.08, warm: 0x7a6248, cooled: 0x403a32, hang: 3.8, lift: 0,
    light: 70, glow: 0xffa860, shake: 0.55, scorch: 1.3, embers: 0 },
  barrel: { core: 2.7, fire: 24, column: 16, smoke: 26, sparks: 44, debris: 16, chunks: RUST, chunk: 0.22, warm: 0x6a4022, cooled: 0x25221f, hang: 8, lift: 0.35,
    light: 120, glow: 0xff8f3a, shake: 0.95, scorch: 2, embers: 9 },
  vehicle: { core: 3.8, fire: 36, column: 30, smoke: 40, sparks: 60, debris: 24, chunks: PAINT, chunk: 0.4, warm: 0x5a3820, cooled: 0x22201d, hang: 11, lift: 1.1,
    light: 170, glow: 0xff8534, shake: 1.3, scorch: 3.2, embers: 24 },
  energy: { core: 0.9, fire: 12, column: 0, smoke: 0, sparks: 24, debris: 0, chunks: DIRT, chunk: 0.05, warm: 0x000000, cooled: 0x000000, hang: 1, lift: 0,
    light: 40, glow: 0x7dff9a, shake: 0.12, scorch: 0, embers: 0 },
};

const CELL = { fire: 0, smoke: 1, spark: 2, glow: 3 } as const;

/** Four soft sprites on one sheet: a fire puff, a smoke puff, a hard spark and a broad glow. */
function drawSheet(c: CanvasRenderingContext2D): void {
  const size = 128;
  let seed = 4711;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const lumpy = (col: number, row: number, lumps: number, spread: number, stops: ReadonlyArray<readonly [number, string]>, blend: GlobalCompositeOperation) => {
    c.save(); c.beginPath(); c.rect(col * size, row * size, size, size); c.clip();
    c.globalCompositeOperation = blend;
    for (let i = 0; i < lumps; i++) {
      const x = col * size + size / 2 + (random() - 0.5) * size * spread, y = row * size + size / 2 + (random() - 0.5) * size * spread;
      const r = size * (0.2 + random() * 0.16);
      const gradient = c.createRadialGradient(x, y, 0, x, y, r);
      for (const [at, colour] of stops) gradient.addColorStop(at, colour);
      c.fillStyle = gradient; c.fillRect(col * size, row * size, size, size);
    }
    // Fade to nothing well inside the tile, so neighbouring sprites never show at an edge.
    c.globalCompositeOperation = 'destination-in';
    const mask = c.createRadialGradient(col * size + size / 2, row * size + size / 2, size * 0.18, col * size + size / 2, row * size + size / 2, size * 0.5);
    mask.addColorStop(0, 'rgba(0,0,0,1)'); mask.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = mask; c.fillRect(col * size, row * size, size, size);
    c.restore();
  };
  // Row 0 is the top of the sheet: fire, then smoke.
  lumpy(0, 0, 7, 0.5, [[0, 'rgba(255,248,215,1)'], [0.35, 'rgba(255,190,80,0.85)'], [0.7, 'rgba(255,90,10,0.35)'], [1, 'rgba(120,20,0,0)']], 'lighter');
  lumpy(1, 0, 11, 0.62, [[0, 'rgba(255,255,255,0.55)'], [0.6, 'rgba(255,255,255,0.28)'], [1, 'rgba(255,255,255,0)']], 'source-over');
  lumpy(0, 1, 1, 0, [[0, 'rgba(255,255,255,1)'], [0.16, 'rgba(255,235,170,0.95)'], [0.5, 'rgba(255,160,60,0.25)'], [1, 'rgba(255,120,20,0)']], 'source-over');
  lumpy(1, 1, 1, 0, [[0, 'rgba(255,255,255,0.9)'], [0.3, 'rgba(255,240,200,0.45)'], [1, 'rgba(255,200,120,0)']], 'source-over');
}

/** The dark blast mark on the ground: a ragged soot disc, black in the middle and clear at the rim. */
function drawSoot(c: CanvasRenderingContext2D): void {
  const size = 128;
  let seed = 90210;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  c.clearRect(0, 0, size, size);
  for (let i = 0; i < 14; i++) {
    const x = size / 2 + (random() - 0.5) * size * 0.34, y = size / 2 + (random() - 0.5) * size * 0.34, r = size * (0.16 + random() * 0.2);
    const gradient = c.createRadialGradient(x, y, 0, x, y, r);
    gradient.addColorStop(0, 'rgba(0,0,0,0.9)'); gradient.addColorStop(0.6, 'rgba(0,0,0,0.5)'); gradient.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = gradient; c.fillRect(0, 0, size, size);
  }
  c.globalCompositeOperation = 'destination-in';
  const mask = c.createRadialGradient(size / 2, size / 2, size * 0.12, size / 2, size / 2, size * 0.5);
  mask.addColorStop(0, 'rgba(0,0,0,1)'); mask.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = mask; c.fillRect(0, 0, size, size);
}

/** A material whose instances each carry their own opacity and (optionally) sprite-sheet cell. */
function instanceMaterial(material: THREE.MeshBasicMaterial, sheet: boolean): THREE.MeshBasicMaterial {
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float instanceAlpha;\nattribute vec2 instanceCell;\nvarying float vInstanceAlpha;')
      .replace('#include <uv_vertex>', `#include <uv_vertex>\nvInstanceAlpha = instanceAlpha;${sheet ? '\n#ifdef USE_MAP\nvMapUv = vMapUv * 0.5 + instanceCell;\n#endif' : ''}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vInstanceAlpha;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.a *= vInstanceAlpha;');
  };
  material.customProgramCacheKey = () => sheet ? 'blast-sheet' : 'blast-flat';
  return material;
}

/** Instanced flat quads with a colour and opacity each, facing the camera or lying flat as asked. */
class Quads {
  readonly mesh: THREE.InstancedMesh;
  private readonly alpha: THREE.InstancedBufferAttribute;
  private readonly cell: THREE.InstancedBufferAttribute;
  private readonly colour: THREE.InstancedBufferAttribute;
  private readonly matrix = new THREE.Matrix4();
  private readonly roll = new THREE.Quaternion();
  private readonly turn = new THREE.Quaternion();
  private readonly position = new THREE.Vector3();
  private readonly size = new THREE.Vector3();
  private readonly axis = new THREE.Vector3(0, 0, 1);
  /** A quad lying face up: turned a quarter about x. */
  private static readonly flat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
  private used = 0;
  private uploaded = 0;

  constructor(readonly capacity: number, material: THREE.Material, geometry: THREE.BufferGeometry, order: number) {
    this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
    this.alpha = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
    this.cell = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 2), 2);
    this.colour = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.alpha.setUsage(THREE.DynamicDrawUsage); this.cell.setUsage(THREE.DynamicDrawUsage); this.colour.setUsage(THREE.DynamicDrawUsage);
    this.mesh.geometry = geometry.clone();
    this.mesh.geometry.setAttribute('instanceAlpha', this.alpha);
    this.mesh.geometry.setAttribute('instanceCell', this.cell);
    this.mesh.instanceColor = this.colour;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = order; this.mesh.count = 0;
  }

  begin(): void { this.used = 0; }

  /** Adds a quad facing `facing` (a camera's rotation) turned by `spin`, or flat on the ground when `facing` is null. */
  add(x: number, y: number, z: number, size: number, spin: number, r: number, g: number, b: number, alpha: number, frame: number,
    facing: THREE.Quaternion | null): void {
    if (this.used >= this.capacity || alpha <= 0.002 || size <= 0) return;
    const i = this.used++;
    this.roll.setFromAxisAngle(this.axis, spin);
    this.turn.copy(facing ?? Quads.flat).multiply(this.roll);
    this.matrix.compose(this.position.set(x, y, z), this.turn, this.size.set(size, size, 1));
    this.mesh.setMatrixAt(i, this.matrix);
    this.colour.setXYZ(i, r, g, b);
    this.alpha.setX(i, alpha);
    this.cell.setXY(i, (frame % 2) * 0.5, (1 - Math.floor(frame / 2)) * 0.5);
  }

  end(): void {
    // Nothing drawn, and nothing left over from last time: there is nothing to send to the graphics card.
    if (this.used === 0 && this.uploaded === 0) { this.mesh.count = 0; return; }
    this.uploaded = this.used;
    this.mesh.count = this.used;
    this.mesh.instanceMatrix.needsUpdate = true; this.alpha.needsUpdate = true; this.cell.needsUpdate = true; this.colour.needsUpdate = true;
  }
}

interface Puff {
  x: number; y: number; z: number; vx: number; vy: number; vz: number;
  age: number; life: number; from: number; to: number;
  /** Speed lost per second, and the lift (or fall) added per second. */
  drag: number; lift: number;
  spin: number; turn: number;
  /** Colour at birth and at the end, and the opacity at its strongest. */
  c0: THREE.Color; c1: THREE.Color; alpha: number; cell: number;
}

interface Chunk {
  x: number; y: number; z: number; vx: number; vy: number; vz: number;
  rx: number; ry: number; rz: number; sx: number; sy: number; sz: number; age: number; life: number; landed: boolean;
  colour: number;
}

interface Mark { x: number; y: number; z: number; radius: number; age: number; life: number }

interface Flame {
  x: number; y: number; z: number; radius: number; strength: number;
  /** How much of it is flame rather than smoke (1 is a full blaze, 0 only smoulders). */
  fire: number;
  seen: number; carryFire: number; carrySmoke: number; carrySpark: number;
}

const MAX_FIRE = 320, MAX_SMOKE = 300, MAX_CHUNKS = 110, MAX_MARKS = 14, MAX_RINGS = 6, LIGHTS = 3;
const SCORCH_SECONDS = 70;
/** How far from a blast the camera shakes at all, in metres. */
const SHAKE_REACH = 26;

function seeded(seed: number): () => number {
  let state = (seed >>> 0) || 1;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
}

/** The floor's height at a point, for a walker at height `y`: the highest surface not far above them, else the ground. */
export function groundFromSurfaces(surfaces: readonly WalkSurface[]): (x: number, z: number, y: number) => number {
  return (x, z, y) => {
    let best = Number.NEGATIVE_INFINITY;
    for (const surface of surfaces) {
      const height = walkSurfaceHeight(surface, x, z);
      if (height !== undefined && height <= y + 0.45 && height > best) best = height;
    }
    return Number.isFinite(best) ? best : 0;
  };
}

export interface BlastEffectsOptions {
  /** The floor's height at a point (given a height to stand at), for landing debris and laying scorch marks. */
  ground: (x: number, z: number, y: number) => number;
  lights?: LightPool;
}

export class BlastEffects {
  readonly root = new THREE.Group();
  private readonly fire: Quads;
  private readonly smoke: Quads;
  private readonly marks: Quads;
  private readonly rings: Quads;
  private readonly chunkMesh: THREE.InstancedMesh;
  private fireballs: Puff[] = [];
  private clouds: Puff[] = [];
  private chunks: Chunk[] = [];
  private scorch: Mark[] = [];
  private shockwaves: Mark[] = [];
  private readonly flames = new Map<string, Flame>();
  private readonly flashes: Array<{ source: LightSource; age: number; life: number; peak: number }> = [];
  private readonly flameLights: LightSource[] = [];
  private frame = 0;
  /** Whether anything may be alive: with nothing, a frame costs nothing (and uploads nothing). */
  private active = false;
  private lastDt = 1 / 60;
  private shakeEnergy = 0;
  private shakeClock = 0;
  private readonly matrix = new THREE.Matrix4();
  private readonly rotation = new THREE.Quaternion();
  private readonly euler = new THREE.Euler();
  private readonly scale = new THREE.Vector3();
  private readonly point = new THREE.Vector3();
  private readonly tint = new THREE.Color();
  private readonly options: BlastEffectsOptions;

  constructor(scene: THREE.Scene, options: BlastEffectsOptions) {
    this.options = options;
    this.root.name = 'blast-effects';
    const sheet = canvasTexture(256, 256, drawSheet);
    if (sheet) { sheet.generateMipmaps = false; sheet.minFilter = THREE.LinearFilter; sheet.wrapS = sheet.wrapT = THREE.ClampToEdgeWrapping; }
    const soot = canvasTexture(128, 128, drawSoot);
    const plane = new THREE.PlaneGeometry(1, 1);
    const smokeMaterial = instanceMaterial(new THREE.MeshBasicMaterial({ map: sheet, transparent: true, depthWrite: false }), true);
    const fireMaterial = instanceMaterial(new THREE.MeshBasicMaterial({ map: sheet, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, fog: false }), true);
    const markMaterial = instanceMaterial(new THREE.MeshBasicMaterial({ map: soot, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }), false);
    const ringMaterial = instanceMaterial(new THREE.MeshBasicMaterial({ map: sheet, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, fog: false, side: THREE.DoubleSide }), true);
    this.marks = new Quads(MAX_MARKS, markMaterial, plane, 4);
    this.smoke = new Quads(MAX_SMOKE, smokeMaterial, plane, 10);
    this.fire = new Quads(MAX_FIRE, fireMaterial, plane, 11);
    this.rings = new Quads(MAX_RINGS, ringMaterial, plane, 12);
    this.chunkMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.25 }), MAX_CHUNKS);
    this.chunkMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_CHUNKS * 3), 3);
    this.chunkMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.chunkMesh.frustumCulled = false; this.chunkMesh.count = 0; this.chunkMesh.castShadow = false;
    this.root.add(this.marks.mesh, this.smoke.mesh, this.fire.mesh, this.rings.mesh, this.chunkMesh);
    scene.add(this.root);
    if (options.lights) {
      for (let i = 0; i < LIGHTS; i++) {
        const source = options.lights.add(new LightSource(0xffa050, 0, 22, 1.6));
        source.priority = 30; this.root.add(source);
        this.flashes.push({ source, age: 1, life: 1, peak: 0 });
      }
      for (let i = 0; i < 2; i++) {
        const source = options.lights.add(new LightSource(0xff8a30, 0, 12, 1.8));
        source.priority = 12; this.root.add(source); this.flameLights.push(source);
      }
    }
  }

  private puff(seed: () => number, p: Partial<Puff> & { x: number; y: number; z: number; life: number; from: number; to: number; cell: number; alpha: number },
    into: Puff[], limit: number, c0: THREE.ColorRepresentation, c1: THREE.ColorRepresentation): void {
    if (into.length >= limit) return;
    into.push({ vx: 0, vy: 0, vz: 0, age: 0, drag: 0, lift: 0, spin: seed() * Math.PI * 2, turn: (seed() - 0.5) * 1.6,
      ...p, c0: new THREE.Color(c0), c1: new THREE.Color(c1) });
  }

  /** A burst in every direction from `at`: `speed` metres a second at most, some of it upward. */
  private spray(seed: () => number, speed: number, up: number): { vx: number; vy: number; vz: number } {
    const theta = seed() * Math.PI * 2, elevation = (seed() * 1.2 - 0.25);
    const flat = Math.sqrt(Math.max(0, 1 - Math.min(1, elevation * elevation)));
    const s = speed * (0.35 + seed() * 0.65);
    return { vx: Math.cos(theta) * flat * s, vy: elevation * s + up * (0.4 + seed() * 0.6), vz: Math.sin(theta) * flat * s };
  }

  /** An explosion at `position`, `radius` being the blast's own reach in metres. `seed` varies its look. */
  detonate(kind: BlastKind, position: { x: number; y: number; z: number }, radius: number, seed = 1): void {
    this.active = true;
    const look = LOOKS[kind], random = seeded(seed ^ Math.imul(Math.round(position.x * 37) ^ Math.round(position.z * 91), 0x9e3779b1));
    const size = look.core * Math.max(0.7, radius / 4.5);
    const { x, z } = position;
    const ground = this.options.ground(x, z, position.y);
    const y = position.y + look.lift;
    const low = position.y - ground < 2.2;
    const glow = new THREE.Color(look.glow);
    // The flash: a hard white core and a wide warm glow, over in a tenth of a second.
    this.puff(random, { x, y, z, life: 0.09, from: size * 0.9, to: size * 1.4, cell: CELL.spark, alpha: 0.85, drag: 0 }, this.fireballs, MAX_FIRE, 0xffffff, 0xfff0c0);
    this.puff(random, { x, y, z, life: 0.16, from: size * 1.8, to: size * 2.7, cell: CELL.glow, alpha: 0.5, drag: 0 }, this.fireballs, MAX_FIRE, glow, glow);
    // The fireball: puffs thrown outward that slow quickly, cooling from white-yellow through orange to red.
    const hot = kind === 'energy' ? [0xd8ffe0, 0x4dff7a, 0x0a5a20] as const : [0xfff3c8, 0xff9a2a, 0x7a1806] as const;
    for (let i = 0; i < look.fire; i++) {
      const v = this.spray(random, size * 3.2, size * 0.9);
      this.puff(random, { x: x + (random() - 0.5) * size * 0.3, y: y + (random() - 0.2) * size * 0.25, z: z + (random() - 0.5) * size * 0.3,
        ...v, life: 0.35 + random() * 0.45, from: size * (0.4 + random() * 0.3), to: size * (0.9 + random() * 0.6), drag: 3.6, lift: size * 0.8,
        cell: CELL.fire, alpha: 0.8 }, this.fireballs, MAX_FIRE, hot[0], hot[2]);
    }
    // A column of flame climbing after it, for fuel: barrels and vehicles.
    for (let i = 0; i < look.column; i++) {
      const rise = 3.5 + random() * 5.5 * (size / 2.3);
      this.puff(random, { x: x + (random() - 0.5) * size * 0.5, y: y + random() * size * 0.3, z: z + (random() - 0.5) * size * 0.5,
        vx: (random() - 0.5) * 1.6, vy: rise, vz: (random() - 0.5) * 1.6, life: 0.7 + random() * 0.9, from: size * 0.5, to: size * 1.1,
        drag: 1.1, lift: 0, cell: CELL.fire, alpha: 0.85 }, this.fireballs, MAX_FIRE, hot[1], hot[2]);
    }
    // Smoke: warm at first, lit by the fire, then cooling to the colour of what burned.
    const cooled = new THREE.Color(look.cooled);
    for (let i = 0; i < look.smoke; i++) {
      const v = this.spray(random, size * 1.1, 2.6);
      this.puff(random, { x: x + (random() - 0.5) * size * 0.7, y: y + random() * size * 0.4, z: z + (random() - 0.5) * size * 0.7,
        ...v, life: look.hang * (0.55 + random() * 0.6), from: size * (0.28 + random() * 0.2), to: size * (0.75 + random() * 0.45), drag: 1.6, lift: 0.9,
        cell: CELL.smoke, alpha: 0.4 + random() * 0.2 }, this.clouds, MAX_SMOKE, look.warm, cooled);
    }
    // Sparks and embers: fast, thin and short-lived, falling in arcs.
    for (let i = 0; i < look.sparks; i++) {
      const v = this.spray(random, 9 + size * 2, 4);
      this.puff(random, { x, y, z, ...v, life: 0.5 + random() * 0.8, from: 0.09, to: 0.03, drag: 0.5, lift: -9, cell: CELL.spark, alpha: 1 },
        this.fireballs, MAX_FIRE, kind === 'energy' ? 0xc8ffd6 : 0xffd27a, kind === 'energy' ? 0x1ec850 : 0xff4a08);
    }
    // Debris: chunks of whatever was there, thrown out and left where they land.
    for (let i = 0; i < look.debris && this.chunks.length < MAX_CHUNKS; i++) {
      const v = this.spray(random, 6 + size * 2.4, 5 + size);
      const big = look.chunk * (0.25 + random() * 0.75);
      this.chunks.push({ x: x + (random() - 0.5) * 0.4, y: Math.max(ground + 0.1, y - size * 0.15), z: z + (random() - 0.5) * 0.4, ...{ vx: v.vx, vy: v.vy, vz: v.vz },
        rx: random() * 6, ry: random() * 6, rz: random() * 6, sx: big * (0.6 + random() * 0.8), sy: big * (0.4 + random() * 0.7), sz: big * (0.6 + random() * 0.8),
        age: 0, life: 4 + random() * 4, landed: false, colour: look.chunks[Math.floor(random() * look.chunks.length)] });
    }
    if (low) {
      this.shockwaves.push({ x, y: ground + 0.06, z, radius: radius * 1.05, age: 0, life: 0.42 });
      if (this.shockwaves.length > MAX_RINGS) this.shockwaves.shift();
      if (look.scorch > 0) {
        this.scorch.push({ x, y: ground + 0.02, z, radius: look.scorch * (0.8 + random() * 0.4), age: 0, life: SCORCH_SECONDS });
        if (this.scorch.length > MAX_MARKS) this.scorch.shift();
      }
    }
    if (look.embers > 0) this.burn(`embers:${seed}:${x.toFixed(1)}:${z.toFixed(1)}`, { x, y: ground + (kind === 'vehicle' ? 0.9 : 0.1), z },
      kind === 'vehicle' ? 1.0 : 0.4, 0.7, look.embers);
    // Light and shake.
    const flash = this.flashes.reduce((oldest, entry) => entry.age / entry.life > oldest.age / oldest.life ? entry : oldest, this.flashes[0]);
    if (flash) {
      flash.source.position.set(x, y + 0.6, z); flash.source.color.setHex(look.glow); flash.age = 0;
      flash.life = 0.35 + size * 0.14; flash.peak = look.light;
    }
    this.shakeAt(position, look.shake);
  }

  /**
   * Something burning: call every frame while it burns with the flames' `strength` (0 to 1) and `radius`; it
   * throws fire and smoke up from `position`; `fire` below 1 leaves it mostly smoke. A `seconds` above 0 keeps it going
   * that long without more calls.
   */
  burn(key: string, position: { x: number; y: number; z: number }, radius: number, strength: number, seconds = 0, fire = 1): void {
    this.active = true;
    const flame = this.flames.get(key) ?? { x: 0, y: 0, z: 0, radius, strength, fire, seen: 0, carryFire: 0, carrySmoke: 0, carrySpark: 0 };
    flame.x = position.x; flame.y = position.y; flame.z = position.z; flame.radius = radius; flame.strength = strength; flame.fire = fire;
    // update() moves the frame on before it looks, so a flame told to burn this frame is still there when it does.
    flame.seen = this.frame + 1 + (seconds > 0 ? Math.round(seconds * 60) : 0);
    this.flames.set(key, flame);
  }

  /** Stops a burning thing at once, as when a barrel that was smouldering goes off. */
  extinguish(key: string): void { this.flames.delete(key); }

  /** A small trail from a grenade's fuse: sparks and a wisp, for as long as it is called. */
  fuse(key: string, position: { x: number; y: number; z: number }, seed: number): void {
    this.burn(`fuse:${key}`, position, 0.06, 0.35);
    void seed;
  }

  /** A spark and a puff where a bullet struck metal. */
  strike(position: { x: number; y: number; z: number }, seed: number): void {
    this.active = true;
    const random = seeded(seed);
    for (let i = 0; i < 7; i++) {
      const v = this.spray(random, 4, 1.2);
      this.puff(random, { ...position, ...v, life: 0.25 + random() * 0.3, from: 0.05, to: 0.02, drag: 1, lift: -9, cell: CELL.spark, alpha: 1 },
        this.fireballs, MAX_FIRE, 0xfff0b0, 0xff6a10);
    }
  }

  private shakeAt(position: { x: number; z: number; y: number }, strength: number): void {
    const camera = this.lastCamera;
    if (!camera) return;
    const distance = Math.hypot(position.x - camera.x, position.y - camera.y, position.z - camera.z);
    if (distance > SHAKE_REACH) return;
    const near = 1 - distance / SHAKE_REACH;
    this.shakeEnergy = Math.min(1.6, this.shakeEnergy + strength * near * near);
  }
  private lastCamera: THREE.Vector3 | null = null;

  /** The rotation (radians) to add to the camera this frame: a rumble that dies away after a blast. */
  shake(): { x: number; y: number; z: number } {
    const e = this.shakeEnergy * 0.018, t = this.shakeClock;
    return { x: Math.sin(t * 47) * e, y: Math.sin(t * 39 + 1.3) * e, z: Math.sin(t * 31 + 2.1) * e * 0.8 };
  }

  /** Drops everything: a new match starts. */
  clear(): void {
    this.fireballs = []; this.clouds = []; this.chunks = []; this.scorch = []; this.shockwaves = [];
    this.flames.clear(); this.shakeEnergy = 0;
    for (const flash of this.flashes) { flash.age = flash.life; flash.source.intensity = 0; }
    for (const light of this.flameLights) light.intensity = 0;
  }

  /** How many things are alive, for tests and the performance overlay. */
  get counts(): { fire: number; smoke: number; debris: number; scorch: number; flames: number } {
    return { fire: this.fireballs.length, smoke: this.clouds.length, debris: this.chunks.length, scorch: this.scorch.length, flames: this.flames.size };
  }

  private advance(list: Puff[], dt: number): void {
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i];
      p.age += dt;
      if (p.age >= p.life) { list[i] = list[list.length - 1]; list.pop(); continue; }
      const keep = Math.exp(-p.drag * dt);
      p.vx *= keep; p.vy = p.vy * keep + p.lift * dt; p.vz *= keep;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.spin += p.turn * dt;
    }
  }

  private draw(list: Puff[], quads: Quads, facing: THREE.Quaternion, order?: THREE.Vector3): void {
    if (order) list.sort((a, b) => order.distanceToSquared(this.point.set(b.x, b.y, b.z)) - order.distanceToSquared(this.point.set(a.x, a.y, a.z)));
    for (const p of list) {
      const t = p.age / p.life;
      const size = p.from + (p.to - p.from) * (1 - (1 - t) * (1 - t));
      // In fast, out slowly.
      const alpha = p.alpha * Math.min(1, t / 0.08) * Math.pow(1 - t, p.cell === CELL.smoke ? 1.15 : 1.5);
      this.tint.copy(p.c0).lerp(p.c1, Math.min(1, t * (p.cell === CELL.smoke ? 2.6 : 1.6)));
      quads.add(p.x, p.y, p.z, size, p.spin, this.tint.r, this.tint.g, this.tint.b, alpha, p.cell, facing);
    }
  }

  /** Advances everything by `dt` seconds and draws it from `camera`. */
  update(dt: number, camera: THREE.Camera): void {
    camera.getWorldPosition(this.point); this.lastCamera = (this.lastCamera ?? new THREE.Vector3()).copy(this.point);
    if (!this.active) return;
    dt = Math.min(0.05, Math.max(0, dt));
    this.frame += 1; this.lastDt = dt; this.shakeClock += dt;
    const eye = this.lastCamera;
    this.shakeEnergy *= Math.exp(-4.2 * dt);

    // Flames: throw fire, smoke and the odd spark up from each, and let the nearest two light the place.
    let lit = 0;
    for (const [key, flame] of this.flames) {
      if (flame.seen < this.frame) { this.flames.delete(key); continue; }
      const random = seeded(this.frame * 7919 + key.length * 131 + Math.round(flame.x * 13));
      flame.carryFire += dt * 34 * flame.strength * flame.fire * (0.5 + flame.radius);
      flame.carrySmoke += dt * 9 * flame.strength * (0.5 + flame.radius);
      flame.carrySpark += dt * 6 * flame.strength * flame.fire;
      while (flame.carryFire >= 1) {
        flame.carryFire -= 1;
        const r = flame.radius;
        this.puff(random, { x: flame.x + (random() - 0.5) * r * 1.4, y: flame.y + random() * 0.2, z: flame.z + (random() - 0.5) * r * 1.4,
          vx: (random() - 0.5) * 0.4, vy: 1.4 + random() * 1.6 * (0.5 + flame.strength), vz: (random() - 0.5) * 0.4,
          life: 0.32 + random() * 0.4, from: r * (0.55 + random() * 0.4), to: r * 0.2, drag: 0.4, lift: 0.8, cell: CELL.fire, alpha: 0.8 },
        this.fireballs, MAX_FIRE, 0xffe6a0, 0xc23a08);
      }
      while (flame.carrySmoke >= 1) {
        flame.carrySmoke -= 1;
        const r = flame.radius;
        this.puff(random, { x: flame.x + (random() - 0.5) * r, y: flame.y + 0.5 + random() * 0.4, z: flame.z + (random() - 0.5) * r,
          vx: (random() - 0.5) * 0.5 + 0.25, vy: 1.6 + random() * 1.2, vz: (random() - 0.5) * 0.5, life: 2 + random() * 1.8, from: r * 0.7, to: r * 2.8,
          drag: 0.5, lift: 0.3, cell: CELL.smoke, alpha: 0.3 + random() * 0.15 }, this.clouds, MAX_SMOKE, 0x3a2c22, 0x0e0d0c);
      }
      while (flame.carrySpark >= 1) {
        flame.carrySpark -= 1;
        this.puff(random, { x: flame.x, y: flame.y + 0.3, z: flame.z, vx: (random() - 0.5) * 2, vy: 2 + random() * 3, vz: (random() - 0.5) * 2, life: 0.5 + random() * 0.6,
          from: 0.05, to: 0.02, drag: 0.6, lift: -6, cell: CELL.spark, alpha: 1 }, this.fireballs, MAX_FIRE, 0xffd27a, 0xff4a08);
      }
      // A flickering glow from the nearest fires (the pool has only a couple of real lights for them).
      if (lit < this.flameLights.length && flame.radius > 0.1 && flame.fire > 0.2 && eye.distanceTo(this.point.set(flame.x, flame.y, flame.z)) < 30) {
        const light = this.flameLights[lit++];
        light.position.set(flame.x, flame.y + 0.8, flame.z);
        light.intensity = (7 + 9 * flame.radius) * flame.strength * (0.75 + 0.25 * Math.sin(this.shakeClock * 23 + flame.x) * Math.sin(this.shakeClock * 17));
      }
    }
    for (let i = lit; i < this.flameLights.length; i++) this.flameLights[i].intensity = 0;

    this.advance(this.fireballs, dt); this.advance(this.clouds, dt);
    const facing = this.rotation.copy(camera.quaternion);
    this.smoke.begin(); this.fire.begin();
    this.draw(this.clouds, this.smoke, facing, eye);
    this.draw(this.fireballs, this.fire, facing);
    this.smoke.end(); this.fire.end();

    // Debris: ballistic, landing on the floor, then shrinking away.
    let visible = 0;
    for (let i = this.chunks.length - 1; i >= 0; i--) {
      const c = this.chunks[i];
      c.age += dt;
      if (c.age >= c.life) { this.chunks.splice(i, 1); continue; }
      if (!c.landed) {
        c.vy -= 9.8 * dt; c.x += c.vx * dt; c.y += c.vy * dt; c.z += c.vz * dt;
        c.rx += dt * (c.vx * 2 + 3); c.ry += dt * (c.vz * 2 + 2); c.rz += dt * 3;
        const floor = this.options.ground(c.x, c.z, c.y + 0.5) + Math.max(c.sy, 0.02) / 2;
        if (c.y <= floor) {
          c.y = floor;
          if (Math.abs(c.vy) > 1.6) { c.vy *= -0.32; c.vx *= 0.6; c.vz *= 0.6; } else { c.landed = true; c.vx = c.vy = c.vz = 0; }
        }
      }
    }
    this.chunks.forEach((c, index) => {
      const shrink = Math.min(1, (c.life - c.age) / 0.8);
      this.euler.set(c.rx, c.ry, c.rz); this.rotation.setFromEuler(this.euler);
      this.matrix.compose(this.point.set(c.x, c.y, c.z), this.rotation, this.scale.set(c.sx * shrink, c.sy * shrink, c.sz * shrink));
      this.chunkMesh.setMatrixAt(index, this.matrix); this.chunkMesh.setColorAt(index, this.tint.setHex(c.colour)); visible = index + 1;
    });
    this.chunkMesh.count = visible; this.chunkMesh.instanceMatrix.needsUpdate = true;
    if (this.chunkMesh.instanceColor) this.chunkMesh.instanceColor.needsUpdate = true;

    // Scorch marks lie flat and fade over a minute; shockwaves are a ring racing out along the ground.
    this.marks.begin();
    for (let i = this.scorch.length - 1; i >= 0; i--) {
      const m = this.scorch[i];
      m.age += dt;
      if (m.age >= m.life) { this.scorch.splice(i, 1); continue; }
      const alpha = 0.72 * Math.min(1, m.age / 0.3) * Math.min(1, (m.life - m.age) / 12);
      this.marks.add(m.x, m.y, m.z, m.radius * 2, 0, 0, 0, 0, alpha, 0, null);
    }
    this.marks.end();
    this.rings.begin();
    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const w = this.shockwaves[i];
      w.age += dt;
      if (w.age >= w.life) { this.shockwaves.splice(i, 1); continue; }
      const t = w.age / w.life;
      this.rings.add(w.x, w.y, w.z, w.radius * 2 * (0.15 + 0.85 * (1 - (1 - t) * (1 - t))), 0, 1, 0.82, 0.55, 0.5 * (1 - t) * (1 - t), CELL.glow, null);
    }
    this.rings.end();

    let flashing = false;
    for (const flash of this.flashes) {
      flash.age += dt;
      const t = Math.min(1, flash.age / flash.life);
      flash.source.intensity = t >= 1 ? 0 : flash.peak * Math.pow(1 - t, 2.2);
      if (t < 1) flashing = true;
    }
    this.active = flashing || this.flames.size > 0 || this.shakeEnergy > 0.0005 || this.fireballs.length + this.clouds.length
      + this.chunks.length + this.scorch.length + this.shockwaves.length > 0;
  }
}
