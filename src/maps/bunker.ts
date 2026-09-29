import { walkSurfaceHeight, sampleWalkHeight, type CollisionBox, type WalkSurface } from '../core/collision.ts';
import { hasClearNavigationLine, hasWalkableConnection, type NavigationGraph, type NavigationNode } from '../core/navigation.ts';
import { doorPrompt, type DoorDefinition } from '../core/door.ts';
import type { WallWeaponDefinition } from '../core/wallWeapon.ts';
import type { MysteryBoxDefinition } from '../core/mysteryBox.ts';
import type { Vec3 } from '../core/types.ts';
import type { BarrierDefinition } from '../core/barrier.ts';
import type { ZombieSpawnPoint } from '../core/spawning.ts';
import { BUNKER_HAZARDS, BUNKER_OUTSIDE_PROPS, BUNKER_PROPS, propCollisionBox } from './bunkerProps.ts';
import { hazardBox } from '../core/hazard.ts';
import type { EquipmentBuyDefinition } from '../core/equipment.ts';
import { barriersFromWindows, entrySpawns, windowPoint } from './mapBuild.ts';
import { Scenery, onGround } from './scenery.ts';
import { ps, px, pz } from './bunkerPlan.ts';
import { STAIR_DEPTH } from './gameMap.ts';
import { BUNKER_DECALS } from './bunkerProps.ts';
import type { GameMap, GreyboxBox, GreyboxMaterial, GreyboxPrism, MapMarker, MapWindow } from './gameMap.ts';

// Hand-built from WaW floor plans, authored in blockout coordinates and mapped out by bunkerPlan
// (px/pz for positions, ps for the main stair). HELP wing west (negative x), spawn east, box at the
// south end of HELP.
export const UPPER_HEIGHT = 3.4;
export type { GreyboxBox, GreyboxMaterial, GreyboxPrism, MapMarker } from './gameMap.ts';
export type BunkerWindow = MapWindow;
/** A box in built-map coordinates. */
const box = (x: number, y: number, z: number, sx: number, sy: number, sz: number,
  material: GreyboxMaterial, collides = true): GreyboxBox => ({
  center: { x, y, z }, size: { x: sx, y: sy, z: sz }, material, collides,
});
/** A box authored in blockout coordinates: long sides stretch with the plan, thin ones keep their size. */
function planBox(x: number, y: number, z: number, sx: number, sy: number, sz: number,
  material: GreyboxMaterial, collides = true): GreyboxBox {
  const [cx, wx] = sx > 1 ? [(px(x - sx / 2) + px(x + sx / 2)) / 2, px(x + sx / 2) - px(x - sx / 2)] : [px(x), sx];
  const [cz, wz] = sz > 1 ? [(pz(z - sz / 2) + pz(z + sz / 2)) / 2, pz(z + sz / 2) - pz(z - sz / 2)] : [pz(z), sz];
  return box(cx, y, cz, wx, sy, wz, material, collides);
}
const shell: GreyboxBox[] = [], prisms: GreyboxPrism[] = [], windows: BunkerWindow[] = [];
export const BUNKER_RAILS: { from: Vec3; to: Vec3 }[] = [];
const surfaces: WalkSurface[] = [];
const rect = (minX: number, maxX: number, minZ: number, maxZ: number, height: number): WalkSurface =>
  ({ minX, maxX, minZ, maxZ, startHeight: height, endHeight: height });
/** A floor rectangle authored in blockout coordinates. */
const planRect = (minX: number, maxX: number, minZ: number, maxZ: number, height: number): WalkSurface =>
  rect(px(minX), px(maxX), pz(minZ), pz(maxZ), height);
