import * as THREE from 'three';

/**
 * How many point lights the scene really has. Every lit pixel pays for every point light in the scene,
 * whether it is near, far or switched off, so the map's lamps, perk machines, traps and box glow share
 * this many real lights. The count never changes, so shaders never recompile.
 */
export const LIGHT_POOL_SIZE = 4;
/** Seconds for a light to fade in when it takes a slot, or out when it gives one up. */
const FADE_SECONDS = 0.3;
/** A light whose reach is off screen ranks as if it were this much further away (metres). */
const OFFSCREEN_PENALTY = 6;
/** A light already shining ranks this much nearer (metres), so walking about doesn't swap lights back and forth. */
const HYSTERESIS = 3;

/**
 * Where a map light would be: placed in the scene graph like a PointLight (it follows its parent) and
 * with the same settings, but drawn by whichever pooled light is free when it is one of the nearest.
 * It is off when its intensity is 0 or it or a parent is hidden.
 */
export class LightSource extends THREE.Object3D {
  readonly color: THREE.Color;
  /** Metres of rank added over the map's lamps, so a brief flash (an explosion) is never left out for want of a slot. */
  priority = 0;
  constructor(color: THREE.ColorRepresentation, public intensity = 1, public distance = 0, public decay = 2) {
    super();
    this.color = new THREE.Color(color);
  }
}

interface Slot { light: THREE.PointLight; source: LightSource | null; level: number }

export class LightPool {
  private readonly sources: LightSource[] = [];
  private readonly slots: Slot[] = [];
  private readonly frustum = new THREE.Frustum();
  private readonly matrix = new THREE.Matrix4();
  private readonly sphere = new THREE.Sphere();
  private readonly eye = new THREE.Vector3();
  private readonly position = new THREE.Vector3();
  private readonly ranked: Array<{ source: LightSource; score: number }> = [];
  private started = false;

  constructor(parent: THREE.Object3D, size = LIGHT_POOL_SIZE) {
    for (let i = 0; i < size; i++) {
      const light = new THREE.PointLight(0xffffff, 0);
      light.name = `pooled-light-${i}`;
      parent.add(light);
      this.slots.push({ light, source: null, level: 0 });
    }
  }

  add(source: LightSource): LightSource { this.sources.push(source); return source; }
  get capacity(): number { return this.slots.length; }
  get sourceCount(): number { return this.sources.length; }

  /** The sources currently drawn, for tests and inspection. */
  shining(): LightSource[] { return this.slots.flatMap(slot => slot.source && slot.level > 0 ? [slot.source] : []); }

  /** Picks the sources to draw from the camera's view; call once per rendered frame. */
  update(camera: THREE.Camera, dtSeconds: number): void {
    camera.updateMatrixWorld();
    this.frustum.setFromProjectionMatrix(this.matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    camera.getWorldPosition(this.eye);
    const ranked = this.ranked; ranked.length = 0;
    for (const source of this.sources) {
      if (!(source.intensity > 0) || !visible(source)) continue;
      source.getWorldPosition(this.position);
      const reach = source.distance > 0 ? source.distance : Infinity;
      // Measured from the edge of the light's reach: a lamp whose light surrounds the camera ranks first.
      let score = Math.max(0, this.position.distanceTo(this.eye) - reach);
      if (!this.frustum.intersectsSphere(this.sphere.set(this.position, reach))) score += OFFSCREEN_PENALTY;
      if (this.slots.some(slot => slot.source === source)) score -= HYSTERESIS;
      score -= source.priority;
      ranked.push({ source, score });
    }
    ranked.sort((a, b) => a.score - b.score);
    const wanted = new Set(ranked.slice(0, this.slots.length).map(entry => entry.source));
    // The first frame, or one after a long stall, shows the right lights at once rather than fading.
    const snap = !this.started || dtSeconds > 0.5;
    this.started = true;
    const step = snap ? 1 : Math.max(0, dtSeconds) / FADE_SECONDS;
    for (const slot of this.slots) {
      if (!slot.source) continue;
      slot.level = wanted.has(slot.source) ? Math.min(1, slot.level + step) : Math.max(0, slot.level - step);
      if (slot.level === 0) slot.source = null;
      else wanted.delete(slot.source);
    }
    // Newcomers take free slots; one waits while the light it replaces fades out.
    for (const source of wanted) {
      const slot = this.slots.find(candidate => !candidate.source);
      if (!slot) break;
      slot.source = source; slot.level = snap ? 1 : Math.min(1, step);
    }
    for (const { light, source, level } of this.slots) {
      if (!source) { light.intensity = 0; continue; }
      source.getWorldPosition(light.position);
      light.color.copy(source.color);
      light.intensity = source.intensity * level;
      light.distance = source.distance; light.decay = source.decay;
    }
  }
}

function visible(object: THREE.Object3D): boolean {
  for (let node: THREE.Object3D | null = object; node; node = node.parent) if (!node.visible) return false;
  return true;
}
