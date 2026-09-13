import type { CollisionBox, WalkSurface } from '../core/collision.ts';
import type { Vec3 } from '../core/types.ts';

export type GreyboxMaterial = 'wall' | 'floor' | 'upperFloor' | 'stair' | 'barrier';

export interface GreyboxBox {
  center: Vec3;
  size: Vec3;
  material: GreyboxMaterial;
  collides?: boolean;
  rotationZ?: number;
}

export interface MapMarker {
  id: string;
  type: 'zombieSpawn' | 'door' | 'wallBuy' | 'mysteryBox';
  position: Vec3;
  label: string;
}

const box = (
  x: number, y: number, z: number,
  sx: number, sy: number, sz: number,
  material: GreyboxMaterial,
  collides = material === 'wall' || material === 'barrier',
  rotationZ = 0,
): GreyboxBox => ({ center: { x, y, z }, size: { x: sx, y: sy, z: sz }, material, collides, rotationZ });
const groundShell: GreyboxBox[] = [
  box(-3, -0.1, 0, 6, 0.2, 10, 'floor', false),
  box(3.5, -0.1, 0, 7, 0.2, 10, 'floor', false),
  box(-6, 1.5, 0, 0.35, 3, 10, 'wall'),
  box(7, 1.5, 0, 0.35, 3, 10, 'wall'),
  box(0.5, 1.5, -5, 13, 3, 0.35, 'wall'),
  box(0.5, 1.5, 5, 13, 3, 0.35, 'wall'),
  box(0, 1.5, -3.25, 0.35, 3, 3.5, 'wall'),
  box(0, 1.5, 3.25, 0.35, 3, 3.5, 'wall'),
];

const stairsAndUpper: GreyboxBox[] = [
  box(-4.4, 1.45, 2.2, 4.1, 0.22, 1.5, 'stair', false, 0.63),
  box(4.7, 1.45, -2.1, 4.1, 0.22, 1.5, 'stair', false, 0.63),
  box(0.5, 2.9, 0, 12.2, 0.22, 8.7, 'upperFloor', false),
  box(-5.6, 4.4, 0, 0.35, 3, 8.8, 'wall'),
  box(6.6, 4.4, 0, 0.35, 3, 8.8, 'wall'),
  box(0.5, 4.4, -4.4, 12.2, 3, 0.35, 'wall'),
  box(0.5, 4.4, 4.4, 12.2, 3, 0.35, 'wall'),
];

const landmarkBlocks: GreyboxBox[] = [
  box(-2.2, 0.75, -1.4, 1.8, 1.5, 1.2, 'barrier'),
  box(3.8, 0.65, 1.8, 2.4, 1.3, 1.0, 'barrier'),
  box(2.5, 3.45, 0.8, 1.6, 1.0, 1.2, 'barrier'),
];

export const NACHT_GREYBOX = [...groundShell, ...stairsAndUpper, ...landmarkBlocks] as const;
export const NACHT_WALK_SURFACES: readonly WalkSurface[] = [
  { minX: -5.8, maxX: 6.8, minZ: -4.8, maxZ: 4.8, startHeight: 0, endHeight: 0 },
  { minX: -5.5, maxX: -3.3, minZ: 1.45, maxZ: 2.95, startHeight: 0, endHeight: 2.9, slopeAxis: 'x' },
  { minX: 3.6, maxX: 5.8, minZ: -2.85, maxZ: -1.35, startHeight: 0, endHeight: 2.9, slopeAxis: 'x' },
  { minX: -5.6, maxX: 6.6, minZ: -4.4, maxZ: 4.4, startHeight: 2.9, endHeight: 2.9 },
];

export const NACHT_MARKERS: readonly MapMarker[] = [
  { id: 'spawn-south-west', type: 'zombieSpawn', position: { x: -4.5, y: 0, z: 5.8 }, label: 'Starting Room south window' },
  { id: 'spawn-west', type: 'zombieSpawn', position: { x: -6.8, y: 0, z: 0.5 }, label: 'Starting Room west window' },
  { id: 'spawn-help-east', type: 'zombieSpawn', position: { x: 7.8, y: 0, z: 1.8 }, label: 'Help Room east window' },
  { id: 'spawn-help-north', type: 'zombieSpawn', position: { x: 3.5, y: 0, z: -5.8 }, label: 'Help Room north window' },
  { id: 'door-help', type: 'door', position: { x: 0, y: 0, z: 0 }, label: 'Help Room door' },
  { id: 'wallbuy-start', type: 'wallBuy', position: { x: -5.5, y: 1.1, z: -2.2 }, label: 'Starting Room wall weapon' },
  { id: 'wallbuy-help', type: 'wallBuy', position: { x: 6.5, y: 1.1, z: 2.4 }, label: 'Help Room wall weapon' },
  { id: 'box-help', type: 'mysteryBox', position: { x: 4.5, y: 0, z: 0 }, label: 'Help Room mystery box' },
];

export const NACHT_PLAYER_SPAWN: Vec3 = { x: -2.8, y: 0, z: 1.2 };
export function greyboxCollisionBoxes(boxes: readonly GreyboxBox[] = NACHT_GREYBOX): CollisionBox[] {
  return boxes
    .filter((entry) => entry.collides)
    .map((entry) => ({
      min: {
        x: entry.center.x - entry.size.x / 2,
        y: entry.center.y - entry.size.y / 2,
        z: entry.center.z - entry.size.z / 2,
      },
      max: {
        x: entry.center.x + entry.size.x / 2,
        y: entry.center.y + entry.size.y / 2,
        z: entry.center.z + entry.size.z / 2,
      },
    }));
}