function floor(surface: WalkSurface, material: GreyboxMaterial): void {
  surfaces.push(surface);
  if (surface.polygon) prisms.push({ points: surface.polygon, bottom: surface.startHeight - 0.24, top: surface.startHeight, material });
  else shell.push(box((surface.minX + surface.maxX) / 2, surface.startHeight - 0.12,
    (surface.minZ + surface.maxZ) / 2, surface.maxX - surface.minX, 0.24, surface.maxZ - surface.minZ, material, false));
}
/** A wall in built-map coordinates; openings are [centre, width, window id]. */
function wallAt(axis: 'x' | 'z', fixed: number, from: number, to: number, base: number,
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
/** A wall authored in blockout coordinates; window centres move with the plan, their widths don't. */
function wall(axis: 'x' | 'z', fixed: number, from: number, to: number, base: number,
  openings: readonly (readonly [number, number, string])[] = [], outward = 1, height = 3.4): void {
  const along = axis === 'x' ? px : pz, across = axis === 'x' ? pz : px;
  wallAt(axis, across(fixed), along(from), along(to), base,
    openings.map(([center, width, id]) => [along(center), width, id] as const), outward, height);
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
// The HELP doorway keeps its real 2.4 m width, centred on z = 0.
wallAt('z', 0, pz(-2.6), -1.2, 0); wallAt('z', 0, 1.2, pz(7.8), 0);
shell.push(box(0, 3.1, 0, 0.4, 0.6, 2.4, 'wall'));
floor(planRect(-6.2, 0, -11, 7.8, 0), 'floor'); floor(planRect(-8, -6.2, 1.8, 7.8, 0), 'floor');
floor(planRect(0, 18.2, -2.6, 5.4, 0), 'floor'); floor(planRect(0, 10.4, 5.4, 7.8, 0), 'floor');
floor(planRect(13.8, 18.2, 5.4, 7.8, 0), 'floor');

// The upstairs ends short of spawn's east/south edges, with an irregular stair hole.
floor(planRect(-6.2, 0, -11, 5.4, UPPER_HEIGHT), 'upperFloor');
floor(planRect(-8, -6.2, 0.4, 3.1, UPPER_HEIGHT), 'upperFloor');
floor(planRect(-8, -4.8, 6.65, 7.8, UPPER_HEIGHT), 'upperFloor');
floor(planRect(-6.2, -4.8, 5.4, 6.65, UPPER_HEIGHT), 'upperFloor');
floor(planRect(0, 10.4, -4.7, -2.6, UPPER_HEIGHT), 'upperFloor');
floor({ ...planRect(0, 10.4, -2.6, 5.4, UPPER_HEIGHT), polygon: ([
  [0, -2.6], [4.8, -2.6], [4.8, 0.1], [5.8, 2.8], [8, 3.8], [10.4, 3.8], [10.4, 5.4], [0, 5.4],
] as const).map(([x, z]) => [ps(x), ps(z)] as const) }, 'upperFloor');
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
  [5.8, 2.8, 8, 3.8], [8, 3.8, 10.4, 3.8]]) parapet(ps(ax), ps(az), ps(bx), ps(bz), UPPER_HEIGHT, 0.9);
// Concrete column rows, capitals and beams define the downstairs sightlines.
for (const x of [3.3, 7]) for (const z of [0.1, 2.9, 5.6]) {
  shell.push(planBox(x, 1.58, z, 0.62, 3.16, 0.62, 'wall'), planBox(x, 2.96, z, 0.95, 0.4, 0.95, 'wall'));
}
for (const z of [-7.4, -3.8, -0.2, 3.4]) {
  shell.push(planBox(-3.4, 1.58, z, 0.65, 3.16, 0.65, 'wall'), planBox(-3.4, 5, z, 0.65, 3.2, 0.65, 'wall'));
  shell.push(planBox(-3.1, 3.01, z, 6.2, 0.3, 0.6, 'wall'));
}
shell.push(planBox(3.3, 3.01, 2.6, 0.65, 0.3, 10.4, 'wall'));
shell.push(planBox(7, 3.01, 4.5, 0.65, 0.3, 6.6, 'wall'));
shell.push(planBox(-1.65, 5.1, -7.5, 0.45, 3.4, 4, 'wall'), planBox(-5.2, 5.1, -9.3, 2, 3.4, 0.28, 'wall'));
shell.push(planBox(-3.4, 4.35, -4.5, 1.2, 1.9, 0.55, 'barrier'));
shell.push(planBox(2.7, 4.9, -2.2, 0.7, 3, 0.9, 'wall'), planBox(3.3, 4.95, 3.4, 0.65, 3.1, 0.65, 'wall'));

// Quarter-turn fan stair, followed by a short westbound straight flight (all scaled as one shape).
const FAN = { x: ps(7.2), z: ps(1), inner: ps(1.05), outer: ps(2.9) };
const FLIGHT = { minX: ps(4.8), maxX: FAN.x, minZ: ps(-1.9), maxZ: ps(-0.05) };
const FLIGHT_Z = (FLIGHT.minZ + FLIGHT.maxZ) / 2;
surfaces.push({ ...rect(FAN.x, FAN.x + FAN.outer, FLIGHT.minZ, FAN.z, 0), endHeight: 2.2,
  quarterTurn: { x: FAN.x, z: FAN.z, innerRadius: FAN.inner, outerRadius: FAN.outer } },
  { ...rect(FLIGHT.minX, FLIGHT.maxX, FLIGHT.minZ, FLIGHT.maxZ, UPPER_HEIGHT), endHeight: 2.2, slopeAxis: 'x' });
