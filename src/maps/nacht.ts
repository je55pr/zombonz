import { walkSurfaceHeight, sampleWalkHeight, type CollisionBox, type WalkSurface } from '../core/collision.ts';
import { hasClearNavigationLine, hasWalkableConnection, type NavigationGraph, type NavigationNode } from '../core/navigation.ts';
import type { DoorDefinition } from '../core/door.ts';
import type { WallWeaponDefinition } from '../core/wallWeapon.ts';
import type { MysteryBoxDefinition } from '../core/mysteryBox.ts';
import type { Vec3 } from '../core/types.ts';
import type { BarrierDefinition } from '../core/barrier.ts';
import type { ZombieSpawnPoint } from '../core/spawning.ts';
import { NACHT_PROPS, propCollisionBox } from './nachtProps.ts';

// Hand-built from WaW floor plans. Scale is estimated, not extracted game data.
// HELP wing west (negative x), spawn east, box at the south end of HELP.
export const UPPER_HEIGHT = 3.4;
export type GreyboxMaterial = 'wall' | 'floor' | 'upperFloor' | 'stair' | 'barrier' | 'metal';
export interface GreyboxBox {
  center: Vec3; size: Vec3; material: GreyboxMaterial; collides?: boolean; rotationZ?: number; visible?: boolean;
}
export interface GreyboxPrism {
  points: readonly (readonly [number, number])[]; bottom: number; top: number; material: GreyboxMaterial;
}
export interface MapMarker {
  id: string; type: 'zombieSpawn' | 'door' | 'wallBuy' | 'mysteryBox'; position: Vec3; label: string;
}
export interface BunkerWindow {
  id: string; x: number; z: number; y: number; axis: 'x' | 'z'; width: number; outward: Vec3;
}
const box = (x: number, y: number, z: number, sx: number, sy: number, sz: number,
  material: GreyboxMaterial, collides = true): GreyboxBox => ({
  center: { x, y, z }, size: { x: sx, y: sy, z: sz }, material, collides,
});
const shell: GreyboxBox[] = [], prisms: GreyboxPrism[] = [], windows: BunkerWindow[] = [];
export const NACHT_RAILS: { from: Vec3; to: Vec3 }[] = [];
const surfaces: WalkSurface[] = [];
const rect = (minX: number, maxX: number, minZ: number, maxZ: number, height: number): WalkSurface =>
  ({ minX, maxX, minZ, maxZ, startHeight: height, endHeight: height });
