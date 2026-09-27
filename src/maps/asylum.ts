import type { DoorDefinition } from '../core/door.ts';
import type { WallWeaponDefinition } from '../core/wallWeapon.ts';
import type { MysteryBoxDefinition } from '../core/mysteryBox.ts';
import type { Vec3 } from '../core/types.ts';
import type { PropPlacement } from './bunkerProps.ts';
import type { GameMap } from './gameMap.ts';
import { MapBuilder, barriersFromWindows, collisionBoxesFor, compileNavigation, slabShotBlockers } from './mapBuild.ts';
import { BUNKER_MYSTERY_BOXES } from './bunker.ts';

/**
 * Asylum: an original map in the spirit of WaW's second, the split sanatorium. Authored in metres.
 *
 * Ground floor, west to east along one corridor of rooms (z -10..0), each behind a bought door:
 *   Dining hall (spawn, two storeys) | Kitchen | Main hall (the box) | Surgery | Isolation ward (two storeys)
 * The two tall halls reach x -26..-14 and 14..26 and run south to z 8. Each has a stair up to a
 * mezzanine, and a covered balcony joins the mezzanines across the outside of the building (z 0..3),
 * above the courtyard, so the whole map is one loop: WaW's split-and-rejoin layout for a solo player.
 */
const UP = 3.4;
const TALL = 6.8;
const HALL_WEST = -26, HALL_EAST = 26, CORRIDOR_NORTH = -10, CORRIDOR_SOUTH = 0, HALL_SOUTH = 8;
const DOOR_Z = -5, DOOR_WIDTH = 2.4;
/** Room partitions along the corridor, west to east. */
const PARTITIONS = [-14, -4, 6, 14] as const;

const b = new MapBuilder({ wall: 'broken-plaster-brick', trim: 'weathered-concrete-a',
  floor: 'cracked-concrete-floor', stair: 'weathered-concrete-b' });
const door = (at: number) => ({ at, width: DOOR_WIDTH, kind: 'door' as const });
const window = (id: string, at: number, width = 1.3) => ({ id, at, width, kind: 'window' as const });

// Ground floors.
b.floor(HALL_WEST, -14, CORRIDOR_NORTH, HALL_SOUTH, 0);
b.floor(-14, -4, CORRIDOR_NORTH, CORRIDOR_SOUTH, 0);
b.floor(-4, 6, CORRIDOR_NORTH, CORRIDOR_SOUTH, 0);
b.floor(6, 14, CORRIDOR_NORTH, CORRIDOR_SOUTH, 0);
b.floor(14, HALL_EAST, CORRIDOR_NORTH, HALL_SOUTH, 0);

// North frontage: the halls stand two storeys tall, the corridor rooms one.
b.wall('x', CORRIDOR_NORTH, HALL_WEST, -14, 0, TALL, [window('dining-north', -20)], -1);
b.wall('x', CORRIDOR_NORTH, -14, 14, 0, UP,
  [window('kitchen-north', -9), window('hall-north', -2), window('surgery-north', 10)], -1);
b.wall('x', CORRIDOR_NORTH, 14, HALL_EAST, 0, TALL, [window('ward-north', 20)], -1);
// Outer end walls, each with two entries.
b.wall('z', HALL_WEST, CORRIDOR_NORTH, HALL_SOUTH, 0, TALL, [window('dining-west-a', -5), window('dining-west-b', 3)], -1);
b.wall('z', HALL_EAST, CORRIDOR_NORTH, HALL_SOUTH, 0, TALL, [window('ward-east-a', -5), window('ward-east-b', 3)], 1);
// The halls' south walls (their stairs run along them) and courtyard-facing sides, where the balcony
// passes through a doorway on the upper storey.
b.wall('x', HALL_SOUTH, HALL_WEST, -14, 0, TALL);
b.wall('x', HALL_SOUTH, 14, HALL_EAST, 0, TALL);
for (const x of [-14, 14]) {
  b.wall('z', x, CORRIDOR_NORTH, CORRIDOR_SOUTH, 0, TALL, [door(DOOR_Z)]);
  b.wall('z', x, CORRIDOR_SOUTH, HALL_SOUTH, 0, UP);
  b.wall('z', x, CORRIDOR_SOUTH, HALL_SOUTH, UP, TALL - UP, [{ at: 1.5, width: 2.4, kind: 'door' }]);
}
// Inner partitions, and the corridor's courtyard facade (a storey of decorative windows over the balcony).
for (const x of [-4, 6]) b.wall('z', x, CORRIDOR_NORTH, CORRIDOR_SOUTH, 0, UP, [door(DOOR_Z)]);
b.wall('x', CORRIDOR_SOUTH, -14, 14, 0, UP,
  [window('kitchen-courtyard', -9), window('hall-courtyard', 1), window('surgery-courtyard', 10)], 1);