for (let i = 0; i < 14; i++) {
  const a = -i / 14 * Math.PI / 2, b = -(i + 1) / 14 * Math.PI / 2;
  const p = (r: number, angle: number): readonly [number, number] => [FAN.x + r * Math.cos(angle), FAN.z + r * Math.sin(angle)];
  const top = (i + 0.5) / 14 * 2.2;
  prisms.push({ points: [p(FAN.inner, a), p(FAN.outer, a), p(FAN.outer, b), p(FAN.inner, b)], bottom: top - STAIR_DEPTH, top, material: 'stair' });
  for (const r of [FAN.inner - 0.03, FAN.outer + 0.04]) {
    const [x, z] = p(r, (a + b) / 2);
    shell.push({ ...box(x, top + 0.43, z, 0.26, 0.86, 0.26, 'metal'), visible: false });
    const [ax, az] = p(r, a), [bx, bz] = p(r, b);
    BUNKER_RAILS.push({ from: { x: ax, y: i / 14 * 2.2 + 0.88, z: az },
      to: { x: bx, y: (i + 1) / 14 * 2.2 + 0.88, z: bz } });
  }
}
const FLIGHT_STEP = (FLIGHT.maxX - FLIGHT.minX) / 8;
for (let i = 0; i < 8; i++) {
  const x = FLIGHT.minX + (i + 0.5) * FLIGHT_STEP, top = UPPER_HEIGHT - (i + 0.5) / 8 * 1.2;
  shell.push(box(x, top - STAIR_DEPTH / 2, FLIGHT_Z, FLIGHT_STEP, STAIR_DEPTH, FLIGHT.maxZ - FLIGHT.minZ, 'stair', false));
  for (const z of [FLIGHT.minZ - 0.09, FLIGHT.maxZ + 0.09]) shell.push({ ...box(x, top + 0.43, z, FLIGHT_STEP, 0.86, 0.16, 'metal'), visible: false });
}
for (const z of [FLIGHT.minZ - 0.09, FLIGHT.maxZ + 0.09]) {
  BUNKER_RAILS.push({ from: { x: FLIGHT.minX, y: UPPER_HEIGHT + 0.88, z }, to: { x: FLIGHT.maxX, y: 3.08, z } });
}
// Compact HELP stair in a projecting west annex; top returns east then north.
const HELP_STAIR = { minX: px(-7.8), maxX: px(-6.3), minZ: pz(3.1), maxZ: pz(6.65) };
const HELP_STAIR_X = (HELP_STAIR.minX + HELP_STAIR.maxX) / 2, HELP_STAIR_Z = (HELP_STAIR.minZ + HELP_STAIR.maxZ) / 2;
const HELP_STAIR_RUN = HELP_STAIR.maxZ - HELP_STAIR.minZ;
surfaces.push({ ...rect(HELP_STAIR.minX, HELP_STAIR.maxX, HELP_STAIR.minZ, HELP_STAIR.maxZ, 0), endHeight: UPPER_HEIGHT, slopeAxis: 'z' });
for (let i = 0; i < 20; i++) shell.push(box(HELP_STAIR_X, (i + 0.5) / 20 * UPPER_HEIGHT - STAIR_DEPTH / 2,
  HELP_STAIR.minZ + (i + 0.5) / 20 * HELP_STAIR_RUN, HELP_STAIR.maxX - HELP_STAIR.minX, STAIR_DEPTH, HELP_STAIR_RUN / 20, 'stair', false));
shell.push(box(px(-6.25), 1.7, HELP_STAIR_Z, 0.16, 3.4, HELP_STAIR_RUN, 'wall'),
  box(px(-6.25), 3.9, HELP_STAIR_Z, 0.16, 1, HELP_STAIR_RUN, 'wall'));
