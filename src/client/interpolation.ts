import type { Vec3 } from '../core/types.ts';

// Presentation only: 60 Hz simulation remains deterministic on any refresh rate.
export function interpolatePosition(previous: Vec3 | undefined, current: Vec3, alpha: number): Vec3 {
  if (!previous || Math.hypot(current.x - previous.x, current.y - previous.y, current.z - previous.z) > 2) return current;
  const t = Math.max(0, Math.min(1, alpha));
  return { x: previous.x + (current.x - previous.x) * t,
    y: previous.y + (current.y - previous.y) * t, z: previous.z + (current.z - previous.z) * t };
}