b.wall('x', CORRIDOR_SOUTH, -14, 14, UP, 3,
  [window('balcony-a', -9), window('balcony-b', 1), window('balcony-c', 10)], 1);
// Roofs.
b.ceiling(-14, 14, CORRIDOR_NORTH, CORRIDOR_SOUTH, UP);
b.ceiling(HALL_WEST, -14, CORRIDOR_NORTH, HALL_SOUTH, TALL);
b.ceiling(14, HALL_EAST, CORRIDOR_NORTH, HALL_SOUTH, TALL);

// Upper level: the balcony across the courtyard and a mezzanine in each hall.
const MEZZANINE = 17.5, STAIR_FOOT = 24, STAIR_NORTH = 5.4, STAIR_SOUTH = 7.8;
b.floor(-MEZZANINE, MEZZANINE, CORRIDOR_SOUTH, 3, UP);
for (const side of [-1, 1]) {
  const [inner, outer] = side < 0 ? [-MEZZANINE, -14.2] : [14.2, MEZZANINE];
  b.floor(inner, outer, 3, STAIR_SOUTH, UP);
  // Rails where the mezzanine overlooks the hall floor below.
  b.parapet('z', side * MEZZANINE, CORRIDOR_SOUTH, STAIR_NORTH, UP);
  b.parapet('x', CORRIDOR_SOUTH, inner, outer, UP);
  // The stair runs along the hall's south wall, climbing toward the mezzanine, with a full-height
  // banister wall on its open side.
  const [lowX, highX] = side < 0 ? [-STAIR_FOOT, -MEZZANINE] : [MEZZANINE, STAIR_FOOT];
  b.stair(lowX, highX, STAIR_NORTH, STAIR_SOUTH, 'x', side < 0, 0, UP);
  b.box((lowX + highX) / 2, (UP + 0.95) / 2, STAIR_NORTH - 0.1, highX - lowX, UP + 0.95, 0.2, 'wall');
}
b.parapet('x', 3, -14, 14, UP);
// Posts carry the balcony over the courtyard, clear of the windows' approach lanes.
for (const x of [-12, -5.5, 4.5, 12]) b.box(x, UP / 2, 2.7, 0.4, UP, 0.4, 'wall');

export const ASYLUM_UPPER_HEIGHT = UP;
export const ASYLUM_BOX_CENTER: Vec3 = { x: 3, y: 0.52, z: CORRIDOR_NORTH + 0.2 + 0.525 };
b.box(ASYLUM_BOX_CENTER.x, 0.52, ASYLUM_BOX_CENTER.z, 2.35, 1.04, 0.95, 'barrier');

const planksDoor = (id: string, x: number, cost: number, name: string): DoorDefinition => ({
  id, position: { x, y: 0, z: DOOR_Z }, cost, prompt: `E  Open ${name}  [${cost}]`, interactionRange: 2.6, minFacingDot: 0.3,
  blocker: { min: { x: x - 0.2, y: 0, z: DOOR_Z - DOOR_WIDTH / 2 }, max: { x: x + 0.2, y: 2.85, z: DOOR_Z + DOOR_WIDTH / 2 } },
});
const stairDebris = (id: string, side: number): DoorDefinition => {
  const x = side * (STAIR_FOOT - 1.5), z = (STAIR_NORTH + STAIR_SOUTH) / 2;
  return { id, position: { x, y: 0.8, z }, cost: 1000, prompt: 'E  Clear stair debris  [1000]',
    interactionRange: 2.8, minFacingDot: 0.2,
    blocker: { min: { x: x - 0.4, y: 0, z: STAIR_NORTH }, max: { x: x + 0.4, y: 4.5, z: STAIR_SOUTH } } };
};
export const ASYLUM_DOORS: readonly DoorDefinition[] = [
  planksDoor('kitchen-door', PARTITIONS[0], 750, 'kitchen'),
  planksDoor('hall-door', PARTITIONS[1], 1000, 'main hall'),
  planksDoor('surgery-door', PARTITIONS[2], 1000, 'surgery'),
  planksDoor('ward-door', PARTITIONS[3], 750, 'isolation ward'),
  stairDebris('west-stairs', -1),
  stairDebris('east-stairs', 1),
];