const mainRoute: Vec3[] = [{ x: ps(9.2), y: 0, z: ps(1.65) }];
for (let i = 0; i <= 14; i++) {
  const a = -i / 14 * Math.PI / 2, r = (FAN.inner + FAN.outer) / 2;
  mainRoute.push({ x: FAN.x + r * Math.cos(a), y: i / 14 * 2.2, z: FAN.z + r * Math.sin(a) });
}
for (let i = 1; i <= 8; i++) mainRoute.push({ x: FLIGHT.maxX - i * FLIGHT_STEP, y: 2.2 + i / 8 * 1.2, z: FLIGHT_Z });
mainRoute.push({ x: FLIGHT.minX - 0.7, y: UPPER_HEIGHT, z: FLIGHT_Z });
const helpRoute: Vec3[] = [{ x: HELP_STAIR_X, y: 0, z: HELP_STAIR.minZ - 0.6 }];
for (let i = 0; i <= 16; i++) helpRoute.push({ x: HELP_STAIR_X, y: UPPER_HEIGHT * i / 16, z: HELP_STAIR.minZ + HELP_STAIR_RUN * i / 16 });
helpRoute.push({ x: HELP_STAIR_X, y: UPPER_HEIGHT, z: pz(7.15) }, { x: px(-5.5), y: UPPER_HEIGHT, z: pz(7.15) });
export const BUNKER_STAIRS = [{ id: 'start-stairs', route: mainRoute }, { id: 'help-stairs', route: helpRoute }] as const;
export const BUNKER_BOX_CENTER: Vec3 = { x: px(-1.45), y: 0.52, z: pz(7.12) };
shell.push(box(BUNKER_BOX_CENTER.x, 0.52, BUNKER_BOX_CENTER.z, 2.35, 1.04, 0.95, 'barrier'));
// Large broken roof apertures, not uniformly repeated slats.
for (const [x, z, sx, sz] of [[-5.5, -3, 1.2, 16], [-0.6, -7.6, 1.2, 6.8], [-3.1, -10.4, 6.2, 1.2],
  [-3.1, 4.7, 6.2, 1.3], [4.5, 4.9, 9, 1], [0.8, 1.2, 1.5, 7.6], [6, -4.15, 8.8, 1.1]])
  shell.push(planBox(x, 6.7, z, sx, 0.26, sz, 'wall'));
shell.push(planBox(14.4, 3.27, 1.4, 7.6, 0.26, 8, 'wall'), planBox(5.2, 3.27, 6.6, 10.4, 0.26, 2.4, 'wall'));
shell.push(planBox(-2.4, 3.27, 6.6, 4.8, 0.26, 2.4, 'wall'));
// Collapsed tunnel outside the HELP breach, visibly separate from the other windows.
shell.push(planBox(-9.4, -0.12, 0.7, 6.4, 0.24, 3.6, 'floor', false));
shell.push(planBox(-9.4, 1.3, -1.1, 6.4, 2.6, 0.55, 'wall'));
shell.push(planBox(-10.35, 1.3, 2.5, 4.3, 2.6, 0.55, 'wall'));
shell.push(planBox(-8.25, 1.3, 2.15, 0.3, 2.6, 0.7, 'wall'));
shell.push(planBox(-12.5, 1.3, 0.7, 0.5, 2.6, 3.6, 'wall'));
shell.push(planBox(-9.4, 2.8, 0.7, 6.4, 0.4, 3.6, 'wall'));
// Short exposed reinforcing bars hang across the surviving roof edge over HELP.
for (let i = 0; i < 12; i++) shell.push(box(px(-4.7) + i * 0.34, 6.66, pz(-9.2), 0.025, 0.035, 1.5, 'metal', false));