function floor(surface: WalkSurface, material: GreyboxMaterial): void {
  surfaces.push(surface);
  if (surface.polygon) prisms.push({ points: surface.polygon, bottom: surface.startHeight - 0.24, top: surface.startHeight, material });
  else shell.push(box((surface.minX + surface.maxX) / 2, surface.startHeight - 0.12,
    (surface.minZ + surface.maxZ) / 2, surface.maxX - surface.minX, 0.24, surface.maxZ - surface.minZ, material, false));
}
function wall(axis: 'x' | 'z', fixed: number, from: number, to: number, base: number,
  openings: readonly (readonly [number, number, string])[] = [], outward = 1, height = 3.4): void {
  const segment = (a: number, b: number, low: number, h: number) => {
    if (b <= a || h <= 0) return;
    shell.push(axis === 'x' ? box((a + b) / 2, low + h / 2, fixed, b - a, h, 0.4, 'wall')
      : box(fixed, low + h / 2, (a + b) / 2, 0.4, h, b - a, 'wall'));
  };
  let cursor = from;
  for (const [center, width, id] of openings) {
    segment(cursor, center - width / 2, base, height);
    segment(center - width / 2, center + width / 2, base, 0.85);
    segment(center - width / 2, center + width / 2, base + 2.65, height - 2.65);
    windows.push({ id, x: axis === 'x' ? center : fixed, z: axis === 'x' ? fixed : center,
      y: base, axis, width, outward: axis === 'x' ? { x: 0, y: 0, z: outward } : { x: outward, y: 0, z: 0 } });
    cursor = center + width / 2;
  }
  segment(cursor, to, base, height);
}
// Five spawn windows and the distinctive recessed south frontage.
wall('x', -2.6, 0, 18.2, 0, [[12, 1.5, 'start-north']], -1);
wall('z', 18.2, -2.6, 7.8, 0, [[-1.6, 1.2, 'start-east']], 1);
wall('x', 7.8, 0, 10.4, 0, [[2.1, 2.9, 'start-wide'], [9.3, 1.2, 'start-south']], 1);
wall('x', 7.8, 13.8, 18.2, 0, [[16.5, 1.2, 'start-corner']], 1);
wall('z', 10.4, 5.4, 7.8, 0); wall('x', 5.4, 10.4, 13.8, 0); wall('z', 13.8, 5.4, 7.8, 0);
// Long HELP wing: two windows plus the west-facing cave breach.
wall('x', -11, -6.2, 0, 0, [[-4.2, 1.2, 'help-north']], -1);
wall('z', 0, -11, -2.6, 0, [[-6, 1.25, 'help-east']], 1);
wall('z', -6.2, -11, 1.8, 0, [[0.7, 2.2, 'help-cave']], -1);
wall('z', -8, 1.8, 7.8, 0); wall('x', 1.8, -8, -6.2, 0); wall('x', 7.8, -8, 0, 0);
wall('z', 0, -2.6, -1.2, 0); wall('z', 0, 1.2, 7.8, 0);
shell.push(box(0, 3.1, 0, 0.4, 0.6, 2.4, 'wall'));
floor(rect(-6.2, 0, -11, 7.8, 0), 'floor'); floor(rect(-8, -6.2, 1.8, 7.8, 0), 'floor');
floor(rect(0, 18.2, -2.6, 5.4, 0), 'floor'); floor(rect(0, 10.4, 5.4, 7.8, 0), 'floor');
floor(rect(13.8, 18.2, 5.4, 7.8, 0), 'floor');

// The upstairs ends short of spawn's east/south edges, with an irregular stair hole.
floor(rect(-6.2, 0, -11, 5.4, UPPER_HEIGHT), 'upperFloor');
floor(rect(-8, -6.2, 0.4, 3.1, UPPER_HEIGHT), 'upperFloor');
floor(rect(-8, -4.8, 6.65, 7.8, UPPER_HEIGHT), 'upperFloor');
floor(rect(-6.2, -4.8, 5.4, 6.65, UPPER_HEIGHT), 'upperFloor');
floor(rect(0, 10.4, -4.7, -2.6, UPPER_HEIGHT), 'upperFloor');
floor({ ...rect(0, 10.4, -2.6, 5.4, UPPER_HEIGHT), polygon: [
  [0, -2.6], [4.8, -2.6], [4.8, 0.1], [5.8, 2.8], [8, 3.8], [10.4, 3.8], [10.4, 5.4], [0, 5.4],
] }, 'upperFloor');
wall('x', -11, -6.2, 0, UPPER_HEIGHT);
wall('z', -6.2, -11, 0.4, UPPER_HEIGHT, [[-9.8, 1.2, 'upper-help-north'], [-1.5, 1.25, 'upper-help-south']], -1);
wall('z', -8, 0.4, 7.8, UPPER_HEIGHT); wall('x', 0.4, -8, -6.2, UPPER_HEIGHT);
wall('x', 7.8, -8, -4.8, UPPER_HEIGHT); wall('z', -4.8, 5.4, 7.8, UPPER_HEIGHT);
wall('x', 5.4, -4.8, 10.4, UPPER_HEIGHT); wall('z', 0, -11, -4.7, UPPER_HEIGHT);
wall('x', -4.7, 0, 10.4, UPPER_HEIGHT, [[5.2, 1.5, 'upper-gallery']], -1);
wall('z', 10.4, -4.7, 5.4, UPPER_HEIGHT, [[4.6, 1.2, 'upper-east']], 1);
wall('z', 0, -4.7, -1.2, UPPER_HEIGHT); wall('z', 0, 0.4, 5.4, UPPER_HEIGHT);
function parapet(ax: number, az: number, bx: number, bz: number, bottom: number, height: number): void {
  const n = Math.ceil(Math.hypot(bx - ax, bz - az) / 0.18);
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    shell.push(box(ax + (bx - ax) * t, bottom + height / 2, az + (bz - az) * t,
      Math.abs(bx - ax) / n + 0.14, height, Math.abs(bz - az) / n + 0.14, 'wall'));
  }
}
for (const [ax, az, bx, bz] of [[4.8, -0.05, 4.8, 0.1], [4.8, 0.1, 5.8, 2.8],
  [5.8, 2.8, 8, 3.8], [8, 3.8, 10.4, 3.8]]) parapet(ax, az, bx, bz, UPPER_HEIGHT, 0.9);