const wallBuy = (id: string, weaponId: string, name: string, cost: number, position: Vec3): WallWeaponDefinition => ({
  id, position, weaponId, weaponCost: cost, ammoCost: cost / 2,
  prompt: `E  ${name} [${cost}] / Ammo [${cost / 2}]`, interactionRange: 2.5, minFacingDot: 0.25,
});
/** Chalk sits 0.24 m off its wall's centre line (just proud of the 0.4 m wall). */
const NORTH = CORRIDOR_NORTH + 0.24, SOUTH = CORRIDOR_SOUTH - 0.24;
export const ASYLUM_WALL_WEAPONS: readonly WallWeaponDefinition[] = [
  wallBuy('dining-kar98k', 'kar98k', 'Kar98k', 200, { x: -23, y: 1, z: NORTH }),
  wallBuy('dining-carbine', 'm1-carbine', 'M1A1 Carbine', 600, { x: HALL_WEST + 0.24, y: 1, z: -1 }),
  wallBuy('kitchen-double-barrel', 'double-barrel', 'Double-Barreled Shotgun', 1200, { x: -6.5, y: 1, z: NORTH }),
  wallBuy('kitchen-thompson', 'thompson', 'Thompson', 1200, { x: -12, y: 1, z: SOUTH }),
  wallBuy('hall-stg44', 'stg44', 'STG-44', 1200, { x: 4, y: 1, z: SOUTH }),
  wallBuy('surgery-trench-gun', 'trench-gun', 'Trench Gun', 1500, { x: 7.8, y: 1, z: NORTH }),
  wallBuy('surgery-mp40', 'mp40', 'MP40', 1000, { x: 12.5, y: 1, z: SOUTH }),
  wallBuy('ward-garand', 'm1-garand', 'M1 Garand', 1200, { x: 23, y: 1, z: NORTH }),
  wallBuy('ward-bar', 'bar', 'BAR', 1800, { x: HALL_EAST - 0.24, y: 1, z: -1 }),
  wallBuy('balcony-m14', 'm14', 'M14', 500, { x: -6, y: UP + 1, z: CORRIDOR_SOUTH + 0.24 }),
];
const ASYLUM_WALL_WEAPON_FACING: Readonly<Record<string, number>> = {
  'dining-kar98k': 0, 'dining-carbine': Math.PI / 2, 'kitchen-double-barrel': 0, 'kitchen-thompson': Math.PI,
  'hall-stg44': Math.PI, 'surgery-trench-gun': 0, 'surgery-mp40': Math.PI, 'ward-garand': 0, 'ward-bar': -Math.PI / 2,
  'balcony-m14': 0,
};
export const ASYLUM_MYSTERY_BOXES: readonly MysteryBoxDefinition[] = [{
  ...BUNKER_MYSTERY_BOXES[0], id: 'hall-box',
  // The box sits against the main hall's north wall; buyers stand south of it.
  position: { x: ASYLUM_BOX_CENTER.x, y: 0.6, z: ASYLUM_BOX_CENTER.z + 0.77 },
}];
export const ASYLUM_PLAYER_SPAWN: Vec3 = { x: -21, y: 0, z: -3 };

const prop = (id: string, asset: string, x: number, y: number, z: number,
  sx: number, sy: number, sz: number, yaw = 0, solid = true, background = false): PropPlacement =>
  ({ id, asset, position: { x, y, z }, size: { x: sx, y: sy, z: sz }, yaw, solid, background });