export const BUNKER_WINDOWS: readonly BunkerWindow[] = windows;
export const BUNKER_GREYBOX: readonly GreyboxBox[] = shell;
export const BUNKER_PRISMS: readonly GreyboxPrism[] = prisms;
export const BUNKER_WALK_SURFACES: readonly WalkSurface[] = surfaces;
export const BUNKER_DOORS: readonly DoorDefinition[] = [
  { id: 'help-room', position: { x: 0, y: 0, z: 0 }, cost: 1000,
    interactionRange: 2.6, minFacingDot: 0.3,
    blocker: { min: { x: -0.2, y: 0, z: -1.2 }, max: { x: 0.2, y: 2.85, z: 1.2 } } },
  { id: 'start-stairs', position: { x: ps(6), y: 2.8, z: FLIGHT_Z }, cost: 1000,
    kind: 'debris', interactionRange: 2.8, minFacingDot: 0.2,
    blocker: { min: { x: ps(6) - 0.4, y: 2.2, z: FLIGHT.minZ - 0.1 }, max: { x: ps(6) + 0.4, y: 5.7, z: FLIGHT.maxZ + 0.15 } } },
  { id: 'help-stairs', position: { x: HELP_STAIR_X, y: 1.7, z: HELP_STAIR_Z }, cost: 1000,
    kind: 'debris', interactionRange: 2.8, minFacingDot: 0.2,
    blocker: { min: { x: HELP_STAIR.minX - 0.05, y: 0, z: HELP_STAIR_Z - 0.375 },
      max: { x: HELP_STAIR.maxX + 0.05, y: 4.5, z: HELP_STAIR_Z + 0.375 } } },
];
// WaW's original chalk: Kar98k in the start room, Thompson and double-barrel in HELP, Trench Gun and BAR upstairs.
// Ammo costs half the gun.
const wallBuy = (id: string, weaponId: string, name: string, cost: number, position: Vec3): WallWeaponDefinition => ({
  id, position, weaponId, weaponCost: cost, ammoCost: cost / 2,
  prompt: `E  ${name} [${cost}] / Ammo [${cost / 2}]`, interactionRange: 2.5, minFacingDot: 0.25,
});
export const BUNKER_WALL_WEAPONS: readonly WallWeaponDefinition[] = [
  wallBuy('start-kar98k', 'kar98k', 'Kar98k', 200, { x: px(5.2), y: 1, z: pz(7.56) }),
  wallBuy('help-thompson', 'thompson', 'Thompson', 1200, { x: px(-5.96), y: 1, z: pz(-9.4) }),
  wallBuy('help-double-barrel', 'double-barrel', 'Double-Barreled Shotgun', 1200, { x: px(-5.96), y: 1, z: pz(-4.6) }),
  wallBuy('upper-trench-gun', 'trench-gun', 'Trench Gun', 1500, { x: px(-3.1), y: UPPER_HEIGHT + 1, z: pz(-10.76) }),
  wallBuy('upper-bar', 'bar', 'BAR', 1800, { x: px(-5.96), y: UPPER_HEIGHT + 1, z: pz(-5.6) }),
  wallBuy('start-m1-carbine', 'm1-carbine', 'M1A1 Carbine', 600, { x: px(7.4), y: 1, z: pz(7.56) }),
  // BO1-era chalk alongside the WaW set.
  wallBuy('start-m14', 'm14', 'M14', 500, { x: px(17.96), y: 1, z: pz(2.5) }),
  wallBuy('help-mp5k', 'mp5k', 'MP5K', 1000, { x: px(-1.8), y: 1, z: pz(-10.76) }),
  wallBuy('upper-ak74u', 'ak74u', 'AK-74u', 1200, { x: px(-5.96), y: UPPER_HEIGHT + 1, z: pz(-3.3) }),
];
/** Presentation: the yaw each chalk outline faces, away from its wall. */
export const BUNKER_WALL_WEAPON_FACING: Readonly<Record<string, number>> = {
  'start-kar98k': Math.PI, 'help-thompson': Math.PI / 2, 'help-double-barrel': Math.PI / 2,
  'upper-trench-gun': 0, 'upper-bar': Math.PI / 2, 'start-m1-carbine': Math.PI, 'start-m14': -Math.PI / 2,
  'help-mp5k': 0, 'upper-ak74u': Math.PI / 2,
};
/** Bouncing Betties, sold from the wall of the start room, beside the Kar98k's chalk. */
export const BUNKER_EQUIPMENT: readonly EquipmentBuyDefinition[] = [
  { id: 'start-betty', item: 'bouncing-betty', position: { x: px(6.6), y: 1, z: pz(-2.36) }, cost: 1000, refillCost: 500 },
];
export const BUNKER_EQUIPMENT_FACING: Readonly<Record<string, number>> = { 'start-betty': 0 };
export const BUNKER_MYSTERY_BOXES: readonly MysteryBoxDefinition[] = [{
  // Buyers stand in front of the box, which sits against the HELP room's south wall.
  id: 'help-box', position: { x: BUNKER_BOX_CENTER.x, y: 0.6, z: BUNKER_BOX_CENTER.z - 0.77 }, cost: 950,
  weapons: ['kar98k', 'springfield', 'mosin', 'm1-garand', 'm1-carbine', 'stg44', 'fg42', 'thompson', 'mp40', 'ppsh41',
    'bar', 'mg42', 'double-barrel', 'trench-gun', 'magnum-357',
    // BO1's version of the map added Cold War guns to the box.
    'm14', 'fal', 'commando', 'ak74u', 'mp5k', 'skorpion', 'rpk', 'spas12', 'ithaca37', 'python', 'rpg7',
    'irrlicht', 'molniya'],
  // Every gun is equally likely for now (#130); `weights` can make the wonder weapons rarer again.
}];
export const BUNKER_PLAYER_SPAWN: Vec3 = { x: px(5.2), y: 0, z: pz(4.2) };
/** WaW/BO1 windows hold six boards. */
export const BUNKER_WINDOW_BOARDS = 6;
const windowById = (id: string): BunkerWindow => windows.find(w => w.id === id)!;
/**
 * Zombies shamble in from about 15 m out in the fog (the HELP room's east window from the yard, around
 * the corner); the cave breach's come from the far end of its collapsed tunnel.
 */
