import * as THREE from 'three';
import type { Vec3 } from '../core/types.ts';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { canvasTexture } from './explosiveModels.ts';

/** A lump of flesh: a rounded shape pushed about, smooth and slightly wet, not a gem. Built once. */
function lumpGeometry(): THREE.BufferGeometry {
  const base = new THREE.IcosahedronGeometry(0.5, 2);
  base.deleteAttribute('normal'); base.deleteAttribute('uv');
  const geometry = mergeVertices(base);
  const position = geometry.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    v.fromBufferAttribute(position, i);
    const noise = 0.72 + 0.5 * Math.abs(Math.sin(v.x * 17.3 + v.y * 9.1) * Math.cos(v.z * 13.7 - v.x * 5.3));
    position.setXYZ(i, v.x * noise, v.y * noise * 0.85, v.z * noise);
  }
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Blood, flesh and thrown limbs. Everything is pooled and bounded, so a crowd of zombies blown up at once costs a fixed amount:
 * the oldest of each kind is recycled when a budget is spent, and nothing is alive (or drawn) when nothing has happened.
 */
export const GORE_BUDGET = { droplets: 512, chunks: 56, pieces: 18, splats: 20 } as const;

const GRAVITY = 9.8;
const PIECE_LIFE = 11, CHUNK_LIFE = 7, SPLAT_LIFE = 45;

interface Piece {
  object: THREE.Group;
  velocity: THREE.Vector3;
  spin: THREE.Vector3;
  age: number;
  radius: number;
  resting: boolean;
}

export interface GoreOptions {
  /** The floor's height at a point (given a height to stand at), for things that land. */
  ground: (x: number, z: number, y: number) => number;
}

const DROPLET_VERTEX = `
attribute float aSize;
attribute float aLife;
varying float vLife;
uniform float uScale;
void main() {
  vLife = aLife;
  vec4 view = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aLife > 0.0 ? aSize * uScale / max(0.2, -view.z) : 0.0;
  gl_Position = projectionMatrix * view;
}`;
const DROPLET_FRAGMENT = `
varying float vLife;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  if (d > 0.5 || vLife <= 0.0) discard;
  float alpha = smoothstep(0.5, 0.2, d) * min(1.0, vLife * 2.5);
  gl_FragColor = vec4(mix(vec3(0.22, 0.01, 0.01), vec3(0.42, 0.03, 0.03), vLife), 0.92 * alpha);
}`;

export class GoreEffects {
  readonly root = new THREE.Group();
  private readonly options: GoreOptions;
  // Droplets: a ring of points.
  private readonly droplets: THREE.Points;
  private readonly dropPosition = new Float32Array(GORE_BUDGET.droplets * 3);
  private readonly dropLife = new Float32Array(GORE_BUDGET.droplets);
  private readonly dropSize = new Float32Array(GORE_BUDGET.droplets);
  private readonly dropVelocity = new Float32Array(GORE_BUDGET.droplets * 3);
  private readonly dropSpan = new Float32Array(GORE_BUDGET.droplets).fill(1);
  private nextDrop = 0;
  private dropsAlive = 0;
  // Flesh and bone: instanced lumps.
  private readonly chunkMesh: THREE.InstancedMesh;
  private readonly chunks: Array<{ position: THREE.Vector3; velocity: THREE.Vector3; spin: THREE.Vector3; rotation: THREE.Euler; size: number; age: number; resting: boolean }> = [];
  private nextChunk = 0;
  private readonly pieces: Piece[] = [];
  private readonly splatMeshes: THREE.Mesh[] = [];
  private readonly splatAge: number[] = [];
  private nextSplat = 0;
  private readonly matrix = new THREE.Matrix4();
  private readonly quaternion = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3();
  private readonly dummyColor = new THREE.Color();
  private uploaded = false;