// Concrete column rows, capitals and beams define the downstairs sightlines.
for (const x of [3.3, 7]) for (const z of [0.1, 2.9, 5.6]) {
  shell.push(box(x, 1.58, z, 0.62, 3.16, 0.62, 'wall'), box(x, 2.96, z, 0.95, 0.4, 0.95, 'wall'));
}
for (const z of [-7.4, -3.8, -0.2, 3.4]) {
  shell.push(box(-3.4, 1.58, z, 0.65, 3.16, 0.65, 'wall'), box(-3.4, 5, z, 0.65, 3.2, 0.65, 'wall'));
  shell.push(box(-3.1, 3.01, z, 6.2, 0.3, 0.6, 'wall'));
}
shell.push(box(3.3, 3.01, 2.6, 0.65, 0.3, 10.4, 'wall'));
shell.push(box(7, 3.01, 4.5, 0.65, 0.3, 6.6, 'wall'));
shell.push(box(-1.65, 5.1, -7.5, 0.45, 3.4, 4, 'wall'), box(-5.2, 5.1, -9.3, 2, 3.4, 0.28, 'wall'));
shell.push(box(-3.4, 4.35, -4.5, 1.2, 1.9, 0.55, 'barrier'));
shell.push(box(2.7, 4.9, -2.2, 0.7, 3, 0.9, 'wall'), box(3.3, 4.95, 3.4, 0.65, 3.1, 0.65, 'wall'));

// Quarter-turn fan stair, followed by a short westbound straight flight.
surfaces.push({ ...rect(7.2, 10.1, -1.9, 1, 0), endHeight: 2.2,
  quarterTurn: { x: 7.2, z: 1, innerRadius: 1.05, outerRadius: 2.9 } },
  { ...rect(4.8, 7.2, -1.9, -0.05, UPPER_HEIGHT), endHeight: 2.2, slopeAxis: 'x' });
for (let i = 0; i < 14; i++) {
  const a = -i / 14 * Math.PI / 2, b = -(i + 1) / 14 * Math.PI / 2;
  const p = (r: number, angle: number): readonly [number, number] => [7.2 + r * Math.cos(angle), 1 + r * Math.sin(angle)];
  const top = (i + 0.5) / 14 * 2.2;
  prisms.push({ points: [p(1.05, a), p(2.9, a), p(2.9, b), p(1.05, b)], bottom: top - 0.18, top, material: 'stair' });
  for (const r of [1.02, 2.94]) {
    const [x, z] = p(r, (a + b) / 2);
    shell.push({ ...box(x, top + 0.43, z, 0.26, 0.86, 0.26, 'metal'), visible: false });
    const [ax, az] = p(r, a), [bx, bz] = p(r, b);
    NACHT_RAILS.push({ from: { x: ax, y: i / 14 * 2.2 + 0.88, z: az },
      to: { x: bx, y: (i + 1) / 14 * 2.2 + 0.88, z: bz } });
  }
}
for (let i = 0; i < 8; i++) {
  const x = 4.8 + (i + 0.5) * 0.3, top = UPPER_HEIGHT - (i + 0.5) / 8 * 1.2;
  shell.push(box(x, top - 0.09, -0.975, 0.3, 0.18, 1.85, 'stair', false));
  for (const z of [-1.99, 0.04]) shell.push({ ...box(x, top + 0.43, z, 0.3, 0.86, 0.16, 'metal'), visible: false });
}
for (const z of [-1.99, 0.04]) NACHT_RAILS.push({ from: { x: 4.8, y: UPPER_HEIGHT + 0.88, z }, to: { x: 7.2, y: 3.08, z } });
// Compact HELP stair in a projecting west annex; top returns east then north.
surfaces.push({ ...rect(-7.8, -6.3, 3.1, 6.65, 0), endHeight: UPPER_HEIGHT, slopeAxis: 'z' });
for (let i = 0; i < 20; i++) shell.push(box(-7.05, (i + 0.5) / 20 * UPPER_HEIGHT - 0.085,
  3.1 + (i + 0.5) / 20 * 3.55, 1.5, 0.17, 3.55 / 20, 'stair', false));