const ENTRY_ROUTES: Record<string, Vec3[]> = {
  ...Object.fromEntries(['start-north', 'start-east', 'start-wide', 'start-south', 'start-corner', 'help-north']
    .map(id => [id, [windowPoint(windowById(id), 15, 0.6)]])),
  'help-east': [onGround(11, -15)],
  'help-cave': [onGround(-15.8, 1.15)],
};
// Upper entries approach on the ground, climb the outer wall, then tear through at gallery height.
// Keep the climb vertical so no zombie can cut through the ground-floor rooms or scenery.
const UPPER_ENTRIES = ['upper-help-north', 'upper-help-south', 'upper-gallery', 'upper-east'] as const;
for (const id of UPPER_ENTRIES) {
  const opening = windowById(id);
  const climb = windowPoint(opening, id === 'upper-east' ? 11.2 : id === 'upper-help-south' ? 10 : 2.4);
  ENTRY_ROUTES[id] = [{ ...windowPoint(opening, 15), y: 0 },
    { ...climb, y: 0 }, { ...climb, y: UPPER_HEIGHT }];
}
// The cave breach's landing keeps to the middle of its wide window, clear of the stair annex beside it.
export const BUNKER_BARRIERS: readonly BarrierDefinition[] = barriersFromWindows(windows, BUNKER_WINDOW_BOARDS, UPPER_ENTRIES, ENTRY_ROUTES,
  { 'help-cave': 0.2 });
/** Three spots per entry where its zombies appear (see entrySpawns); the tunnel is too narrow to scatter far. */
export const BUNKER_ZOMBIE_SPAWNS: readonly ZombieSpawnPoint[] = BUNKER_BARRIERS.flatMap(b =>
  entrySpawns(b, b.id === 'help-cave' ? [onGround(-15.3, 0.4), onGround(-14.6, 1.9)]
    : b.id === 'upper-help-south' ? [
      { ...b.approachPath[0], x: b.approachPath[0].x - 1 },
      { ...b.approachPath[0], x: b.approachPath[0].x - 1.6 },
    ] : undefined)
    .map(spawn => b.position.y > 0 ? { ...spawn, minRound: 4 } : spawn));

// ---- Outside: a barbed-wire perimeter with a gateway to the south, a watchtower, a timber hut, a
// half-buried pillbox and a ruined wall, out in the fog where the zombies come from.
export const BUNKER_GROUNDS = { minX: -32, maxX: 46, minZ: -40, maxZ: 36 };
const outside = new Scenery();
const GR = BUNKER_GROUNDS;
outside.fence('x', GR.minZ, GR.minX, GR.maxX);
outside.fence('z', GR.minX, GR.minZ, GR.maxZ);
outside.fence('z', GR.maxX, GR.minZ, GR.maxZ);
outside.fence('x', GR.maxZ, GR.minX, 6);
outside.fence('x', GR.maxZ, 10, GR.maxX);
for (const x of [6, 10]) outside.box(x, 1.2, GR.maxZ, 0.24, 2.4, 0.24, 'splintered-wood', true);
outside.watchtower(40, -34);
outside.building({ minX: 28, maxX: 37, minZ: 18, maxZ: 23 }, { height: 2.6, walls: 'old-planks', pitch: 1.2,
  windows: [['north', 2.5], ['north', 6.5]], door: ['west', 2.5] });
