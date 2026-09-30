import { work } from './profiling.ts';
import type { Vec3 } from './types.ts';

export interface CollisionBox {
  min: Vec3;
  max: Vec3;
}

function overlapsVertical(feetY: number, height: number, box: CollisionBox): boolean {
  return feetY < box.max.y && feetY + height > box.min.y;
}

export function moveWithCollision(
  position: Vec3,
  delta: Vec3,
  radius: number,
  height: number,
  boxes: readonly CollisionBox[],
): Vec3 {
  let x = position.x;
  let z = position.z;
  const y = position.y;
  work.moves++; work.moveBoxTests += 2 * boxes.length;

  let targetX = x + delta.x;
  for (const box of boxes) {
    if (!overlapsVertical(y, height, box)) continue;
    const minZ = box.min.z - radius;
    const maxZ = box.max.z + radius;
    if (z <= minZ || z >= maxZ) continue;
    const minX = box.min.x - radius;
    const maxX = box.max.x + radius;
    if (delta.x > 0 && x <= minX && targetX > minX) targetX = Math.min(targetX, minX);
    if (delta.x < 0 && x >= maxX && targetX < maxX) targetX = Math.max(targetX, maxX);
  }
  x = targetX;

  let targetZ = z + delta.z;
  for (const box of boxes) {
    if (!overlapsVertical(y, height, box)) continue;
    const minX = box.min.x - radius;
    const maxX = box.max.x + radius;
    if (x <= minX || x >= maxX) continue;
    const minZ = box.min.z - radius;
    const maxZ = box.max.z + radius;
    if (delta.z > 0 && z <= minZ && targetZ > minZ) targetZ = Math.min(targetZ, minZ);
    if (delta.z < 0 && z >= maxZ && targetZ < maxZ) targetZ = Math.max(targetZ, maxZ);
  }
  z = targetZ;

  return { x, y: y + delta.y, z };
}

/**
 * Whether a body `radius` wide and `height` tall, walking the straight line from `start` to `end`, runs into `box`:
 * whether the line enters the box grown by the radius on every side, at a height where the body would touch it.
 */
export function segmentHitsExpandedBox(
  start: Vec3,
  end: Vec3,
  box: CollisionBox,
  radius: number,
  height: number,
): boolean {
  work.navigationBoxTests++;
  const minX = box.min.x - radius;
  const maxX = box.max.x + radius;
  const minZ = box.min.z - radius;
  const maxZ = box.max.z + radius;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const dz = end.z - start.z;
  const minY = box.min.y - height + 1e-6;
  const maxY = box.max.y - 1e-6;
  let near = 0;
  let far = 1;
  // Avoid allocating four temporary arrays for every box/line test.
  for (let axis = 0; axis < 3; axis++) {
    const origin = axis === 0 ? start.x : axis === 1 ? start.y : start.z;
    const delta = axis === 0 ? dx : axis === 1 ? dy : dz;
    const min = axis === 0 ? minX : axis === 1 ? minY : minZ;
    const max = axis === 0 ? maxX : axis === 1 ? maxY : maxZ;
    if (Math.abs(delta) < 1e-9) {
      if (origin < min || origin > max) return false;
      continue;
    }
    let t1 = (min - origin) / delta;
    let t2 = (max - origin) / delta;
    if (t1 > t2) [t1, t2] = [t2, t1];
    near = Math.max(near, t1);
    far = Math.min(far, t2);
    if (near > far) return false;
  }
  return far >= 0 && near <= 1;
}

export interface WalkSurface {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  startHeight: number;
  endHeight: number;
  slopeAxis?: 'x' | 'z';
  /** Optional planar footprint, in x/z coordinates. */
  polygon?: readonly (readonly [number, number])[];
  /** Clockwise quarter-turn ramp, from east to north around its centre. */
  quarterTurn?: { x: number; z: number; innerRadius: number; outerRadius: number };
}

export function walkSurfaceHeight(surface: WalkSurface, x: number, z: number): number | undefined {
  if (x < surface.minX - 1e-7 || x > surface.maxX + 1e-7 || z < surface.minZ - 1e-7 || z > surface.maxZ + 1e-7) return;
  if (surface.polygon) {
    let inside = false;
    const points = surface.polygon;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const [ax, az] = points[j], [bx, bz] = points[i];
      const cross = (x - ax) * (bz - az) - (z - az) * (bx - ax);
      if (Math.abs(cross) < 1e-7 && x >= Math.min(ax, bx) - 1e-7 && x <= Math.max(ax, bx) + 1e-7
        && z >= Math.min(az, bz) - 1e-7 && z <= Math.max(az, bz) + 1e-7) { inside = true; break; }
      if ((az > z) !== (bz > z) && x < (bx - ax) * (z - az) / (bz - az) + ax) inside = !inside;
    }
    if (!inside) return;
  }
  let t = 0;
  if (surface.slopeAxis === 'x') t = (x - surface.minX) / (surface.maxX - surface.minX);
  if (surface.slopeAxis === 'z') t = (z - surface.minZ) / (surface.maxZ - surface.minZ);
  if (surface.quarterTurn) {
    const turn = surface.quarterTurn, dx = x - turn.x, dz = z - turn.z;
    const radius = Math.hypot(dx, dz);
    if (radius < turn.innerRadius || radius > turn.outerRadius || dx < -1e-7 || dz > 1e-7) return;
    t = Math.max(0, Math.min(1, -Math.atan2(dz, dx) / (Math.PI / 2)));
  }
  return surface.startHeight + (surface.endHeight - surface.startHeight) * t;
}

export function sampleWalkHeight(
  x: number,
  z: number,
  currentHeight: number,
  surfaces: readonly WalkSurface[],
  maxStepUp = 0.45,
): number {
  let best = Number.NEGATIVE_INFINITY;
  for (const surface of surfaces) {
    const height = walkSurfaceHeight(surface, x, z);
    if (height === undefined) continue;
    if (height <= currentHeight + maxStepUp && height > best) best = height;
  }
  return Number.isFinite(best) ? best : currentHeight;
}