shell.push(box(-6.25, 1.7, 4.875, 0.16, 3.4, 3.55, 'wall'), box(-6.25, 3.9, 4.875, 0.16, 1, 3.55, 'wall'));
const mainRoute: Vec3[] = [{ x: 9.2, y: 0, z: 1.65 }];
for (let i = 0; i <= 14; i++) {
  const a = -i / 14 * Math.PI / 2;
  mainRoute.push({ x: 7.2 + 2 * Math.cos(a), y: i / 14 * 2.2, z: 1 + 2 * Math.sin(a) });
}
for (let i = 1; i <= 8; i++) mainRoute.push({ x: 7.2 - i * 0.3, y: 2.2 + i / 8 * 1.2, z: -1 });
mainRoute.push({ x: 4.1, y: UPPER_HEIGHT, z: -1 });
const helpRoute: Vec3[] = [{ x: -7.05, y: 0, z: 2.5 }];
for (let i = 0; i <= 16; i++) helpRoute.push({ x: -7.05, y: UPPER_HEIGHT * i / 16, z: 3.1 + 3.55 * i / 16 });
helpRoute.push({ x: -7.05, y: UPPER_HEIGHT, z: 7.15 }, { x: -5.5, y: UPPER_HEIGHT, z: 7.15 });
export const NACHT_STAIRS = [{ id: 'start-stairs', route: mainRoute }, { id: 'help-stairs', route: helpRoute }] as const;
export const NACHT_BOX_CENTER: Vec3 = { x: -1.45, y: 0.52, z: 7.12 };
shell.push(box(-1.45, 0.52, 7.12, 2.35, 1.04, 0.95, 'barrier'));
// Large broken roof apertures, not uniformly repeated slats.
for (const [x, z, sx, sz] of [[-5.5, -3, 1.2, 16], [-0.6, -7.6, 1.2, 6.8], [-3.1, -10.4, 6.2, 1.2],
  [-3.1, 4.7, 6.2, 1.3], [4.5, 4.9, 9, 1], [0.8, 1.2, 1.5, 7.6], [6, -4.15, 8.8, 1.1]])
  shell.push(box(x, 6.7, z, sx, 0.26, sz, 'wall'));
shell.push(box(14.4, 3.27, 1.4, 7.6, 0.26, 8, 'wall'), box(5.2, 3.27, 6.6, 10.4, 0.26, 2.4, 'wall'));
shell.push(box(-2.4, 3.27, 6.6, 4.8, 0.26, 2.4, 'wall'));
// Collapsed tunnel outside the HELP breach, visibly separate from the other windows.
shell.push(box(-9.4, -0.12, 0.7, 6.4, 0.24, 3.6, 'floor', false));
shell.push(box(-9.4, 1.3, -1.1, 6.4, 2.6, 0.55, 'wall'));
shell.push(box(-10.35, 1.3, 2.5, 4.3, 2.6, 0.55, 'wall'));
shell.push(box(-8.25, 1.3, 2.15, 0.3, 2.6, 0.7, 'wall'));
shell.push(box(-12.5, 1.3, 0.7, 0.5, 2.6, 3.6, 'wall'));
shell.push(box(-9.4, 2.8, 0.7, 6.4, 0.4, 3.6, 'wall'));

