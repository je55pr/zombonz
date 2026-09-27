import type { DoorDefinition } from '../core/door.ts';
import type { WallWeaponDefinition } from '../core/wallWeapon.ts';
import type { MysteryBoxDefinition } from '../core/mysteryBox.ts';
import type { Vec3 } from '../core/types.ts';
import type { PropPlacement } from './bunkerProps.ts';
import type { GameMap } from './gameMap.ts';
import { MapBuilder, barriersFromWindows, collisionBoxesFor, compileNavigation, slabShotBlockers } from './mapBuild.ts';
import { BUNKER_MYSTERY_BOXES } from './bunker.ts';

/** Two starting wings wrap an exposed courtyard and meet in the power room opposite the start. */
const UP = 3.4, OUT = 18, YARD = 8, DOOR_WIDTH = 2.4;
const b = new MapBuilder({ wall: 'broken-plaster-brick', trim: 'weathered-concrete-a',
  floor: 'cracked-concrete-floor', stair: 'weathered-concrete-b' });
const door = (at: number) => ({ at, width: DOOR_WIDTH, kind: 'door' as const });
const window = (id: string, at: number) => ({ id, at, width: 1.35, kind: 'window' as const });

// Both storeys are a ring; the courtyard is scenery rather than walkable map.
for (const y of [0, UP]) {
  b.floor(-OUT, OUT, -OUT, -YARD, y);
  b.floor(-OUT, -YARD, -YARD, YARD, y);
  b.floor(YARD, OUT, -YARD, YARD, y);
  b.floor(-OUT, OUT, YARD, OUT, y);
}
for (const [x1, x2, z1, z2] of [
  [-OUT, OUT, -OUT, -YARD], [-OUT, -YARD, -YARD, YARD],
  [YARD, OUT, -YARD, YARD], [-OUT, OUT, YARD, OUT],
]) b.ceiling(x1, x2, z1, z2, UP * 2);
b.box(0, -0.18, 0, YARD * 2, 0.36, YARD * 2, 'floor', false);
// A simple ruined fountain gives the window views a recognizable central landmark.
b.box(0, 0.28, 0, 5.3, 0.56, 5.3, 'wall', false);
b.box(0, 0.58, 0, 3.9, 0.12, 3.9, 'floor', false);
b.box(0, 1.15, 0, 0.7, 1.2, 0.7, 'wall', false);

for (const y of [0, UP]) {
  const upper = y === UP;
  b.wall('x', -OUT, -OUT, OUT, y, UP, upper
    ? [window('north-upper-west', -14), window('north-upper-east', 14)]
    : [window('power-north', 0), window('north-west', -14), window('north-east', 14)], -1);
  b.wall('x', OUT, -OUT, OUT, y, UP, upper
    ? [window('south-upper-west', -14), window('south-upper-east', 14)]
    : [window('german-south-a', -15), window('german-south-b', -5),
      window('american-south-a', 5), window('american-south-b', 15)], 1);
  b.wall('z', -OUT, -OUT, OUT, y, UP, upper ? [window('west-upper', 1)]
    : [window('german-west', 12), window('west-middle', -2), window('west-north', -13)], -1);
  b.wall('z', OUT, -OUT, OUT, y, UP, upper ? [window('east-upper', 1)]
    : [window('american-east', 12), window('east-middle', -2), window('east-north', -13)], 1);
  for (const [axis, fixed, outward, side] of [
    ['x', -YARD, 1, 'north'], ['x', YARD, -1, 'south'],
    ['z', -YARD, 1, 'west'], ['z', YARD, -1, 'east'],
  ] as const) {
    const balcony = upper && axis === 'x';
    b.wall(axis, fixed, -YARD, YARD, y, UP,
      [window(`courtyard-${side}-a-${y}`, axis === 'z' ? -2.5 : -4),
        ...(balcony ? [{ at: 0, width: 2.8, kind: 'door' as const }] : []),
        window(`courtyard-${side}-b-${y}`, 4)], outward);
    if (balcony) b.parapet('x', fixed, -1.4, 1.4, UP);
  }
}