  constructor(scene: THREE.Scene, options: GoreOptions) {
    this.options = options;
    this.root.name = 'gore';
    const dropGeometry = new THREE.BufferGeometry();
    dropGeometry.setAttribute('position', new THREE.BufferAttribute(this.dropPosition, 3).setUsage(THREE.DynamicDrawUsage));
    dropGeometry.setAttribute('aLife', new THREE.BufferAttribute(this.dropLife, 1).setUsage(THREE.DynamicDrawUsage));
    dropGeometry.setAttribute('aSize', new THREE.BufferAttribute(this.dropSize, 1));
    this.droplets = new THREE.Points(dropGeometry, new THREE.ShaderMaterial({
      vertexShader: DROPLET_VERTEX, fragmentShader: DROPLET_FRAGMENT, transparent: true, depthWrite: false,
      uniforms: { uScale: { value: 500 } },
    }));
    this.droplets.frustumCulled = false; this.droplets.visible = false;
    this.root.add(this.droplets);
    this.chunkMesh = new THREE.InstancedMesh(lumpGeometry(), new THREE.MeshStandardMaterial({ roughness: 0.32, metalness: 0 }), GORE_BUDGET.chunks);
    this.chunkMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.chunkMesh.frustumCulled = false; this.chunkMesh.count = 0; this.chunkMesh.castShadow = false;
    const colours = [0x4a0a0a, 0x651212, 0x7a1c1c, 0x340606, 0x4a0a0a, 0xa89a82];
    for (let i = 0; i < GORE_BUDGET.chunks; i++) this.chunkMesh.setColorAt(i, this.dummyColor.setHex(colours[i % colours.length]));
    this.root.add(this.chunkMesh);
    const splat = canvasTexture(128, 128, context => {
      context.clearRect(0, 0, 128, 128);
      // A pool with ragged edges and a few satellite drops.
      for (let i = 0; i < 26; i++) {
        const a = (i * 2.399) % (Math.PI * 2), r = i < 12 ? 6 + (i * 7) % 22 : 26 + (i * 13) % 30, size = i < 12 ? 22 - i : 5 + (i % 4) * 2;
        const x = 64 + Math.cos(a) * r, y = 64 + Math.sin(a) * r;
        const gradient = context.createRadialGradient(x, y, 0, x, y, size);
        gradient.addColorStop(0, 'rgba(70,4,4,0.95)'); gradient.addColorStop(0.7, 'rgba(58,3,3,0.8)'); gradient.addColorStop(1, 'rgba(50,2,2,0)');
        context.fillStyle = gradient; context.beginPath(); context.arc(x, y, size, 0, Math.PI * 2); context.fill();
      }
    });
    for (let i = 0; i < GORE_BUDGET.splats; i++) {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: splat ?? undefined, color: splat ? 0xffffff : 0x4a0606,
        transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
      mesh.rotation.x = -Math.PI / 2; mesh.visible = false; mesh.renderOrder = 2;
      this.splatMeshes.push(mesh); this.splatAge.push(-1); this.root.add(mesh);
    }
    scene.add(this.root);
  }

  /** How much is alive, for tests and the performance overlay. */
  counts(): { droplets: number; chunks: number; pieces: number; splats: number } {
    return { droplets: this.dropsAlive, chunks: this.chunks.filter(Boolean).length, pieces: this.pieces.length,
      splats: this.splatAge.filter(age => age >= 0).length };
  }

