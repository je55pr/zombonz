import type { CollisionBox, WalkSurface } from '../core/collision.ts';
import type { NavigationGraph, NavigationNode } from '../core/navigation.ts';
import type { DoorDefinition } from '../core/door.ts';
import type { WallWeaponDefinition } from '../core/wallWeapon.ts';
import type { MysteryBoxDefinition } from '../core/mysteryBox.ts';
import type { Vec3 } from '../core/types.ts';

// Original Nacht room connections, with approximate dimensions and original art.
export const UPPER_HEIGHT = 3.4;
export type GreyboxMaterial = 'wall' | 'floor' | 'upperFloor' | 'stair' | 'barrier' | 'metal';
export interface GreyboxBox {
  center: Vec3; size: Vec3; material: GreyboxMaterial; collides?: boolean; rotationZ?: number;
}
export interface MapMarker {
  id: string; type: 'zombieSpawn' | 'door' | 'wallBuy' | 'mysteryBox'; position: Vec3; label: string;
}
export interface BunkerWindow { x: number; z: number; y: number; axis: 'x' | 'z'; width: number }
const box = (x: number, y: number, z: number, sx: number, sy: number, sz: number,
  material: GreyboxMaterial, collides = true): GreyboxBox => ({
  center: { x, y, z }, size: { x: sx, y: sy, z: sz }, material, collides,
});
const shell: GreyboxBox[] = [];
const windows: BunkerWindow[] = [];
function windowWall(axis: 'x' | 'z', fixed: number, from: number, to: number,
  base: number, openings: number[]): void {
  const segment = (a: number, b: number, low: number, height: number) => {
    if (b <= a) return;
    shell.push(axis === 'x'
      ? box((a + b) / 2, low + height / 2, fixed, b - a, height, 0.4, 'wall')
      : box(fixed, low + height / 2, (a + b) / 2, 0.4, height, b - a, 'wall'));
  };
  let cursor = from;
  for (const center of openings) {
    segment(cursor, center - 1, base, 3.4);
    segment(center - 1, center + 1, base, 0.9);
    segment(center - 1, center + 1, base + 2.6, 0.8);
    windows.push({ x: axis === 'x' ? center : fixed, z: axis === 'x' ? fixed : center,
      y: base, axis, width: 2 });
    cursor = center + 1;
  }
  segment(cursor, to, base, 3.4);
}
windowWall('x', -7, -8, 8, 0, [-5, -2, 3, 6]);
windowWall('x', 7, -8, 8, 0, [-3, 3]);
windowWall('z', -8, -7, 7, 0, [-3]);
windowWall('z', 8, -7, 7, 0, [2, 5]);
windowWall('x', -7, -8, 8, UPPER_HEIGHT, [-4, 2, 6]);
windowWall('x', 7, -8, 8, UPPER_HEIGHT, [-3, 3]);
windowWall('z', -8, -7, 7, UPPER_HEIGHT, [-3]);
windowWall('z', 8, -7, 7, UPPER_HEIGHT, [3]);
export const NACHT_WINDOWS: readonly BunkerWindow[] = windows;
shell.push(box(0, 1.7, -4.1, 0.4, 3.4, 5.8, 'wall'));
shell.push(box(0, 1.7, 4.1, 0.4, 3.4, 5.8, 'wall'));
shell.push(box(0, 3.12, 0, 0.4, 0.56, 2.4, 'wall'));
shell.push(box(0, -0.12, 0, 16, 0.24, 14, 'floor', false));
// Real stairwell holes; the floor no longer cuts across the player's head.
const upperRects = [
  [-5.15, 5.15, -6.8, 6.8],
  [-7.8, -5.15, -6.8, 0.5], [-7.8, -5.15, 6, 6.8],
  [5.15, 7.8, -0.5, 6.8], [5.15, 7.8, -6.8, -6],
] as const;
for (const [minX, maxX, minZ, maxZ] of upperRects) {
  shell.push(box((minX + maxX) / 2, UPPER_HEIGHT - 0.12, (minZ + maxZ) / 2,
    maxX - minX, 0.24, maxZ - minZ, 'upperFloor', false));
}
shell.push(box(0, 5.1, -4.9, 0.35, 3.4, 3.8, 'wall'));
shell.push(box(0, 5.1, 5.6, 0.35, 3.4, 2.4, 'wall'));
export const NACHT_STAIRS = [
  { id: 'start-stairs', x: -6.45, minZ: 0.5, maxZ: 6, startHeight: 0, endHeight: UPPER_HEIGHT },
  { id: 'help-stairs', x: 6.45, minZ: -6, maxZ: -0.5, startHeight: UPPER_HEIGHT, endHeight: 0 },
] as const;
for (const stair of NACHT_STAIRS) {
  for (let step = 0; step < 20; step += 1) {
    const z = stair.minZ + (step + 0.5) * 5.5 / 20;
    const h = stair.startHeight + (stair.endHeight - stair.startHeight) * (step + 0.5) / 20;
    shell.push(box(stair.x, h - 0.09, z, 2.2, 0.18, 5.5 / 20, 'stair', false));
  }
  for (const x of [stair.x - 1.25, stair.x + 1.25]) {
    shell.push(box(x, 1.7, (stair.minZ + stair.maxZ) / 2, 0.18, 3.4, 5.5, 'wall'));
    shell.push(box(x, 3.88, (stair.minZ + stair.maxZ) / 2, 0.12, 0.96, 5.5, 'metal'));
  }
}
shell.push(box(-3.3, 0.55, -3.4, 2.4, 1.1, 0.8, 'barrier'));
shell.push(box(1.2, 0.5, 4.9, 1.4, 1, 1, 'barrier'));
shell.push(box(2.6, 3.9, 3, 2, 1, 0.9, 'barrier'));
shell.push(box(1.1, 0.52, -4.4, 0.95, 1.04, 2.35, 'barrier'));
export const NACHT_GREYBOX: readonly GreyboxBox[] = shell;
export const NACHT_WALK_SURFACES: readonly WalkSurface[] = [
  { minX: -7.8, maxX: 7.8, minZ: -6.8, maxZ: 6.8, startHeight: 0, endHeight: 0 },
  ...upperRects.map(([minX, maxX, minZ, maxZ]) => ({
    minX, maxX, minZ, maxZ, startHeight: UPPER_HEIGHT, endHeight: UPPER_HEIGHT,
  })),
  ...NACHT_STAIRS.map(stair => ({ minX: stair.x - 1.1, maxX: stair.x + 1.1,
    minZ: stair.minZ, maxZ: stair.maxZ, startHeight: stair.startHeight,
    endHeight: stair.endHeight, slopeAxis: 'z' as const })),
];
export const NACHT_DOORS: readonly DoorDefinition[] = [
  { id: 'help-room', position: { x: 0, y: 0, z: 0 }, cost: 1000,
    prompt: 'E  Open HELP room  [1000]', interactionRange: 2.6, minFacingDot: 0.3,
    blocker: { min: { x: -0.2, y: 0, z: -1.2 }, max: { x: 0.2, y: 2.85, z: 1.2 } } },
  ...NACHT_STAIRS.map(stair => ({ id: stair.id,
    position: { x: stair.x, y: 1.7, z: (stair.minZ + stair.maxZ) / 2 }, cost: 1000,
    prompt: 'E  Clear stair debris  [1000]', interactionRange: 2.8, minFacingDot: 0.2,
    blocker: { min: { x: stair.x - 1.15, y: 0, z: (stair.minZ + stair.maxZ) / 2 - 0.5 },
      max: { x: stair.x + 1.15, y: 4.5, z: (stair.minZ + stair.maxZ) / 2 + 0.5 } } })),
];
export const NACHT_WALL_WEAPONS: readonly WallWeaponDefinition[] = [
  { id: 'start-kar98k', position: { x: -7.6, y: 1, z: -5.2 }, weaponId: 'kar98k',
    weaponCost: 200, ammoCost: 100, prompt: 'E  Kar98k [200] / Ammo [100]', interactionRange: 2.5, minFacingDot: 0.25 },
  { id: 'help-thompson', position: { x: 7.6, y: 1, z: 0.1 }, weaponId: 'thompson',
    weaponCost: 1200, ammoCost: 600, prompt: 'E  Thompson [1200] / Ammo [600]', interactionRange: 2.5, minFacingDot: 0.25 },
];
export const NACHT_MYSTERY_BOXES: readonly MysteryBoxDefinition[] = [{
  id: 'help-box', position: { x: 1.85, y: 0.6, z: -4.4 }, cost: 950,
  weapons: ['kar98k', 'thompson', 'mp40', 'bar'],
}];
export const NACHT_PLAYER_SPAWN: Vec3 = { x: -4, y: 0, z: 3 };
// Vaulting and repair are future systems: spawns are just inside the windows.
export const NACHT_ZOMBIE_SPAWNS: readonly Vec3[] = [
  { x: -5, y: 0, z: -6.1 }, { x: -2, y: 0, z: -6.1 },
  { x: -7.1, y: 0, z: -3 }, { x: -3, y: 0, z: 6.1 },
  { x: 3, y: 0, z: -6.1 }, { x: 7.1, y: 0, z: 2 },
  { x: 3, y: UPPER_HEIGHT, z: 6.1 }, { x: -4, y: UPPER_HEIGHT, z: -6.1 },
];
export const NACHT_MARKERS: readonly MapMarker[] = [
  ...NACHT_ZOMBIE_SPAWNS.map((position, index) => ({ id: `window-${index}`,
    type: 'zombieSpawn' as const, position, label: 'Barricaded window' })),
  ...NACHT_DOORS.map(door => ({ id: door.id, type: 'door' as const, position: door.position, label: door.prompt! })),
  ...NACHT_WALL_WEAPONS.map(weapon => ({ id: weapon.id, type: 'wallBuy' as const, position: weapon.position, label: weapon.prompt! })),
  { id: 'box-help', type: 'mysteryBox', position: NACHT_MYSTERY_BOXES[0].position, label: 'Mystery Box [950]' },
];
export function greyboxCollisionBoxes(boxes: readonly GreyboxBox[] = NACHT_GREYBOX): CollisionBox[] {
  return boxes.filter(entry => entry.collides).map(entry => ({
    min: { x: entry.center.x - entry.size.x / 2, y: entry.center.y - entry.size.y / 2, z: entry.center.z - entry.size.z / 2 },
    max: { x: entry.center.x + entry.size.x / 2,
      y: entry.center.y + entry.size.y / 2 - (entry.material === 'upperFloor' ? 0.001 : 0),
      z: entry.center.z + entry.size.z / 2 },
  }));
}
// Slabs occlude bullets, but ramp movement uses walk surfaces to step onto landings.
export const NACHT_SHOT_BLOCKERS = greyboxCollisionBoxes(NACHT_GREYBOX
  .filter(box => box.material === 'upperFloor').map(box => ({ ...box, collides: true })));