// The pillbox: three concrete walls with a firing slit, under a slab that has slumped at one end.
outside.box(-23.5, 0.9, 14.2, 5, 1.8, 0.5, 'weathered-concrete-b', true);
outside.box(-23.5, 0.35, 18.8, 5, 0.7, 0.5, 'weathered-concrete-b', true);
outside.box(-23.5, 1.55, 18.8, 5, 0.5, 0.5, 'weathered-concrete-b', true);
for (const x of [-25.75, -21.25]) outside.box(x, 0.9, 16.5, 0.5, 1.8, 4.1, 'weathered-concrete-b', true);
outside.box(-23.5, 2.05, 16.5, 5.6, 0.35, 5.2, 'weathered-concrete-a', false, { rotationZ: 0.12 });
// A sandbagged machine-gun nest, and a sandbag wall and tank traps across the field to the south,
// beyond where the zombies come from.
outside.sandbags(26, -21.6, 'x', 7); outside.sandbags(25.7, -21.2, 'z', 5); outside.sandbags(30.3, -21.2, 'z', 5);
outside.sandbags(12.5, 30.5, 'x', 7, 2);
for (const x of [-6, -1.5, 18, 29.5, 34]) outside.tankTrap(x, 31.5);
// A ruined brick wall, broken down to different heights.
for (const [z, length, height] of [[-22.5, 3, 2.2], [-19, 3.5, 1.3], [-15.6, 2.6, 0.8], [-12, 4, 1.8], [-8.2, 2.8, 1]]) {
  outside.box(-27, height / 2, z, 0.45, height, length, 'broken-plaster-brick', true);
}
export const BUNKER_MARKERS: readonly MapMarker[] = [
  ...BUNKER_BARRIERS.map(b => ({ id: b.id, type: 'zombieSpawn' as const, position: b.approachPath[0], label: 'Barricaded entry' })),
  ...BUNKER_DOORS.map(d => ({ id: d.id, type: 'door' as const, position: d.position, label: doorPrompt(d) })),
  ...BUNKER_WALL_WEAPONS.map(w => ({ id: w.id, type: 'wallBuy' as const, position: w.position, label: w.prompt! })),
  { id: 'box-help', type: 'mysteryBox', position: BUNKER_MYSTERY_BOXES[0].position, label: 'Mystery Box [950]' },
];
/** Collision for the given boxes; by default the bunker and the props inside it. */
export function greyboxCollisionBoxes(boxes: readonly GreyboxBox[] = BUNKER_GREYBOX): CollisionBox[] {
  const result = boxes.filter(b => b.collides).map(b => ({
    min: { x: b.center.x - b.size.x / 2, y: b.center.y - b.size.y / 2, z: b.center.z - b.size.z / 2 },
    max: { x: b.center.x + b.size.x / 2, y: b.center.y + b.size.y / 2, z: b.center.z + b.size.z / 2 },
  }));
  if (boxes === BUNKER_GREYBOX) result.push(...BUNKER_PROPS.filter(p => p.solid).map(propCollisionBox));
  return result;
}
/** Everything solid, for the simulation: the bunker, its props and the scenery outside. */
export const BUNKER_COLLISION: readonly CollisionBox[] = [...greyboxCollisionBoxes(), ...greyboxCollisionBoxes(outside.boxes),
  ...BUNKER_OUTSIDE_PROPS.filter(p => p.solid).map(propCollisionBox)];
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
export const BUNKER_SHOT_BLOCKERS: readonly CollisionBox[] = slabBlockers;

// Sparse floor grid + exact stair centre-lines, compiled once from real geometry.
const nodes: NavigationNode[] = [], collision = [...greyboxCollisionBoxes(), ...BUNKER_HAZARDS.map(hazardBox)];
function add(id: string, position: Vec3): void {
  if (hasClearNavigationLine(position, position, collision, 0.34)) nodes.push({ id, position, neighbors: [] });
}
for (const y of [0, UPPER_HEIGHT]) for (let x = px(-8) + 0.8; x < px(18.2); x += 1.5) for (let z = pz(-11) + 0.8; z < pz(7.8); z += 1.5) {
  if (sampleWalkHeight(x, z, y, surfaces) === y
    && surfaces.some(s => s.startHeight === y && s.endHeight === y && walkSurfaceHeight(s, x, z) === y))
    add(`floor-${y}-${x}-${z}`, { x, y, z });
}
for (const stair of BUNKER_STAIRS) stair.route.forEach((p, i) => add(`${stair.id}-${i}`, p));
for (const b of BUNKER_BARRIERS) add(b.id, b.insidePoint);
for (const [id, p] of Object.entries({ spawn: BUNKER_PLAYER_SPAWN, helpWest: { x: -1, y: 0, z: 0 },
  helpEast: { x: 1, y: 0, z: 0 }, upperWest: { x: -1, y: UPPER_HEIGHT, z: pz(-0.4) },
  upperEast: { x: 1, y: UPPER_HEIGHT, z: pz(-0.4) }, annexBase: { x: px(-5.5), y: 0, z: pz(2.5) },
  annexTop: { x: px(-5.5), y: UPPER_HEIGHT, z: pz(4.5) },
  // The strip beside the HELP stairwell is narrower than the grid spacing; route through its middle.
  annexLanding: { x: px(-5.5), y: UPPER_HEIGHT, z: (pz(5.4) + pz(6.65)) / 2 } })) add(id, p);
add('upper-east-landing', { x: 10.5, y: UPPER_HEIGHT, z: pz(4.6) });
for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
  const a = nodes[i], b = nodes[j];
  if (Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z) > 3.2) continue;
  if (hasClearNavigationLine(a.position, b.position, collision, 0.34)
    && hasWalkableConnection(a.position, b.position, surfaces) && hasWalkableConnection(b.position, a.position, surfaces)) {
    (a.neighbors as string[]).push(b.id); (b.neighbors as string[]).push(a.id);
  }
}
export const BUNKER_NAVIGATION: NavigationGraph = { nodes };