// Split starts and side rooms. Each route reaches the power room from the opposite end.
 b.wall('z', 0, YARD, OUT, 0, UP, [door(13)]);
b.wall('x', YARD, -OUT, -YARD, 0, UP, [door(-13)]);
b.wall('x', YARD, YARD, OUT, 0, UP, [door(13)]);
for (const z of [-4.5, -8]) {
  b.wall('x', z, -OUT, -YARD, 0, UP, [door(-13)]);
  b.wall('x', z, YARD, OUT, 0, UP, [door(13)]);
}
for (const x of [-8, 8]) b.wall('z', x, -OUT, -YARD, 0, UP, [door(-13)]);
for (const x of [-9, 0, 9]) b.wall('z', x, YARD, OUT, UP, UP, [door(13)]);
for (const x of [-8, 0, 8]) b.wall('z', x, -OUT, -YARD, UP, UP, [door(-13)]);
for (const z of [-6]) {
  b.wall('x', z, -OUT, -YARD, UP, UP, [door(-13)]);
  b.wall('x', z, YARD, OUT, UP, UP, [door(13)]);
}

// Carve stairwell apertures out of the upper side slabs, then add two steep runs.
for (let i = b.surfaces.length - 1; i >= 0; i--) {
  const s = b.surfaces[i];
  if (s.startHeight === UP && s.endHeight === UP && s.minZ === -YARD && s.maxZ === YARD
    && (s.maxX === -YARD || s.minX === YARD)) b.surfaces.splice(i, 1);
}
for (let i = b.shell.length - 1; i >= 0; i--) {
  const box = b.shell[i];
  if (box.material === 'upperFloor' && box.center.y === UP - 0.12 && box.center.z === 0
    && Math.abs(box.center.x) === (OUT + YARD) / 2) b.shell.splice(i, 1);
}
for (const side of [-1, 1]) {
  const [low, high] = side < 0 ? [-18, -8] : [8, 18];
  const [stairLow, stairHigh] = side < 0 ? [-16, -13] : [13, 16];
  b.floor(low, high, -8, -3.2, UP);
  b.floor(low, high, 3.2, 8, UP);
  b.floor(side < 0 ? -13 : 8, side < 0 ? -8 : 13, -3.2, 3.2, UP);
  b.floor(side < 0 ? -18 : 16, side < 0 ? -16 : 18, -3.2, 3.2, UP);
  b.stair(stairLow, stairHigh, -3.2, 3.2, 'z', false, 0, UP, 18);
  b.parapet('z', side < 0 ? -13 : 13, -3.2, 3.2, UP);
  b.parapet('z', side < 0 ? -16 : 16, -3.2, 3.2, UP);
}