  /**
   * Blood thrown from a point: `count` droplets along `direction` (scattered by `spread`, at about `speed` metres a second), or
   * all round it with no direction.
   */
  spray(point: Vec3, direction: Vec3 | null, count: number, speed = 3.2, spread = 0.5): void {
    for (let i = 0; i < count; i++) {
      const slot = this.nextDrop; this.nextDrop = (this.nextDrop + 1) % GORE_BUDGET.droplets;
      const fast = speed * (0.35 + Math.random() * 0.9);
      let vx: number, vy: number, vz: number;
      if (direction) {
        vx = direction.x + (Math.random() - 0.5) * 2 * spread; vy = direction.y + (Math.random() - 0.3) * spread * 1.6; vz = direction.z + (Math.random() - 0.5) * 2 * spread;
      } else {
        const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u);
        vx = s * Math.cos(a); vy = Math.abs(u) + 0.3; vz = s * Math.sin(a);
      }
      const length = Math.hypot(vx, vy, vz) || 1;
      this.dropPosition.set([point.x, point.y, point.z], slot * 3);
      this.dropVelocity.set([vx / length * fast, vy / length * fast, vz / length * fast], slot * 3);
      this.dropSize[slot] = 0.03 + Math.random() * 0.05;
      this.dropSpan[slot] = 0.5 + Math.random() * 0.7;
      this.dropLife[slot] = 1;
    }
    this.wake();
  }

  /** Lumps of flesh and bone thrown from a point, `speed` being about how hard. */
  burst(point: Vec3, count: number, speed = 5): void {
    for (let i = 0; i < count; i++) {
      const slot = this.nextChunk; this.nextChunk = (this.nextChunk + 1) % GORE_BUDGET.chunks;
      const a = Math.random() * Math.PI * 2, up = 0.5 + Math.random() * 1.1, out = 0.6 + Math.random() * 0.8;
      this.chunks[slot] = { position: new THREE.Vector3(point.x, point.y, point.z),
        velocity: new THREE.Vector3(Math.cos(a) * out * speed * 0.6, up * speed * 0.7, Math.sin(a) * out * speed * 0.6),
        spin: new THREE.Vector3((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14),
        rotation: new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6), size: 0.045 + Math.random() * 0.085, age: 0, resting: false };
    }
    this.chunkMesh.count = GORE_BUDGET.chunks;
    this.wake();
  }

  /** A limb (or a head) flung away: `piece` is a loose object at its own middle; it tumbles, lands, lies a while and goes. */
  throwPiece(piece: THREE.Group, velocity: Vec3, radius = 0.12): void {
    if (this.pieces.length >= GORE_BUDGET.pieces) this.release(this.pieces.shift()!);
    piece.traverse(object => { const mesh = object as THREE.Mesh; if (mesh.isMesh) { mesh.frustumCulled = false; } });
    this.root.add(piece);
    this.pieces.push({ object: piece, velocity: new THREE.Vector3(velocity.x, velocity.y, velocity.z),
      spin: new THREE.Vector3((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12), age: 0, radius, resting: false });
    this.wake();
  }

  /** A pool of blood on the floor under `x, z` (at about height `y`), `size` metres across. */
  splat(x: number, y: number, z: number, size: number): void {
    const slot = this.nextSplat; this.nextSplat = (this.nextSplat + 1) % GORE_BUDGET.splats;
    const mesh = this.splatMeshes[slot];
    mesh.position.set(x, this.options.ground(x, z, y) + 0.012 + slot * 0.0004, z);
    mesh.rotation.z = Math.random() * Math.PI * 2;
    mesh.scale.setScalar(size);
    (mesh.material as THREE.MeshBasicMaterial).opacity = 0.9;
    mesh.visible = true; this.splatAge[slot] = 0;
  }

  private release(piece: Piece): void {
    this.root.remove(piece.object);
    piece.object.traverse(object => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose();
    });
  }

  private wake(): void { this.droplets.visible = true; this.uploaded = false; }

  /** True while anything is alive. */
  get active(): boolean { return this.dropsAlive > 0 || this.pieces.length > 0 || this.chunks.some(Boolean) || this.splatAge.some(age => age >= 0); }

  update(dt: number, camera?: THREE.PerspectiveCamera, viewportHeight = 768): void {
    if (!this.active && this.dropLife.every(life => life <= 0)) { this.droplets.visible = false; return; }
    dt = Math.min(dt, 0.05);
    if (camera) (this.droplets.material as THREE.ShaderMaterial).uniforms.uScale.value = viewportHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    // Droplets.
    let alive = 0;
    for (let i = 0; i < GORE_BUDGET.droplets; i++) {
      if (this.dropLife[i] <= 0) continue;
      const p = i * 3;
      this.dropVelocity[p + 1] -= GRAVITY * dt;
      this.dropPosition[p] += this.dropVelocity[p] * dt; this.dropPosition[p + 1] += this.dropVelocity[p + 1] * dt; this.dropPosition[p + 2] += this.dropVelocity[p + 2] * dt;
      this.dropLife[i] -= dt / this.dropSpan[i];
      if (this.dropPosition[p + 1] < this.options.ground(this.dropPosition[p], this.dropPosition[p + 2], this.dropPosition[p + 1]) + 0.02) this.dropLife[i] = 0;
      if (this.dropLife[i] > 0) alive++;
    }
    this.dropsAlive = alive;
    (this.droplets.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.droplets.geometry.attributes.aLife as THREE.BufferAttribute).needsUpdate = true;
    // Lumps.
    let lumps = 0;
    for (let i = 0; i < this.chunks.length; i++) {
      const chunk = this.chunks[i];
      if (!chunk) { this.matrix.makeScale(0, 0, 0); this.chunkMesh.setMatrixAt(i, this.matrix); continue; }
      chunk.age += dt;
      if (chunk.age > CHUNK_LIFE) { delete this.chunks[i]; this.matrix.makeScale(0, 0, 0); this.chunkMesh.setMatrixAt(i, this.matrix); continue; }
      if (!chunk.resting) {
        chunk.velocity.y -= GRAVITY * dt;
        chunk.position.addScaledVector(chunk.velocity, dt);
        chunk.rotation.x += chunk.spin.x * dt; chunk.rotation.y += chunk.spin.y * dt; chunk.rotation.z += chunk.spin.z * dt;
        const floor = this.options.ground(chunk.position.x, chunk.position.z, chunk.position.y) + chunk.size * 0.4;
        if (chunk.position.y < floor) {
          chunk.position.y = floor;
          if (Math.abs(chunk.velocity.y) > 1.2) { chunk.velocity.y *= -0.3; chunk.velocity.x *= 0.6; chunk.velocity.z *= 0.6; chunk.spin.multiplyScalar(0.5); }
          else chunk.resting = true;
        }
      }
      const shrink = chunk.age > CHUNK_LIFE - 1 ? CHUNK_LIFE - chunk.age : 1;
      this.quaternion.setFromEuler(chunk.rotation);
      this.matrix.compose(chunk.position, this.quaternion, this.scale.set(chunk.size * 1.4, chunk.size * 0.9, chunk.size).multiplyScalar(Math.max(0.001, shrink)));
      this.chunkMesh.setMatrixAt(i, this.matrix);
      lumps++;
    }
    if (this.chunks.length) { this.chunkMesh.instanceMatrix.needsUpdate = true; if (lumps === 0) { this.chunks.length = 0; this.chunkMesh.count = 0; this.nextChunk = 0; } }
    // Limbs and heads.
    for (let i = this.pieces.length - 1; i >= 0; i--) {
      const piece = this.pieces[i];
      piece.age += dt;
      if (piece.age > PIECE_LIFE) { this.release(piece); this.pieces.splice(i, 1); continue; }
      if (!piece.resting) {
        piece.velocity.y -= GRAVITY * dt;
        piece.object.position.addScaledVector(piece.velocity, dt);
        piece.object.rotation.x += piece.spin.x * dt; piece.object.rotation.y += piece.spin.y * dt; piece.object.rotation.z += piece.spin.z * dt;
        const floor = this.options.ground(piece.object.position.x, piece.object.position.z, piece.object.position.y) + piece.radius;
        if (piece.object.position.y < floor) {
          piece.object.position.y = floor;
          if (Math.abs(piece.velocity.y) > 1.5) { piece.velocity.y *= -0.32; piece.velocity.x *= 0.55; piece.velocity.z *= 0.55; piece.spin.multiplyScalar(0.55); }
          else if (piece.velocity.lengthSq() > 0.04) { piece.velocity.y = 0; piece.velocity.x *= 0.85; piece.velocity.z *= 0.85; piece.spin.multiplyScalar(0.8); }
          else piece.resting = true;
        }
      }
      // Sunk out of sight in the last moments, so nothing pops away.
      piece.object.scale.setScalar(piece.age > PIECE_LIFE - 1.5 ? Math.max(0.001, (PIECE_LIFE - piece.age) / 1.5) : 1);
    }
    // Pools fade slowly.
    for (let i = 0; i < this.splatMeshes.length; i++) {
      if (this.splatAge[i] < 0) continue;
      this.splatAge[i] += dt;
      if (this.splatAge[i] > SPLAT_LIFE) { this.splatMeshes[i].visible = false; this.splatAge[i] = -1; continue; }
      (this.splatMeshes[i].material as THREE.MeshBasicMaterial).opacity = 0.9 * Math.min(1, (SPLAT_LIFE - this.splatAge[i]) / 8);
    }
    if (!this.uploaded) this.uploaded = true;
  }

  /** Forgets everything, as for a new match. */
  clear(): void {
    this.dropLife.fill(0); this.dropsAlive = 0; this.nextDrop = 0;
    this.chunks.length = 0; this.chunkMesh.count = 0; this.nextChunk = 0;
    for (const piece of this.pieces) this.release(piece);
    this.pieces.length = 0;
    this.splatMeshes.forEach((mesh, i) => { mesh.visible = false; this.splatAge[i] = -1; });
    this.droplets.visible = false;
  }

  dispose(): void { this.clear(); this.root.removeFromParent(); }
}