/** Bunker as a whole, for the game and the map menu. The BUNKER_* exports above remain for tests. */
export const BUNKER_MAP: GameMap = {
  id: 'bunker', name: 'Bunker', upperHeight: UPPER_HEIGHT,
  greybox: BUNKER_GREYBOX, prisms: BUNKER_PRISMS, collisionBoxes: BUNKER_COLLISION,
  shotBlockers: BUNKER_SHOT_BLOCKERS, walkSurfaces: BUNKER_WALK_SURFACES, navigation: BUNKER_NAVIGATION,
  playerSpawn: BUNKER_PLAYER_SPAWN, windows: BUNKER_WINDOWS, windowBoards: BUNKER_WINDOW_BOARDS,
  barriers: BUNKER_BARRIERS, zombieSpawns: BUNKER_ZOMBIE_SPAWNS,
  scenery: outside.boxes,
  doors: BUNKER_DOORS,
  doorStyles: {
    'help-room': { kind: 'planks', yaw: 0, width: 2.4, label: 'HELP' },
    // A sofa and stacked crates across each stair, matching the silhouette of the original map's debris.
    'start-stairs': { kind: 'debris', yaw: Math.PI / 2, width: FLIGHT.maxZ - FLIGHT.minZ },
    'help-stairs': { kind: 'debris', yaw: 0, width: HELP_STAIR.maxX - HELP_STAIR.minX },
  },
  wallWeapons: BUNKER_WALL_WEAPONS, wallWeaponFacing: BUNKER_WALL_WEAPON_FACING,
  hazards: BUNKER_HAZARDS, equipment: BUNKER_EQUIPMENT, equipmentFacing: BUNKER_EQUIPMENT_FACING,
  mysteryBoxes: BUNKER_MYSTERY_BOXES, boxCenter: BUNKER_BOX_CENTER, boxYaw: Math.PI / 2,
  rails: BUNKER_RAILS, props: [...BUNKER_PROPS, ...BUNKER_OUTSIDE_PROPS], decals: BUNKER_DECALS,
  labels: [
    { text: 'HELP', x: px(0.215), y: 2.3, z: pz(2.2), yaw: Math.PI / 2, width: 1.6, height: 0.45 },
    { text: 'YOU MUST ASCEND', x: px(5.6), y: 2.4, z: pz(-2.385), yaw: 0, width: 2.7, height: 0.38 },
    { text: 'FROM DARKNESS', x: px(5.6), y: 2, z: pz(-2.385), yaw: 0, width: 2.5, height: 0.38 },
  ],
  lights: [{ x: px(-0.7), y: 2.35, z: pz(-2) }, { x: px(5), y: 2.65, z: pz(2) }, { x: px(-0.7), y: 5.75, z: pz(2.5) }],
  rubble: [
    { minX: px(-5.7), maxX: px(-0.9), minZ: pz(-10.5), maxZ: pz(4.5), y: 0, count: 67 },
    { minX: px(-5.7), maxX: px(-0.9), minZ: pz(-10.5), maxZ: pz(4.5), y: UPPER_HEIGHT, count: 33 },
  ],
  focus: { x: 7, z: -2, radius: 21 },
  grounds: BUNKER_GROUNDS,
  trees: [{ x: -26, z: -8, scale: 1 }, { x: 34, z: -14, scale: 0.95 }, { x: -12, z: 28, scale: 1.05 }, { x: 28, z: 30, scale: 0.9 },
    { x: -26, z: -34, scale: 1 }, { x: 18, z: -32, scale: 1.1 }],
  previews: {
    help: { position: { x: px(-1.8), y: 0, z: pz(-7.8) }, yaw: Math.PI - 0.12 },
    upstairs: { position: { x: px(2), y: UPPER_HEIGHT, z: pz(3.8) }, yaw: -0.5 },
    barrier: { position: { x: px(12), y: 0, z: pz(-2.6) + 1.8 }, yaw: 0 },
    doorway: { position: { x: 1.2, y: 0, z: 1.6 }, yaw: -Math.PI / 2 },
    props: { position: { x: px(-2), y: 0, z: pz(7.8) - 3.5 }, yaw: Math.PI + 0.15 },
    wallBuys: { position: { x: px(6.3), y: 0, z: pz(7.8) - 2.4 }, yaw: Math.PI },
    helpWalls: { position: { x: px(-3.6), y: 0, z: pz(-5.2) }, yaw: Math.PI / 2 - 0.35 },
  },
};