export const ASYLUM_UPPER_HEIGHT = UP;
export const ASYLUM_BOX_CENTER: Vec3 = { x: 2.8, y: 0.52, z: -16.4 };
b.box(ASYLUM_BOX_CENTER.x, 0.52, ASYLUM_BOX_CENTER.z, 2.35, 1.04, 0.95, 'barrier');
// A visual power panel reserves its familiar destination; gameplay activation comes later.
b.box(-6.5, 1.35, -17.73, 0.68, 0.9, 0.16, 'metal', false);
b.box(-6.5, 1.35, -17.56, 0.14, 0.42, 0.19, 'metal', false);
const plankDoor = (id: string, x: number, z: number, axis: 'x' | 'z', cost: number, name: string): DoorDefinition => ({
  id, position: { x, y: 0, z }, cost, prompt: `E  Open ${name}  [${cost}]`, interactionRange: 2.6, minFacingDot: 0.2,
  blocker: axis === 'z'
    ? { min: { x: x - 0.2, y: 0, z: z - DOOR_WIDTH / 2 }, max: { x: x + 0.2, y: 2.85, z: z + DOOR_WIDTH / 2 } }
    : { min: { x: x - DOOR_WIDTH / 2, y: 0, z: z - 0.2 }, max: { x: x + DOOR_WIDTH / 2, y: 2.85, z: z + 0.2 } },
});
export const ASYLUM_DOORS: readonly DoorDefinition[] = [
  plankDoor('german-hall', -13, 8, 'x', 750, 'German hall'),
  plankDoor('american-hall', 13, 8, 'x', 750, 'American hall'),
  plankDoor('start-gate', 0, 13, 'z', 1500, 'starting gate'),
  plankDoor('west-wing', -13, -4.5, 'x', 1000, 'west wing'),
  plankDoor('east-wing', 13, -4.5, 'x', 1000, 'east wing'),
  plankDoor('west-back', -13, -8, 'x', 750, 'bathroom'),
  plankDoor('east-back', 13, -8, 'x', 750, 'kitchen'),
  plankDoor('power-west', -8, -13, 'z', 750, 'power room'),
  plankDoor('power-east', 8, -13, 'z', 750, 'power room'),
  ...[-1, 1].map(side => ({
    id: side < 0 ? 'west-stairs' : 'east-stairs', position: { x: side * 14.5, y: 0.8, z: 2.2 },
    cost: 1000, prompt: 'E  Clear stair debris  [1000]', interactionRange: 2.8, minFacingDot: 0.2,
    blocker: { min: { x: side < 0 ? -16 : 13, y: 0, z: 1.85 },
      max: { x: side < 0 ? -13 : 16, y: 4.5, z: 2.55 } },
  })),
];
const wallBuy = (id: string, weaponId: string, name: string, cost: number, position: Vec3): WallWeaponDefinition => ({
  id, position, weaponId, weaponCost: cost, ammoCost: cost / 2,
  prompt: `E  ${name} [${cost}] / Ammo [${cost / 2}]`, interactionRange: 2.5, minFacingDot: 0.25,
});
export const ASYLUM_WALL_WEAPONS: readonly WallWeaponDefinition[] = [
  wallBuy('german-kar98k', 'kar98k', 'Kar98k', 200, { x: -11.5, y: 1, z: 17.76 }),
  wallBuy('german-gewehr', 'm1-garand', 'Gewehr 43', 600, { x: -3, y: 1, z: 17.76 }),
  wallBuy('american-carbine', 'm1-carbine', 'M1A1 Carbine', 600, { x: 4, y: 1, z: 17.76 }),
  wallBuy('west-thompson', 'thompson', 'Thompson', 1200, { x: -17.76, y: 1, z: -5.5 }),
  wallBuy('east-mp40', 'mp40', 'MP40', 1000, { x: 17.76, y: 1, z: -5.5 }),
  wallBuy('bathroom-trench', 'trench-gun', 'Trench Gun', 1500, { x: -16, y: 1, z: -17.76 }),
  wallBuy('kitchen-double-barrel', 'double-barrel', 'Double-Barreled Shotgun', 1200, { x: 15, y: 1, z: -17.76 }),
  wallBuy('power-stg44', 'stg44', 'STG-44', 1200, { x: -4.5, y: 1, z: -17.76 }),
  wallBuy('upper-bar', 'bar', 'BAR', 1800, { x: -5, y: UP + 1, z: 17.76 }),
  wallBuy('upper-garand', 'm1-garand', 'M1 Garand', 1200, { x: 5, y: UP + 1, z: -17.76 }),
];
export const ASYLUM_MYSTERY_BOXES: readonly MysteryBoxDefinition[] = [{
  ...BUNKER_MYSTERY_BOXES[0], id: 'power-box',
  position: { x: ASYLUM_BOX_CENTER.x, y: 0.6, z: ASYLUM_BOX_CENTER.z + 0.77 },
}];
export const ASYLUM_PLAYER_SPAWN: Vec3 = { x: -5, y: 0, z: 12 };
const prop = (id: string, asset: string, x: number, y: number, z: number,
  sx: number, sy: number, sz: number, yaw = 0, solid = true, background = false): PropPlacement =>
  ({ id, asset, position: { x, y, z }, size: { x: sx, y: sy, z: sz }, yaw, solid, background });