export const NACHT_WINDOWS: readonly BunkerWindow[] = windows;
export const NACHT_GREYBOX: readonly GreyboxBox[] = shell;
export const NACHT_PRISMS: readonly GreyboxPrism[] = prisms;
export const NACHT_WALK_SURFACES: readonly WalkSurface[] = surfaces;
export const NACHT_DOORS: readonly DoorDefinition[] = [
  { id: 'help-room', position: { x: 0, y: 0, z: 0 }, cost: 1000,
    prompt: 'E  Open HELP room  [1000]', interactionRange: 2.6, minFacingDot: 0.3,
    blocker: { min: { x: -0.2, y: 0, z: -1.2 }, max: { x: 0.2, y: 2.85, z: 1.2 } } },
  { id: 'start-stairs', position: { x: 6, y: 2.8, z: -1 }, cost: 1000,
    prompt: 'E  Clear stair debris  [1000]', interactionRange: 2.8, minFacingDot: 0.2,
    blocker: { min: { x: 5.6, y: 2.2, z: -2 }, max: { x: 6.4, y: 5.7, z: 0.1 } } },
  { id: 'help-stairs', position: { x: -7.05, y: 1.7, z: 4.875 }, cost: 1000,
    prompt: 'E  Clear stair debris  [1000]', interactionRange: 2.8, minFacingDot: 0.2,
    blocker: { min: { x: -7.85, y: 0, z: 4.5 }, max: { x: -6.25, y: 4.5, z: 5.25 } } },
];
export const NACHT_WALL_WEAPONS: readonly WallWeaponDefinition[] = [
  { id: 'start-kar98k', position: { x: 5.2, y: 1, z: 7.56 }, weaponId: 'kar98k',
    weaponCost: 200, ammoCost: 100, prompt: 'E  Kar98k [200] / Ammo [100]', interactionRange: 2.5, minFacingDot: 0.25 },
  { id: 'help-thompson', position: { x: -5.96, y: 1, z: -9.4 }, weaponId: 'thompson',
    weaponCost: 1200, ammoCost: 600, prompt: 'E  Thompson [1200] / Ammo [600]', interactionRange: 2.5, minFacingDot: 0.25 },
];
export const NACHT_MYSTERY_BOXES: readonly MysteryBoxDefinition[] = [{
  id: 'help-box', position: { x: -1.45, y: 0.6, z: 6.35 }, cost: 950,
  weapons: ['kar98k', 'thompson', 'mp40', 'bar'],
}];
export const NACHT_PLAYER_SPAWN: Vec3 = { x: 5.2, y: 0, z: 4.2 };
// Upper windows stay decorative until exterior climbing is implemented.
export const NACHT_BARRIERS: readonly BarrierDefinition[] = windows.filter(w => w.y === 0).map(w => {
  const point = (distance: number, sideways = 0): Vec3 => ({
    x: w.x + w.outward.x * distance + w.outward.z * sideways, y: w.y,
    z: w.z + w.outward.z * distance - w.outward.x * sideways,
  });
  return { id: w.id, position: { x: w.x, y: w.y, z: w.z }, outward: w.outward, width: w.width, maxBoards: 3,
    approachPath: [point(5, 0.6), point(2.4, 0.6), point(0.85)], insidePoint: point(-0.95) };
});
export const NACHT_ZOMBIE_SPAWNS: readonly ZombieSpawnPoint[] = NACHT_BARRIERS.map(b => ({ ...b.approachPath[0], barrierId: b.id }));
export const NACHT_MARKERS: readonly MapMarker[] = [
  ...NACHT_BARRIERS.map(b => ({ id: b.id, type: 'zombieSpawn' as const, position: b.approachPath[0], label: 'Barricaded entry' })),
  ...NACHT_DOORS.map(d => ({ id: d.id, type: 'door' as const, position: d.position, label: d.prompt! })),
  ...NACHT_WALL_WEAPONS.map(w => ({ id: w.id, type: 'wallBuy' as const, position: w.position, label: w.prompt! })),
  { id: 'box-help', type: 'mysteryBox', position: NACHT_MYSTERY_BOXES[0].position, label: 'Mystery Box [950]' },
];
export function greyboxCollisionBoxes(boxes: readonly GreyboxBox[] = NACHT_GREYBOX): CollisionBox[] {
  const result = boxes.filter(b => b.collides).map(b => ({
    min: { x: b.center.x - b.size.x / 2, y: b.center.y - b.size.y / 2, z: b.center.z - b.size.z / 2 },
    max: { x: b.center.x + b.size.x / 2, y: b.center.y + b.size.y / 2, z: b.center.z + b.size.z / 2 },
  }));
  if (boxes === NACHT_GREYBOX) result.push(...NACHT_PROPS.filter(p => p.solid).map(propCollisionBox));
  return result;
}
// Rectangular slabs stay single blockers; only the bevelled floor needs narrow strips.
const slabBlockers: CollisionBox[] = [];
for (const s of surfaces.filter(s => s.startHeight === UPPER_HEIGHT && s.endHeight === UPPER_HEIGHT)) {
  if (!s.polygon) slabBlockers.push({ min: { x: s.minX, y: UPPER_HEIGHT - 0.24, z: s.minZ }, max: { x: s.maxX, y: UPPER_HEIGHT, z: s.maxZ } });
  else for (let z = s.minZ; z < s.maxZ; z += 0.1) {
    let end = s.minX;
    for (let x = s.minX; x < s.maxX; x += 0.05) {
      if (walkSurfaceHeight(s, x, z + 0.05) === undefined) break;
      end = x;
    }
    slabBlockers.push({ min: { x: s.minX, y: UPPER_HEIGHT - 0.24, z }, max: { x: end, y: UPPER_HEIGHT, z: Math.min(z + 0.1, s.maxZ) } });
  }
}
export const NACHT_SHOT_BLOCKERS: readonly CollisionBox[] = slabBlockers;