const nodes: NavigationNode[] = [];
const add = (id: string, x: number, y: number, z: number) => nodes.push({ id, position: { x, y, z }, neighbors: [] });
const link = (a: string, b: string) => {
  (nodes.find(node => node.id === a)!.neighbors as string[]).push(b);
  (nodes.find(node => node.id === b)!.neighbors as string[]).push(a);
};
for (const [prefix, y] of [['g', 0], ['u', UPPER_HEIGHT]] as const) {
  for (const [id, x, z] of [
    ['sw', -6.45, -1], ['s', -3, 0], ['sn', -5, -5.5], ['se', -1, -5.5],
    ['ss', -3, 5.9], ['sd', -1, 0], ['hd', 1, 0], ['h', 3.4, 0],
    ['hn', 3.4, -5.5], ['hs', 3.4, 5.9], ['he', 6.45, 1],
  ] as const) add(`${prefix}-${id}`, x, y, z);
  for (const [a, b] of [['sw', 's'], ['sw', 'sn'], ['sn', 'se'], ['se', 'sd'],
    ['s', 'sd'], ['s', 'ss'], ['sd', 'hd'], ['hd', 'h'], ['h', 'hn'], ['h', 'he'], ['he', 'hs']] as const) {
    link(`${prefix}-${a}`, `${prefix}-${b}`);
  }
}
for (const stair of NACHT_STAIRS) {
  const ascending = stair.endHeight > stair.startHeight;
  for (let i = 0; i <= 11; i++) {
    const z = ascending ? stair.minZ + i * 0.5 : stair.maxZ - i * 0.5;
    add(`${stair.id}-${i}`, stair.x, UPPER_HEIGHT * i / 11, z);
    if (i > 0) link(`${stair.id}-${i - 1}`, `${stair.id}-${i}`);
  }
  const bottomZ = ascending ? stair.minZ - 0.6 : stair.maxZ + 0.6;
  const topZ = ascending ? stair.maxZ + 0.45 : stair.minZ - 0.45;
  add(`${stair.id}-base`, stair.x, 0, bottomZ);
  add(`${stair.id}-landing`, stair.x, UPPER_HEIGHT, topZ);
  add(`${stair.id}-exit`, ascending ? -4.5 : 4.5, UPPER_HEIGHT, topZ);
  link(`${stair.id}-base`, `${stair.id}-0`);
  link(`${stair.id}-11`, `${stair.id}-landing`);
  link(`${stair.id}-landing`, `${stair.id}-exit`);
  link(`${stair.id}-base`, ascending ? 'g-sw' : 'g-he');
  link(`${stair.id}-exit`, ascending ? 'u-ss' : 'u-hn');
}
export const NACHT_NAVIGATION: NavigationGraph = { nodes };