export const ASYLUM_PROPS: readonly PropPlacement[] = [
  prop('german-table', 'wooden-table', -16, 0, 9.3, 1.8, 0.55, 0.66),
  prop('german-radio', 'field-radio', -16, 0.55, 9.3, 0.62, 0.44, 0.42, 0, false),
  prop('american-table', 'wooden-table', 16, 0, 9.3, 1.8, 0.55, 0.66),
  prop('west-shelf', 'shelf', -17.5, 0, -6.3, 1.01, 2.08, 0.26, -Math.PI / 2),
  prop('east-shelf', 'shelf', 17.5, 0, -6.3, 1.01, 2.08, 0.26, Math.PI / 2),
  prop('kitchen-stove', 'barrel-stove', 10, 0, -16.5, 0.6, 0.86, 0.6),
  prop('kitchen-carton', 'cardboard-box', 16, 0, -9.1, 0.39, 0.35, 0.52),
  prop('bathroom-crate', 'wooden-crate', -10, 0, -16.2, 0.85, 0.24, 0.4),
  prop('power-bags', 'cement-bag', -6.5, 0, -9.3, 0.47, 0.18, 0.7, 0, false),
  prop('upper-barrel', 'explosive-barrel', -15, UP, 16, 0.58, 0.9, 0.58),
  prop('courtyard-jeep', 'vehicles/gaz-67', 4, 0, 4, 1.8, 1.65, 3.6, 0.5, false, true),
];
const barriers = barriersFromWindows(b.windows, 6);
const collision = collisionBoxesFor(b.shell, ASYLUM_PROPS);
const ASYLUM_NAVIGATION = compileNavigation(b.surfaces, collision,
  { minX: -17.1, maxX: 18, minZ: -17.1, maxZ: 18 }, [0, UP], [
    { id: 'spawn', position: ASYLUM_PLAYER_SPAWN },
    ...ASYLUM_DOORS.filter(d => !d.id.endsWith('stairs')).flatMap(d => {
      const axis = ['german-hall', 'american-hall', 'west-wing', 'east-wing', 'west-back', 'east-back'].includes(d.id) ? 'x' : 'z';
      return [-1, 1].map(side => ({ id: `${d.id}-${side}`, position: {
        x: d.position.x + (axis === 'z' ? side : 0), y: 0,
        z: d.position.z + (axis === 'x' ? side : 0),
      } }));
    }),
    ...[-1, 1].flatMap(side => [
      { id: `stair-${side}-foot`, position: { x: side * 14.5, y: 0, z: 4 } },
      ...Array.from({ length: 13 }, (_, i) => ({ id: `stair-${side}-${i}`, position: {
        x: side * 14.5, y: UP * i / 12, z: 3.2 - 6.4 * i / 12,
      } })),
      { id: `stair-${side}-head`, position: { x: side * 14.5, y: UP, z: -4 } },
    ]),
    ...barriers.map(barrier => ({ id: barrier.id, position: barrier.insidePoint })),
  ]);