// Props hug the walls, clear of doorways, stairs and every window's landing.
export const ASYLUM_PROPS: readonly PropPlacement[] = [
  prop('dining-table-a', 'wooden-table', -22, 0, -7.2, 1.8, 0.55, 0.66),
  prop('dining-table-b', 'wooden-table', -18.5, 0, -8.9, 1.8, 0.55, 0.66),
  prop('dining-crate', 'wooden-crate', -15.2, 0, -9.3, 0.85, 0.24, 0.4),
  prop('kitchen-stove', 'barrel-stove', -12.9, 0, -9, 0.6, 0.86, 0.6),
  prop('kitchen-shelf', 'shelf', -4.47, 0, -8.4, 1.01, 2.08, 0.26, -Math.PI / 2),
  prop('kitchen-carton', 'cardboard-box', -13.3, 0, -1.4, 0.39, 0.35, 0.52),
  prop('hall-table', 'wooden-table', -2.2, 0, -1.2, 1.8, 0.55, 0.66),
  prop('hall-radio', 'field-radio', -2.3, 0.55, -1.2, 0.62, 0.44, 0.42, Math.PI, false),
  prop('surgery-crate', 'wooden-crate', 13, 0, -9.3, 0.85, 0.24, 0.4),
  prop('surgery-bags', 'cement-bag', 7.2, 0, -1.2, 0.47, 0.18, 0.7, Math.PI / 2, false),
  prop('ward-hand-truck', 'hand-truck', 25.3, 0, -8.6, 0.6, 1.4, 0.7, -Math.PI / 2),
  prop('ward-barrel', 'explosive-barrel', 25.2, 0, 4.4, 0.58, 0.9, 0.58),
  prop('ward-shelf', 'shelf', 14.53, 0, -8.4, 1.01, 2.08, 0.26, Math.PI / 2),
  prop('balcony-bags', 'cement-bag', -1, UP, 2.4, 0.47, 0.18, 0.7, 0, false),
  prop('courtyard-jeep', 'vehicles/gaz-67', -3, 0, 10.5, 1.8, 1.65, 3.6, 1.2, false, true),
  prop('yard-barrel-a', 'explosive-barrel', 8, 0, 11, 0.58, 0.9, 0.58, 0, false, true),
];

const barriers = barriersFromWindows(b.windows, 6);
const collision = collisionBoxesFor(b.shell, ASYLUM_PROPS);
const ASYLUM_NAVIGATION = compileNavigation(b.surfaces, collision,
  { minX: HALL_WEST + 0.8, maxX: HALL_EAST, minZ: CORRIDOR_NORTH + 0.8, maxZ: HALL_SOUTH }, [0, UP], [
    { id: 'spawn', position: ASYLUM_PLAYER_SPAWN },
    // Both sides of every ground doorway and of the balcony's doorways into the halls.
    ...PARTITIONS.flatMap(x => [
      { id: `door-${x}-west`, position: { x: x - 1, y: 0, z: DOOR_Z } },
      { id: `door-${x}-east`, position: { x: x + 1, y: 0, z: DOOR_Z } }]),
    ...[-1, 1].flatMap(side => [
      { id: `balcony-${side}-in`, position: { x: side * 15.3, y: UP, z: 1.5 } },
      { id: `balcony-${side}-out`, position: { x: side * 12.7, y: UP, z: 1.5 } },
      { id: `mezzanine-${side}`, position: { x: side * 15.8, y: UP, z: 4.2 } }]),
    // The stairs' centre-lines: the foot, eleven points up the flight, and the mezzanine at the top.
    ...[-1, 1].flatMap(side => {
      const z = (STAIR_NORTH + STAIR_SOUTH) / 2, foot = side * STAIR_FOOT, head = side * MEZZANINE;
      return [
        { id: `stair-${side}-foot`, position: { x: foot + side * 0.8, y: 0, z } },
        ...Array.from({ length: 11 }, (_, i) => ({ id: `stair-${side}-${i}`,
          position: { x: foot + (head - foot) * i / 10, y: UP * i / 10, z } })),
        { id: `stair-${side}-head`, position: { x: head - side * 1.2, y: UP, z } },
      ];
    }),
    ...barriers.map(barrier => ({ id: barrier.id, position: barrier.insidePoint })),
  ]);

