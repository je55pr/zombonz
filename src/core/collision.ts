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
