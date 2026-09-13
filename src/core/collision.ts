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
    if (x < surface.minX || x > surface.maxX || z < surface.minZ || z > surface.maxZ) continue;
    let t = 0;
    if (surface.slopeAxis === 'x') t = (x - surface.minX) / (surface.maxX - surface.minX);
    if (surface.slopeAxis === 'z') t = (z - surface.minZ) / (surface.maxZ - surface.minZ);
    const height = surface.startHeight + (surface.endHeight - surface.startHeight) * t;
    if (height <= currentHeight + maxStepUp && height > best) best = height;
  }
  return Number.isFinite(best) ? best : currentHeight;
}
