import * as THREE from 'three';
import { projectWorldUvs } from './environmentMaterials.ts';

/** The player's eye height above a window's floor, which the boards must leave clear. */
export const EYE_HEIGHT = 1.62;
/** Height of one plank, and the frame's opening (the sill is at 0.85 m and the lintel at 2.65 m). */
const PLANK_HEIGHT = 0.17;
const PLANK_STEP = 0.19;
/** The middle of the top board below the eye-line and of the bottom one above it: a 0.33 m gap centred on it. */
const LOW_TOP = 1.37, HIGH_BOTTOM = 1.87;
/** The top of the projecting stone sill, which no board may sink into. */
export const SILL_TOP = 0.905;
/** How far a board's end may rise or fall from level, whatever the window's width. */
const MAX_TILT_RISE = 0.08;
const BASE_TILT = [0.05, -0.07, 0.06, -0.04, 0.07, -0.03] as const;
const TILT_JITTER = 0.02, HEIGHT_JITTER = 0.015, SIDE_JITTER = 0.03;
/** Neighbouring boards sit at slightly different depths, so where they overlap they never flicker. */
const DEPTH = 0.03, DEPTH_STEP = 0.014;

/**
 * The height of each board slot, lowest first. Half sit under the eye-line and half above, so the
 * middle of the window is open to look and shoot through however many boards are up. A frame with
 * more than six slots falls back to even spacing across the opening.
 */
export function plankHeights(count: number): number[] {
  if (count > 6) return Array.from({ length: count }, (_, i) => 1.0 + i * (1.4 / Math.max(1, count - 1)));
  const low = Math.floor(count / 2), high = count - low;
  return [
    ...Array.from({ length: low }, (_, i) => LOW_TOP - (low - 1 - i) * PLANK_STEP),
    ...Array.from({ length: high }, (_, j) => HIGH_BOTTOM + j * PLANK_STEP),
  ];
}

export interface PlankPose { y: number; x: number; tilt: number }

/** A small deterministic random number in -0.5..0.5 from a window's seed, a board slot and a purpose. */
function wobble(seed: number, slot: number, purpose: number): number {
  let h = (seed ^ Math.imul(slot + 1, 0x9e3779b9) ^ Math.imul(purpose + 1, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d); h = Math.imul(h ^ (h >>> 15), 0x846ca68b); h ^= h >>> 16;
  return (h >>> 0) / 4294967296 - 0.5;
}

/**
 * Where a board sits: its slot's height, tilt and a little drift, all varied by the window's seed so
 * each window is nailed up differently but always the same way. A wide window tilts its boards less, so
 * an end never rises or falls more than `MAX_TILT_RISE` and the eye-line stays clear at any width.
 */
export function plankPose(seed: number, slot: number, count: number, width: number): PlankPose {
  const reach = width / 2 + 0.07, limit = Math.asin(Math.min(1, MAX_TILT_RISE / reach));
  const tilt = BASE_TILT[(slot + Math.floor((wobble(seed, 0, 3) + 0.5) * BASE_TILT.length)) % BASE_TILT.length]
    * (wobble(seed, slot, 4) > 0 ? 1 : -1) + wobble(seed, slot, 2) * 2 * TILT_JITTER;
  const clamped = Math.max(-limit, Math.min(limit, tilt));
  // The lowest board rests on the sill rather than sinking into it.
  const floor = SILL_TOP + PLANK_HEIGHT / 2 + reach * Math.abs(Math.sin(clamped));
  return {
    y: Math.max(floor, plankHeights(count)[slot] + wobble(seed, slot, 0) * 2 * HEIGHT_JITTER),
    x: wobble(seed, slot, 1) * 2 * SIDE_JITTER,
    tilt: clamped,
  };
}

/** The lowest and highest point any part of a board reaches, in a window of `width`. */
export function plankReach(pose: PlankPose, width: number): { low: number; high: number } {
  const excursion = (width / 2 + 0.07) * Math.abs(Math.sin(pose.tilt));
  return { low: pose.y - PLANK_HEIGHT / 2 - excursion, high: pose.y + PLANK_HEIGHT / 2 + excursion };
}

/** A stable seed for a window, from its id, so its boards look the same every game. */
export function windowSeed(id: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 0x01000193);
  return hash >>> 0;
}

/**
 * Swaps a geometry's texture axes. The planks texture has its grain running up the image (v), but a
 * board's length runs along the projected u, so its grain would cross the board; turning the axes
 * lays the grain along the board.
 */