export const ASYLUM_MAP: GameMap = {
  id: 'asylum', name: 'Asylum', upperHeight: UP,
  greybox: b.shell, prisms: b.prisms, collisionBoxes: collision,
  shotBlockers: slabShotBlockers(b.surfaces, UP), walkSurfaces: b.surfaces, navigation: ASYLUM_NAVIGATION,
  playerSpawn: ASYLUM_PLAYER_SPAWN, windows: b.windows, windowBoards: 6,
  barriers, zombieSpawns: barriers.map(barrier => ({ ...barrier.approachPath[0], barrierId: barrier.id })),
  doors: ASYLUM_DOORS,
  doorStyles: Object.fromEntries(ASYLUM_DOORS.map(d => [d.id, d.id.endsWith('stairs')
    ? { kind: 'debris' as const, yaw: 0, width: 3 }
    : { kind: 'planks' as const, yaw: ['german-hall', 'american-hall', 'west-wing', 'east-wing', 'west-back', 'east-back'].includes(d.id)
      ? Math.PI / 2 : 0, width: DOOR_WIDTH }])),
  wallWeapons: ASYLUM_WALL_WEAPONS,
  wallWeaponFacing: {
    'german-kar98k': Math.PI, 'german-gewehr': Math.PI, 'american-carbine': Math.PI,
    'west-thompson': Math.PI / 2, 'east-mp40': -Math.PI / 2,
    'bathroom-trench': 0, 'kitchen-double-barrel': 0, 'power-stg44': 0,
    'upper-bar': Math.PI, 'upper-garand': 0,
  },
  mysteryBoxes: ASYLUM_MYSTERY_BOXES, boxCenter: ASYLUM_BOX_CENTER, boxYaw: -Math.PI / 2,
  rails: b.rails, props: ASYLUM_PROPS,
  decals: [
    { asset: 'leaking-grime', x: -5, y: 2.4, z: 17.79, width: 2.6, height: 2.5, yaw: Math.PI },
    { asset: 'smear-grime', x: 12, y: 1.6, z: -17.79, width: 2.4, height: 2.2, yaw: 0 },
  ],
  labels: [
    { text: 'GERMAN WING', x: -4.5, y: 2.95, z: 17.78, yaw: Math.PI, width: 3.3, height: 0.42 },
    { text: 'AMERICAN WING', x: 4.5, y: 2.95, z: 17.78, yaw: Math.PI, width: 3.8, height: 0.42 },
    { text: 'POWER ROOM', x: -3, y: 2.95, z: -17.78, yaw: 0, width: 3, height: 0.42 },
    { text: 'KITCHEN', x: 13, y: 2.95, z: -17.78, yaw: 0, width: 2.3, height: 0.42 },
    { text: 'BATHROOM', x: -13, y: 2.95, z: -17.78, yaw: 0, width: 2.7, height: 0.42 },
  ],
  lights: [
    { x: -5, y: 2.9, z: 13 }, { x: 5, y: 2.9, z: 13 },
    { x: -13, y: 2.9, z: 0 }, { x: 13, y: 2.9, z: 0 },
    { x: -13, y: 2.9, z: -13 }, { x: 13, y: 2.9, z: -13 }, { x: 0, y: 2.9, z: -13 },
    { x: -13, y: 5.8, z: 0 }, { x: 13, y: 5.8, z: 0 }, { x: 0, y: 5.8, z: 13 },
  ],
  rubble: [
    { minX: -17, maxX: -1, minZ: 9, maxZ: 17, y: 0, count: 24 },
    { minX: 1, maxX: 17, minZ: 9, maxZ: 17, y: 0, count: 24 },
    { minX: -17, maxX: -9, minZ: -7, maxZ: 7, y: 0, count: 20 },
    { minX: 9, maxX: 17, minZ: -7, maxZ: 7, y: 0, count: 20 },
    { minX: -17, maxX: 17, minZ: -17, maxZ: -9, y: 0, count: 35 },
    { minX: -17, maxX: 17, minZ: 9, maxZ: 17, y: UP, count: 25 },
  ],
  focus: { x: 0, z: 0, radius: 27 },
  previews: {
    kitchen: { position: { x: 13, y: 0, z: -12 }, yaw: Math.PI / 2 },
    hall: { position: { x: -5, y: 0, z: 12 }, yaw: -Math.PI / 2 },
    barrier: { position: { x: -13, y: 0, z: 15 }, yaw: Math.PI },
    balcony: { position: { x: -13, y: UP, z: 11 }, yaw: Math.PI },
    courtyard: { position: { x: -2, y: UP, z: 10 }, yaw: -0.35 },
    ward: { position: { x: 13, y: 0, z: 12 }, yaw: Math.PI },
    upstairs: { position: { x: -13, y: UP, z: -6 }, yaw: Math.PI },
    power: { position: { x: 0, y: 0, z: -12 }, yaw: 0 },
  },
};