// Sparse floor grid + exact stair centre-lines, compiled once from real geometry.
const nodes: NavigationNode[] = [], collision = greyboxCollisionBoxes();
function add(id: string, position: Vec3): void {
  if (hasClearNavigationLine(position, position, collision, 0.34)) nodes.push({ id, position, neighbors: [] });
}
for (const y of [0, UPPER_HEIGHT]) for (let x = -7; x < 18; x += 1.5) for (let z = -10; z < 7.8; z += 1.5) {
  if (sampleWalkHeight(x, z, y, surfaces) === y
    && surfaces.some(s => s.startHeight === y && s.endHeight === y && walkSurfaceHeight(s, x, z) === y))
    add(`floor-${y}-${x}-${z}`, { x, y, z });
}
for (const stair of NACHT_STAIRS) stair.route.forEach((p, i) => add(`${stair.id}-${i}`, p));
for (const b of NACHT_BARRIERS) add(b.id, b.insidePoint);
for (const [id, p] of Object.entries({ spawn: NACHT_PLAYER_SPAWN, helpWest: { x: -1, y: 0, z: 0 },
  helpEast: { x: 1, y: 0, z: 0 }, upperWest: { x: -1, y: UPPER_HEIGHT, z: -0.4 },
  upperEast: { x: 1, y: UPPER_HEIGHT, z: -0.4 }, annexBase: { x: -5.5, y: 0, z: 2.5 },
  annexTop: { x: -5.5, y: UPPER_HEIGHT, z: 4.5 } })) add(id, p);
for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
  const a = nodes[i], b = nodes[j];
  if (Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z) > 3.2) continue;
  if (hasClearNavigationLine(a.position, b.position, collision, 0.34)
    && hasWalkableConnection(a.position, b.position, surfaces) && hasWalkableConnection(b.position, a.position, surfaces)) {
    (a.neighbors as string[]).push(b.id); (b.neighbors as string[]).push(a.id);
  }
}
export const NACHT_NAVIGATION: NavigationGraph = { nodes };