export function turnUvs(geometry: THREE.BufferGeometry): void {
  const uv = geometry.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getY(i), uv.getX(i));
  uv.needsUpdate = true;
}

/** Two cullable draws per window, while each board can still fall and be repaired independently. */
export class WindowBoards {
  readonly planks: THREE.InstancedMesh;
  readonly nails: THREE.InstancedMesh;
  private readonly board = new THREE.Object3D();
  private readonly nailMatrix = new THREE.Matrix4();
  private readonly nailOffsets: readonly THREE.Matrix4[];
  private readonly poses: readonly PlankPose[];
  private lastMask = -1;
  private lastFallSlot = -2;
  private lastFall = -1;

  constructor(frame: THREE.Group, width: number, maxBoards: number,
    boardsMaterial: THREE.Material, nailMaterial: THREE.Material, nailGeometry: THREE.BufferGeometry, seed = 0) {
    const boardGeometry = new THREE.BoxGeometry(width + 0.14, PLANK_HEIGHT, 0.025);
    projectWorldUvs(boardGeometry);
    turnUvs(boardGeometry);
    this.poses = Array.from({ length: maxBoards }, (_, slot) => plankPose(seed, slot, maxBoards, width));
    this.planks = new THREE.InstancedMesh(boardGeometry, boardsMaterial, maxBoards);
    this.nails = new THREE.InstancedMesh(nailGeometry, nailMaterial, maxBoards * 2);
    this.planks.name = 'window-planks'; this.nails.name = 'window-nails';
    this.planks.userData.dynamic = this.nails.userData.dynamic = true;
    this.planks.castShadow = true; this.planks.receiveShadow = true;
    // The old nail heads were small unshadowed meshes; retain that cheap appearance.
    const nailRotation = new THREE.Matrix4().makeRotationX(Math.PI / 2);
    this.nailOffsets = [-1, 1].map(end => new THREE.Matrix4()
      .makeTranslation(end * (width / 2 + 0.01), 0, 0.015).multiply(nailRotation));
    // A fixed local bound covers the whole frame and a board's brief fall below its sill.
    const bounds = new THREE.Sphere(new THREE.Vector3(0, 0.6, 0), Math.hypot(width / 2 + 0.2, 3.2));
    this.planks.boundingSphere = bounds.clone(); this.nails.boundingSphere = bounds.clone();
    frame.add(this.planks, this.nails);
    this.setState((1 << maxBoards) - 1, -1, null);
  }

  /**
   * `mask` has a bit set for each slot that holds a board. `fallSlot` is the slot last torn out, which
   * falls for the 0.8 seconds after (`fallElapsed`; null outside it). Returns whether any board moved.
   */
  setState(mask: number, fallSlot: number, fallElapsed: number | null): boolean {
    const slots = this.poses.length;
    const falling = fallElapsed !== null && fallElapsed >= 0 && fallElapsed < 0.8
      && fallSlot >= 0 && fallSlot < slots && ((mask >>> fallSlot) & 1) === 0;
    const fall = falling ? fallElapsed : null;
    if (mask === this.lastMask && (falling ? fallSlot : -1) === this.lastFallSlot && (fall ?? -1) === this.lastFall) return false;
    this.lastMask = mask; this.lastFallSlot = falling ? fallSlot : -1; this.lastFall = fall ?? -1;
    let visible = 0;
    for (let slot = 0; slot < slots; slot++) {
      const dropping = falling && slot === fallSlot;
      if (((mask >>> slot) & 1) === 0 && !dropping) continue;
      const pose = this.poses[slot], t = dropping ? fall! : 0;
      this.board.position.set(pose.x, pose.y - t * t * 4, DEPTH + (slot % 2) * DEPTH_STEP);
      this.board.rotation.set(t * 1.5, 0, pose.tilt + t * 2);
      this.board.updateMatrix();
      this.planks.setMatrixAt(visible, this.board.matrix);
      for (let end = 0; end < 2; end++) {
        this.nailMatrix.multiplyMatrices(this.board.matrix, this.nailOffsets[end]);
        this.nails.setMatrixAt(visible * 2 + end, this.nailMatrix);
      }
      visible++;
    }
    this.planks.count = visible; this.nails.count = visible * 2;
    this.planks.instanceMatrix.needsUpdate = true;
    this.nails.instanceMatrix.needsUpdate = true;
    return true;
  }
}
