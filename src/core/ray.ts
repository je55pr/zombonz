import type { CollisionBox } from './collision.ts';
import type { Vec3 } from './types.ts';

export interface Ray {
  origin: Vec3;
  direction: Vec3;
}

/** Distance along the ray to an axis-aligned box, or null if it misses it or lies beyond `maxDistance`. */
export function rayAabbDistance(ray: Ray, min: Vec3, max: Vec3, maxDistance: number): number | null {
  let tMin = 0;
  let tMax = maxDistance;
  for (const axis of ['x', 'y', 'z'] as const) {
    const origin = ray.origin[axis];
    const direction = ray.direction[axis];
    if (Math.abs(direction) < 1e-12) {
      if (origin < min[axis] || origin > max[axis]) return null;
      continue;
    }
    let near = (min[axis] - origin) / direction;
    let far = (max[axis] - origin) / direction;
    if (near > far) [near, far] = [far, near];
    tMin = Math.max(tMin, near);
    tMax = Math.min(tMax, far);
    if (tMin > tMax) return null;
  }
  return tMin <= maxDistance ? tMin : null;
}

/** Whether the straight line between two points passes through none of the boxes. */
export function clearLine(from: Vec3, to: Vec3, boxes: readonly CollisionBox[]): boolean {
  const distance = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
  if (distance < 0.001) return true;
  const direction = { x: (to.x - from.x) / distance, y: (to.y - from.y) / distance, z: (to.z - from.z) / distance };
  return boxes.every(box => rayAabbDistance({ origin: from, direction }, box.min, box.max, distance - 0.01) === null);
}