export const ASYLUM_MAP: GameMap = {
  id: 'asylum', name: 'Asylum', upperHeight: UP,
  greybox: b.shell, prisms: b.prisms, collisionBoxes: collision,
  shotBlockers: slabShotBlockers(b.surfaces, UP), walkSurfaces: b.surfaces, navigation: ASYLUM_NAVIGATION,
  playerSpawn: ASYLUM_PLAYER_SPAWN, windows: b.windows, windowBoards: 6,
  barriers, zombieSpawns: barriers.map(barrier => ({ ...barrier.approachPath[0], barrierId: barrier.id })),
  doors: ASYLUM_DOORS,
  doorStyles: {
    'kitchen-door': { kind: 'planks', yaw: 0, width: DOOR_WIDTH },
    'hall-door': { kind: 'planks', yaw: 0, width: DOOR_WIDTH },
    'surgery-door': { kind: 'planks', yaw: 0, width: DOOR_WIDTH },
    'ward-door': { kind: 'planks', yaw: 0, width: DOOR_WIDTH },
    'west-stairs': { kind: 'debris', yaw: Math.PI / 2, width: STAIR_SOUTH - STAIR_NORTH },
    'east-stairs': { kind: 'debris', yaw: Math.PI / 2, width: STAIR_SOUTH - STAIR_NORTH },
  },
  wallWeapons: ASYLUM_WALL_WEAPONS, wallWeaponFacing: ASYLUM_WALL_WEAPON_FACING,
  mysteryBoxes: ASYLUM_MYSTERY_BOXES, boxCenter: ASYLUM_BOX_CENTER, boxYaw: -Math.PI / 2,
  rails: b.rails, props: ASYLUM_PROPS,
  decals: [
    { asset: 'leaking-grime', x: -20, y: 2.4, z: CORRIDOR_NORTH + 0.211, width: 2.6, height: 2.5, yaw: 0 },
    { asset: 'smear-grime', x: -9, y: 1.6, z: CORRIDOR_SOUTH - 0.211, width: 2.4, height: 2.2, yaw: Math.PI },
    { asset: 'leaking-grime', x: 20, y: 4.5, z: CORRIDOR_NORTH + 0.211, width: 3, height: 2.6, yaw: 0 },
    { asset: 'smear-grime', x: 9, y: 1.5, z: CORRIDOR_NORTH + 0.211, width: 2.5, height: 2.2, yaw: 0 },
  ],
  labels: [
    { text: 'DINING HALL', x: -20, y: 4.4, z: CORRIDOR_NORTH + 0.215, yaw: 0, width: 3, height: 0.5 },
    { text: 'SANATORIUM', x: -2.6, y: 2.95, z: CORRIDOR_NORTH + 0.215, yaw: 0, width: 2.6, height: 0.42 },
    { text: 'SURGERY', x: 10, y: 2.95, z: CORRIDOR_NORTH + 0.215, yaw: 0, width: 2, height: 0.42 },
    { text: 'ISOLATION WARD', x: 20, y: 4.4, z: CORRIDOR_NORTH + 0.215, yaw: 0, width: 3.4, height: 0.5 },
    { text: 'THEY HEAR EVERYTHING', x: -9, y: 2.35, z: CORRIDOR_NORTH + 0.215, yaw: 0, width: 3.2, height: 0.36, color: '#8f2a22' },
  ],
  lights: [{ x: -20, y: 3.2, z: -3 }, { x: -9, y: 2.75, z: -5 }, { x: 1, y: 2.75, z: -5 },
    { x: 10, y: 2.75, z: -5 }, { x: 20, y: 3.2, z: -3 }, { x: 0, y: 5.3, z: 1.5 }],
  rubble: [
    { minX: HALL_WEST + 0.5, maxX: -14.5, minZ: CORRIDOR_NORTH + 0.5, maxZ: STAIR_NORTH - 0.3, y: 0, count: 26 },
    { minX: -13.5, maxX: 13.5, minZ: CORRIDOR_NORTH + 0.5, maxZ: CORRIDOR_SOUTH - 0.5, y: 0, count: 40 },
    { minX: 14.5, maxX: HALL_EAST - 0.5, minZ: CORRIDOR_NORTH + 0.5, maxZ: STAIR_NORTH - 0.3, y: 0, count: 26 },
    { minX: -13.5, maxX: 13.5, minZ: 0.4, maxZ: 2.7, y: UP, count: 18 },
  ],
  focus: { x: 0, z: -1, radius: 30 },
  previews: {
    kitchen: { position: { x: -12.5, y: 0, z: -5 }, yaw: -Math.PI / 2 },
    hall: { position: { x: 1, y: 0, z: -2 }, yaw: 0 },
    barrier: { position: { x: -9, y: 0, z: -7.5 }, yaw: 0 },
    balcony: { position: { x: -12, y: UP, z: 1.5 }, yaw: -Math.PI / 2 },
    courtyard: { position: { x: 0, y: UP, z: 1.8 }, yaw: Math.PI },
    ward: { position: { x: 16, y: 0, z: -3 }, yaw: -Math.PI / 2 },
    upstairs: { position: { x: -15.8, y: UP, z: 6.6 }, yaw: Math.PI / 2 },
  },
};
