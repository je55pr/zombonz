import type { CollisionBox } from '../core/collision.ts';
import type { Vec3 } from '../core/types.ts';
import { px, pz } from './bunkerPlan.ts';
import type { MapDecal } from './gameMap.ts';

export interface PropPlacement {
  id: string; asset: string; position: Vec3; size: Vec3; yaw: number; solid: boolean; background?: boolean;
}
const prop = (id: string, asset: string, x: number, y: number, z: number,
  sx: number, sy: number, sz: number, yaw = 0, solid = true, background = false): PropPlacement =>
  ({ id, asset, position: { x, y, z }, size: { x: sx, y: sy, z: sz }, yaw, solid, background });
/** Items resting on another prop move with it, rather than being placed on the plan by themselves. */
const RESTS_ON: Readonly<Record<string, string>> = {
  'spawn-ammo': 'spawn-workbench', 'workbench-vice': 'spawn-workbench', 'spawn-crate-b': 'spawn-crate-a',
  'help-radio': 'help-radio-table', 'help-ammo': 'help-radio-table',
  'upper-tool': 'upper-table', 'upper-ammo': 'upper-table',
};
/** Maps blockout placements onto the built plan (see bunkerPlan). */
function onPlan(props: readonly PropPlacement[]): PropPlacement[] {
  const blockout = new Map(props.map(p => [p.id, p.position]));
  const mapped = (position: Vec3): Vec3 => ({ x: px(position.x), y: position.y, z: pz(position.z) });
  return props.map(p => {
    const base = RESTS_ON[p.id] ? blockout.get(RESTS_ON[p.id])! : p.position, at = mapped(base);
    return { ...p, position: { x: at.x + p.position.x - base.x, y: p.position.y, z: at.z + p.position.z - base.z } };
  });
}
// Fit each model uniformly inside these authored envelopes. Collision is independent
// of download completion, and props intentionally avoid entry landings / stair lanes.
export const BUNKER_PROPS: readonly PropPlacement[] = onPlan([
  prop('spawn-workbench', 'wooden-table', 1.7, 0, -2.02, 1.8, 0.55, 0.66),
  prop('spawn-ammo', 'ammo-box', 1.1, 0.55, -2.02, 0.15, 0.3, 0.44, Math.PI / 2, false),
  prop('workbench-vice', 'bench-vice', 2.15, 0.55, -2.02, 0.2, 0.285, 0.396, 0, false),
  prop('spawn-shelves', 'shelf', 17.73, 0, 1.7, 1.01, 2.08, 0.26, -Math.PI / 2),
  prop('spawn-hand-truck', 'hand-truck', 17.35, 0, 3.7, 0.6, 1.4, 0.7, -Math.PI / 2),
  prop('spawn-barrel', 'explosive-barrel', 7.7, 0, 7.2, 0.58, 0.9, 0.58),
  prop('spawn-crate-a', 'wooden-crate', 14.8, 0, 7.15, 0.85, 0.24, 0.4),
  prop('spawn-crate-b', 'wooden-crate', 14.8, 0.24, 7.15, 0.8, 0.23, 0.36, 0, false),
  prop('spawn-fuel', 'metal-jerrycan', 15.55, 0, 7.25, 0.35, 0.46, 0.18),
  prop('help-radio-table', 'wooden-table', -3.65, 0, 7.1, 1.8, 0.55, 0.66, Math.PI),
  prop('help-radio', 'field-radio', -3.7, 0.55, 7.1, 0.62, 0.44, 0.42, Math.PI, false),
  prop('help-ammo', 'ammo-box', -4.27, 0.55, 7.1, 0.15, 0.3, 0.44, Math.PI / 2, false),
  prop('help-stove', 'barrel-stove', -0.7, 0, -10.15, 0.6, 0.86, 0.6),
  prop('help-ladder', 'wooden-ladder', -5.7, 0, -5.55, 0.96, 1.34, 0.5, Math.PI / 2),
  prop('help-shelves', 'shelf', -0.47, 0, 3.2, 1.01, 2.08, 0.26, -Math.PI / 2),
  prop('help-carton', 'cardboard-box', -0.75, 0, 4.4, 0.39, 0.35, 0.52),
  prop('upper-crate', 'wooden-crate', -5.4, 3.4, -6.7, 0.85, 0.24, 0.4, Math.PI / 2),
  prop('upper-table', 'wooden-table', 1.25, 3.4, 4.8, 1.8, 0.55, 0.66),
  prop('upper-tool', 'crowbar', 1.8, 3.95, 4.8, 0.04, 0.128, 0.555, Math.PI / 2, false),
  prop('upper-ammo', 'ammo-box', 0.8, 3.95, 4.8, 0.15, 0.3, 0.44, Math.PI / 2, false),
  prop('bags-spawn', 'cement-bag', 14.8, 0, -2.03, 0.47, 0.18, 0.7, Math.PI / 2, false),
  prop('bags-help', 'cement-bag', -5.6, 0, -7.8, 0.47, 0.18, 0.7, 0, false),
  prop('bags-upper', 'cement-bag', 9.55, 3.4, 4.65, 0.47, 0.18, 0.7, Math.PI / 2, false),
  prop('lamp-spawn', 'wall-lamp', 0.35, 2.1, 3.7, 0.273, 0.43, 0.14, Math.PI / 2, false),
  prop('lamp-help', 'wall-lamp', -0.35, 2.1, -2, 0.273, 0.43, 0.14, -Math.PI / 2, false),
  prop('lamp-upper', 'wall-lamp', -0.35, 5.5, 2.5, 0.273, 0.43, 0.14, -Math.PI / 2, false),
  prop('hanging-light', 'caged-ceiling-light', 5, 2.45, 2, 0.8, 0.52, 0.22, 0, false),
  prop('yard-jeep', 'vehicles/gaz-67', 5, 0, 17, 1.8, 1.65, 3.6, 0.4, false, true),
  prop('yard-tank', 'vehicles/t-12', 27, 0, 5, 2.7, 2.8, 6.3, Math.PI / 2, false, true),
  prop('yard-barrel-a', 'explosive-barrel', 15, 0, -8, 0.58, 0.9, 0.58, 0, false, true),
  prop('yard-barrel-b', 'explosive-barrel', 15.7, 0, -8.25, 0.58, 0.9, 0.58, 0, false, true),
]);
export function propCollisionBox(prop: PropPlacement): CollisionBox {
  const c = Math.abs(Math.cos(prop.yaw)), s = Math.abs(Math.sin(prop.yaw));
  const halfX = (prop.size.x * c + prop.size.z * s) / 2, halfZ = (prop.size.x * s + prop.size.z * c) / 2;
  return { min: { x: prop.position.x - halfX, y: prop.position.y, z: prop.position.z - halfZ },
    max: { x: prop.position.x + halfX, y: prop.position.y + prop.size.y, z: prop.position.z + halfZ } };
}

/** Grime decals on Bunker's walls. */
export const BUNKER_DECALS: readonly MapDecal[] = [
  { asset: 'leaking-grime', x: px(15.6), y: 1.8, z: pz(-2.389), width: 2.6, height: 2.5, yaw: 0 },
  { asset: 'leaking-grime', x: px(-5.989), y: 5.1, z: pz(-6.5), width: 2.5, height: 2.7, yaw: Math.PI / 2 },
  { asset: 'smear-grime', x: px(0.211), y: 1.5, z: pz(5), width: 2.8, height: 2.3, yaw: Math.PI / 2 },
  { asset: 'smear-grime', x: px(-0.211), y: 1.5, z: pz(-8.1), width: 2.5, height: 2.3, yaw: -Math.PI / 2 },
  { asset: 'leaking-grime', x: px(6.8), y: 5.15, z: pz(5.189), width: 3.1, height: 2.5, yaw: Math.PI },
];
