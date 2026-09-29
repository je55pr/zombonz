import type { DoorDefinition, PowerSwitchDefinition } from '../core/door.ts';
import type { BarrierDefinition } from '../core/barrier.ts';
import type { WallWeaponDefinition } from '../core/wallWeapon.ts';
import type { EquipmentBuyDefinition } from '../core/equipment.ts';
import { hazardBox, type HazardDefinition } from '../core/hazard.ts';
import { mysteryBoxBlocker, type MysteryBoxDefinition, type MysteryBoxLocation } from '../core/mysteryBox.ts';
import type { PerkId, PerkMachineDefinition } from '../core/perks.ts';
import type { TrapDefinition } from '../core/traps.ts';
import type { Vec3 } from '../core/types.ts';
import type { PropPlacement } from './bunkerProps.ts';
import type { GameMap, MapTree, MapWindow } from './gameMap.ts';
import { MapBuilder, barriersFromWindows, collisionBoxesFor, compileNavigation, entrySpawns, slabShotBlockers, windowPoint,
  type Opening } from './mapBuild.ts';
import { Scenery, onGround } from './scenery.ts';
import { BUNKER_MYSTERY_BOXES } from './bunker.ts';

/**
 * Asylum follows WaW Verrückt's plan (docs/asylum-map.md): a two-storey sanatorium on four sides of an
 * open courtyard, about 60 x 51 m, authored in metres with x east and z south.
 *
 *   South, ground:  the German (west) and American (east) starts side by side, split by the power door,
 *                   each with an alcove reaching into the courtyard.
 *   West, upper:    the German stair climbs from the start to the German balcony, a gallery over the
 *                   courtyard (trap, Double Tap), then Left Upstairs (toilets) in the north-west corner.
 *   East:           the American start opens onto a long ground hallway (and a BAR back room); its stair
 *                   climbs to the right balcony above the hallway (trap), then the Speed Cola room.
 *   North, upper:   Left Upstairs -> Power Room <- Kitchen <- Speed Cola room. The box starts by the switch.
 *
 * Both routes climb early and meet in the power room at the far end, as in the original.
 */
const UP = 4, HIGH = 3.6;
const WEST = -30, EAST = 30, NORTH = -32, SOUTH = 19;
/** The courtyard: open to the sky, a fountain in the middle. */
const YARD = { minX: -19, maxX: 16, minZ: -20, maxZ: -3 };
const DOOR_WIDTH = 2.4;

// A sanatorium: grimy tiles to shoulder height, peeling paint above and overhead, worn linoleum
// underfoot, old boards on the stairs and weathered concrete for sills, ledges and railings.
const b = new MapBuilder({ wall: 'peeling-paint-wall', trim: 'weathered-concrete-a', floor: 'old-linoleum',
  stair: 'old-wood-floor', ceiling: 'peeling-paint-wall', wainscot: { look: 'dirty-tiles', height: 1.35 } });
const door = (at: number): Opening => ({ at, width: DOOR_WIDTH, kind: 'door' });
const window = (id: string, at: number): Opening => ({ id, at, width: 1.35, kind: 'window' });

// ---- Ground floor: the two starts, their courtyard alcoves, the American hallway and the BAR room.
// German start, with no floor in the dead space under its stair.
b.floor(-25.8, 3, 3, SOUTH, 0);
b.floor(WEST, -25.8, 12, SOUTH, 0);
b.floor(WEST, -25.8, 3, 4, 0);
b.floor(3, 16, 3, SOUTH, 0); // American start
b.floor(-19, -11, -3, 3, 0); // German alcove
b.floor(-6, 11, -3, 3, 0); // shared alcove, split by the power door's wall
b.floor(16, 25, 9, 14, 0); // BAR back room
b.floor(16, EAST, YARD.minZ, 9, 0); // American hallway

// Outer walls, two storeys. Ground windows take zombies, and so do the upstairs ones in ASYLUM_UPPER_ENTRIES.
b.wall('z', WEST, NORTH, SOUTH, 0, UP, [window('german-west', 14)], -1);
b.wall('z', WEST, NORTH, SOUTH, UP, HIGH, [window('left-upstairs-west', -24), window('german-balcony-west', -8)], -1);
b.wall('x', NORTH, WEST, EAST, 0, UP);
b.wall('x', NORTH, WEST, EAST, UP, HIGH, [window('left-upstairs-north', -27), window('power-north', -8),
  window('kitchen-north', 8), window('upper-speed-cola-north', 23)], -1);
b.wall('z', EAST, NORTH, 9, 0, UP, [window('hallway-east', -4)], 1);
b.wall('z', EAST, NORTH, 8, UP, HIGH, [window('speed-cola-east', -25), window('right-balcony-east', -9)], 1);
b.wall('x', SOUTH, WEST, 16, 0, UP, [window('german-south', -7), window('american-south-a', 8), window('american-south-b', 13)], 1);
b.wall('x', SOUTH, WEST, 16, UP, HIGH, [window('upper-south-a', -20), window('upper-south-b', 6)], 1);
b.wall('x', 9, 25, EAST, 0, UP);
b.wall('z', 25, 9, 14, 0, UP);
b.wall('x', 14, 16, 25, 0, UP);
b.wall('x', 8, 16, EAST, UP, HIGH, [window('right-balcony-south', 27)], 1);

// The courtyard's walls. Its ground north and west sides are blind: the rooms above them start upstairs.
b.wall('x', YARD.minZ, YARD.minX, EAST, 0, UP); // also closes the hallway's north end
b.wall('z', YARD.minX, YARD.minZ, 3, 0, UP);
b.wall('x', YARD.minZ, WEST, EAST, UP, HIGH, [door(-24), window('upper-power-courtyard', -9),
  window('upper-kitchen-courtyard', 8), door(18.5)], 1);
// The starts' alcoves push into the courtyard, each with a window.
b.wall('x', -3, -19, -11, 0, UP, [window('german-alcove', -15)], -1);
b.wall('z', -11, -3, 3, 0, UP);
b.wall('x', 3, -11, -6, 0, UP);
b.wall('z', -6, -3, 3, 0, UP);
b.wall('x', -3, -6, 11, 0, UP, [window('german-courtyard', -2), window('american-courtyard', 7)], -1);
b.wall('z', 11, -3, 3, 0, UP);
b.wall('x', 3, 11, 16, 0, UP);
b.wall('x', 3, -19, 16, UP, HIGH, [window('upper-south-courtyard-a', -12), window('upper-south-courtyard-b', 5)], -1);
b.wall('x', 3, WEST, -19, 0, UP); // the German start's north wall, behind the balcony's blind ground floor
// The power door between the starts, the hallway and BAR doors, and a partition in the German start.
b.wall('z', 3, -3, SOUTH, 0, UP, [door(6)]);
b.wall('z', 16, YARD.minZ, SOUTH, 0, UP, [window('hallway-courtyard', -12), door(6), door(11.5)], -1);
b.wall('x', 9, 16, 25, 0, UP);
b.wall('z', -11, 11, SOUTH, 0, UP);

// ---- Upper floor.
b.floor(WEST, YARD.minX, YARD.minZ, 4, UP); // German balcony
b.floor(WEST, -18, NORTH, YARD.minZ, UP); // Left Upstairs
b.floor(-18, 0, NORTH, YARD.minZ, UP); // Power Room
b.floor(0, 16, NORTH, YARD.minZ, UP); // Kitchen
b.floor(16, EAST, NORTH, YARD.minZ, UP); // Speed Cola room
// The right balcony over the hallway, around the American stairwell.
b.floor(16, 21, YARD.minZ, 8, UP);
b.floor(26, EAST, YARD.minZ, 8, UP);
b.floor(21, 26, YARD.minZ, -16, UP);
b.floor(21, 26, -8, 8, UP);
for (const x of [-18, 0, 16]) b.wall('z', x, NORTH, YARD.minZ, UP, HIGH, [door(-26)]);
b.wall('z', 16, -3, SOUTH, UP, HIGH); // above the American start
// Balconies are open to the courtyard behind a parapet.
b.parapet('z', YARD.minX, YARD.minZ, 4, UP);
b.parapet('x', 4, -25.7, YARD.minX, UP);
b.parapet('z', 16, YARD.minZ, -3, UP);
b.parapet('x', -8, 21, 26, UP);

// ---- Stairs, each with a banister wall on its open side.
b.stair(-29.8, -25.8, 4, 12, 'z', false, 0, UP, 24); // German: climbs north to the balcony
b.box(-25.7, (UP + 0.95) / 2, 8, 0.2, UP + 0.95, 8, 'wall');
b.stair(21, 26, -16, -8, 'z', false, 0, UP, 24); // American: climbs north to the right balcony
for (const x of [20.9, 26.1]) b.box(x, (UP + 0.95) / 2, -12, 0.2, UP + 0.95, 8, 'wall');

// ---- Roofs and ceilings (visual only).
b.ceiling(-25.7, 3, 4, SOUTH, UP); // clear of the German stair and the balcony above
b.ceiling(YARD.minX, 3, 3, 4, UP);
b.ceiling(WEST, -25.7, 12, SOUTH, UP);
b.ceiling(3, 16, 3, SOUTH, UP);
b.ceiling(-19, -11, -3, 3, UP);
b.ceiling(-6, 11, -3, 3, UP);
b.ceiling(16, 25, 9, 14, UP);
b.ceiling(WEST, EAST, NORTH, YARD.minZ, UP + HIGH);
b.ceiling(WEST, YARD.minX, YARD.minZ, 4, UP + HIGH);
b.ceiling(16, EAST, YARD.minZ, 8, UP + HIGH);
b.ceiling(WEST, 16, 3, SOUTH, UP + HIGH);

// ---- The courtyard: cobbles, and a stone fountain (drawn round by the renderer).
const FOUNTAIN = { x: (YARD.minX + YARD.maxX) / 2, z: (YARD.minZ + YARD.maxZ) / 2 };
b.box(FOUNTAIN.x, -0.1, FOUNTAIN.z, YARD.maxX - YARD.minX, 0.2, YARD.maxZ - YARD.minZ, 'floor', false, 'cobblestone');
// The fountain's basin (5.4 m across the lip) stands in the zombies' way.
b.box(FOUNTAIN.x, 0.35, FOUNTAIN.z, 5.4, 0.7, 5.4, 'wall').visible = false;

// ---- The box starts in the power room, by the power switch's panel.
export const ASYLUM_UPPER_HEIGHT = UP;
export const ASYLUM_BOX_CENTER: Vec3 = { x: -12, y: UP + 0.52, z: NORTH + 0.2 + 0.525 };

/** A boarded door in a wall along z (at x) or along x (at z). */
const plankDoor = (id: string, x: number, y: number, z: number, along: 'x' | 'z', cost: number): DoorDefinition => ({
  id, position: { x, y, z }, cost, interactionRange: 2.6, minFacingDot: 0.2,
  blocker: along === 'z'
    ? { min: { x: x - 0.2, y, z: z - DOOR_WIDTH / 2 }, max: { x: x + 0.2, y: y + 2.85, z: z + DOOR_WIDTH / 2 } }
    : { min: { x: x - DOOR_WIDTH / 2, y, z: z - 0.2 }, max: { x: x + DOOR_WIDTH / 2, y: y + 2.85, z: z + 0.2 } },
});
const stairDebris = (id: string, minX: number, maxX: number, z: number, height: number): DoorDefinition => ({
  id, position: { x: (minX + maxX) / 2, y: height, z }, cost: 1000, kind: 'debris',
  interactionRange: 2.8, minFacingDot: 0.2,
  blocker: { min: { x: minX, y: 0, z: z - 0.4 }, max: { x: maxX, y: UP + 1, z: z + 0.4 } },
});
export const ASYLUM_DOORS: readonly DoorDefinition[] = [
  // Verrückt's electric door between the starts opens only with the power switch.
  { ...plankDoor('start-gate', 3, 0, 6, 'z', 0), requiresPower: true },
  stairDebris('german-stairs', -29.8, -25.8, 10.8, 0.6),
  plankDoor('left-upstairs', -24, UP, YARD.minZ, 'x', 750),
  plankDoor('power-west', -18, UP, -26, 'z', 1000),
  plankDoor('american-hallway', 16, 0, 6, 'z', 750),
  plankDoor('bar-room', 16, 0, 11.5, 'z', 750),
  stairDebris('american-stairs', 21, 26, -9, 0.5),
  plankDoor('right-upstairs', 18.5, UP, YARD.minZ, 'x', 750),
  plankDoor('kitchen', 16, UP, -26, 'z', 1000),
  plankDoor('power-east', 0, UP, -26, 'z', 750),
];

const wallBuy = (id: string, weaponId: string, name: string, cost: number, position: Vec3): WallWeaponDefinition => ({
  id, position, weaponId, weaponCost: cost, ammoCost: cost / 2,
  prompt: `E  ${name} [${cost}] / Ammo [${cost / 2}]`, interactionRange: 2.5, minFacingDot: 0.25,
});
/** Chalk sits 0.24 m off its wall's centre line; y is 1 m above the floor it serves. */
const G = 1, U = UP + 1;
export const ASYLUM_WALL_WEAPONS: readonly WallWeaponDefinition[] = [
  wallBuy('german-kar98k', 'kar98k', 'Kar98k', 200, { x: -16, y: G, z: SOUTH - 0.24 }),
  // No Gewehr 43 model yet; the Garand stands in, at Verrückt's price.
  wallBuy('german-gewehr', 'm1-garand', 'Gewehr 43', 600, { x: -11.24, y: G, z: 15 }),
  wallBuy('american-garand', 'm1-garand', 'M1 Garand', 600, { x: 10.76, y: G, z: 0 }),
  wallBuy('american-springfield', 'springfield', 'Springfield', 200, { x: 3.24, y: G, z: 14 }),
  wallBuy('hallway-thompson', 'thompson', 'Thompson', 1200, { x: EAST - 0.24, y: G, z: -13 }),
  wallBuy('hallway-double-barrel', 'double-barrel', 'Double-Barreled Shotgun', 1200, { x: EAST - 0.24, y: G, z: 3 }),
  wallBuy('back-room-bar', 'bar', 'BAR', 2500, { x: 21, y: G, z: 13.76 }),
  wallBuy('german-balcony-mp40', 'mp40', 'MP40', 1000, { x: WEST + 0.24, y: U, z: -2 }),
  wallBuy('german-balcony-double-barrel', 'double-barrel', 'Double-Barreled Shotgun', 1200, { x: WEST + 0.24, y: U, z: -13 }),
  wallBuy('left-upstairs-stg44', 'stg44', 'STG-44', 1200, { x: WEST + 0.24, y: U, z: -29 }),
  wallBuy('left-upstairs-trench-gun', 'trench-gun', 'Trench Gun', 1500, { x: -22, y: U, z: NORTH + 0.24 }),
  wallBuy('right-balcony-trench-gun', 'trench-gun', 'Trench Gun', 1500, { x: EAST - 0.24, y: U, z: 2 }),
  wallBuy('right-balcony-bar', 'bar', 'BAR', 2500, { x: EAST - 0.24, y: U, z: -17.5 }),
  // No sawed-off model yet; the double-barrel stands in, at Verrückt's price.
  wallBuy('speed-cola-sawed-off', 'double-barrel', 'Sawed-Off Shotgun', 1200, { x: EAST - 0.24, y: U, z: -29.5 }),
];
const ASYLUM_WALL_WEAPON_FACING: Readonly<Record<string, number>> = {
  'german-kar98k': Math.PI, 'german-gewehr': -Math.PI / 2, 'american-garand': -Math.PI / 2,
  'american-springfield': Math.PI / 2, 'hallway-thompson': -Math.PI / 2, 'hallway-double-barrel': -Math.PI / 2,
  'back-room-bar': Math.PI, 'german-balcony-mp40': Math.PI / 2, 'german-balcony-double-barrel': Math.PI / 2,
  'left-upstairs-stg44': Math.PI / 2, 'left-upstairs-trench-gun': 0, 'right-balcony-trench-gun': -Math.PI / 2,
  'right-balcony-bar': -Math.PI / 2, 'speed-cola-sawed-off': -Math.PI / 2,
};
/**
 * A box spot against a wall: `center` is 0.725 m off the wall line, and buyers stand 0.77 m in front.
 * `yaw` turns the box's front: pi/2 faces -z, -pi/2 faces +z, 0 faces +x and pi faces -x.
 */
const boxSpot = (id: string, x: number, y: number, z: number, yaw: number): MysteryBoxLocation => {
  const front = { x: Math.cos(yaw), z: -Math.sin(yaw) };
  return { id, center: { x, y: y + 0.52, z }, yaw,
    position: { x: x + front.x * 0.77, y: y + 0.6, z: z + front.z * 0.77 } };
};
// Verrückt's box spots from the room guides: the power room (where it starts), the German start,
// the German balcony, Left Upstairs and the hallway.
export const ASYLUM_BOX_SPOTS: readonly MysteryBoxLocation[] = [
  boxSpot('power-room', ASYLUM_BOX_CENTER.x, UP, ASYLUM_BOX_CENTER.z, -Math.PI / 2),
  boxSpot('german-start', -22, 0, SOUTH - 0.725, Math.PI / 2),
  boxSpot('german-balcony', YARD.minX - 0.725, UP, -12, Math.PI),
  boxSpot('left-upstairs', -20.6, UP, YARD.minZ - 0.725, Math.PI / 2),
  boxSpot('hallway', EAST - 0.725, 0, -16.6, Math.PI),
];
export const ASYLUM_MYSTERY_BOXES: readonly MysteryBoxDefinition[] = [{
  ...BUNKER_MYSTERY_BOXES[0], id: 'power-box', position: ASYLUM_BOX_SPOTS[0].position, locations: ASYLUM_BOX_SPOTS,
}];

// ---- Power, perks and traps: the switch sits on the power room's panel.
// The switch is a lever on the power box, which stands out 0.64 m from the wall.
export const ASYLUM_POWER_SWITCH: PowerSwitchDefinition = { position: { x: -4, y: UP + 1.1, z: NORTH + 0.95 } };
/** A perk machine's buy point, a metre in front of the 1.2 x 0.9 m body that stands against a wall. */
const perkSpots: Array<{ id: string; perk: PerkId; x: number; y: number; z: number; facing: number }> = [
  { id: 'juggernog', perk: 'juggernog', x: -22, y: 0, z: 3 + 0.65, facing: 0 }, // German start, north wall
  { id: 'double-tap', perk: 'double-tap', x: WEST + 0.65, y: UP, z: -17.5, facing: Math.PI / 2 }, // German balcony
  { id: 'quick-revive', perk: 'quick-revive', x: 16 - 0.65, y: 0, z: 16.5, facing: -Math.PI / 2 }, // American start
  { id: 'speed-cola', perk: 'speed-cola', x: 27, y: UP, z: NORTH + 0.65, facing: 0 }, // Speed Cola room
];
for (const spot of perkSpots) {
  const across = Math.abs(Math.sin(spot.facing)) > 0.5;
  // The machine's solid body; the renderer draws the vending machine model in it.
  b.box(spot.x, spot.y + 1.05, spot.z, across ? 0.9 : 1.2, 2.1, across ? 1.2 : 0.9, 'metal').visible = false;
}
export const ASYLUM_PERK_MACHINES: readonly PerkMachineDefinition[] = perkSpots.map(spot => ({
  id: spot.id, perk: spot.perk,
  position: { x: spot.x + Math.sin(spot.facing), y: spot.y + 1, z: spot.z + Math.cos(spot.facing) },
}));
const ASYLUM_PERK_FACING = Object.fromEntries(perkSpots.map(spot => [spot.id, spot.facing]));
/** An electric trap across a balcony: floor to head height, pulled from a handle on the outer wall. */
export const ASYLUM_TRAPS: readonly TrapDefinition[] = [
  { id: 'german-balcony-trap', name: 'electric trap', cost: 1000, switchPosition: { x: WEST + 0.25, y: UP + 1.2, z: 1.2 },
    zone: { min: { x: WEST + 0.2, y: UP - 0.5, z: -6.5 }, max: { x: YARD.minX - 0.2, y: UP + 2.5, z: -4 } } },
  { id: 'right-balcony-trap', name: 'electric trap', cost: 1000, switchPosition: { x: EAST - 0.25, y: UP + 1.2, z: -5.5 },
    zone: { min: { x: 16.2, y: UP - 0.5, z: -3 }, max: { x: EAST - 0.2, y: UP + 2.5, z: -0.5 } } },
];
/** Solo starts on the German side, as in WaW. */
export const ASYLUM_PLAYER_SPAWN: Vec3 = { x: -18, y: 0, z: 9 };

const prop = (id: string, asset: string, x: number, y: number, z: number,
  sx: number, sy: number, sz: number, yaw = 0, solid = true, background = false): PropPlacement =>
  ({ id, asset, position: { x, y, z }, size: { x: sx, y: sy, z: sz }, yaw, solid, background });
// Props hug the walls, clear of doorways, stairs, wall buys and every window's landing.
export const ASYLUM_PROPS: readonly PropPlacement[] = [
  prop('german-table', 'wooden-table', -4, 0, 17.9, 1.8, 0.55, 0.66),
  prop('german-radio', 'field-radio', -4.1, 0.55, 17.9, 0.62, 0.44, 0.42, Math.PI, false),
  prop('american-carton', 'cardboard-box', 4, 0, 18.3, 0.39, 0.35, 0.52),
  prop('hallway-crate', 'wooden-crate', 29.2, 0, -18.8, 0.85, 0.24, 0.4, Math.PI / 2),
  prop('kitchen-stove', 'barrel-stove', 12, UP, -31.2, 0.6, 0.86, 0.6),
  prop('kitchen-table', 'wooden-table', 4, UP, -31.3, 1.8, 0.55, 0.66),
  prop('power-bags', 'cement-bag', -16.5, UP, -21, 0.47, 0.18, 0.7, 0, false),
  prop('left-upstairs-shelf', 'shelf', -18.47, UP, -30.5, 1.01, 2.08, 0.26, -Math.PI / 2),
  // Sanatorium furniture. Iron beds lie along walls, clear of every window landing and chalk.
  prop('german-bed', 'hospital-bed', -8.5, 0, 3.7, 0.9, 1.2, 2, Math.PI / 2),
  prop('german-cabinet', 'drawer-cabinet', -29.5, 0, 17.5, 1.14, 1.88, 0.49, Math.PI / 2),
  prop('german-clock', 'wall-clock', -19, 2.5, 18.76, 0.32, 0.32, 0.05, Math.PI, false),
  prop('american-bed-a', 'hospital-bed', 3.7, 0, 10.5, 0.9, 1.2, 2),
  prop('american-bed-b', 'hospital-bed', 10.5, 0, 18.3, 0.9, 1.2, 2, Math.PI / 2),
  prop('hallway-wheelchair', 'wheelchair', 16.75, 0, -19.3, 0.82, 1.1, 1.09, Math.PI / 2),
  prop('hallway-crutches', 'crutches', 29.7, 0, -6.5, 0.38, 1.6, 0.2, -Math.PI / 2 + 0.25, false),
  prop('hallway-shelves', 'steel-shelves', 29.5, 0, -9.5, 1.1, 2.15, 0.5, Math.PI / 2),
  prop('back-room-shelves', 'steel-shelves', 24.5, 0, 12.2, 1.1, 2.15, 0.5, -Math.PI / 2),
  prop('left-upstairs-bed', 'hospital-bed', -24.5, UP, -31.3, 0.9, 1.2, 2, Math.PI / 2),
  prop('power-box', 'power-box', -4, UP + 0.8, -31.48, 0.74, 0.8, 0.64, 0, false),
  prop('power-generator', 'generator', -1.5, UP, -31.1, 1.2, 0.85, 0.82),
  prop('power-pipes', 'industrial-pipes', -6, UP + 0.4, -31.65, 1.4, 1.95, 0.31, 0, false),
  prop('kitchen-chair-a', 'wooden-chair', 3.3, UP, -30.4, 0.46, 1.0, 0.44, Math.PI, false),
  prop('kitchen-chair-b', 'wooden-chair', 4.8, UP, -30.4, 0.46, 1.0, 0.44, Math.PI, false),
  prop('kitchen-cabinet', 'drawer-cabinet', 10, UP, -20.45, 1.14, 1.88, 0.49, Math.PI),
  prop('speed-cola-desk', 'office-desk', 22.5, UP, -31.3, 2, 0.79, 0.95),
  prop('speed-cola-chair', 'wooden-chair', 22.5, UP, -30.3, 0.46, 1.0, 0.44, 0, false),
  // The traps' switches: a small utility box on the wall under each status lamp.
  prop('german-trap-box', 'utility-box', WEST + 0.31, UP + 0.9, 1.2, 0.46, 0.56, 0.22, Math.PI / 2, false),
  prop('right-trap-box', 'utility-box', EAST - 0.31, UP + 0.9, -5.5, 0.46, 0.56, 0.22, -Math.PI / 2, false),
  // Left out in the courtyard.
  prop('courtyard-wheelchair', 'wheelchair', -11.5, 0, -4.4, 0.82, 1.1, 1.09, 2.4),
];

/**
 * What explodes when shot (core/hazard.ts): fuel barrels in the BAR room and in the courtyard's north-west
 * corner, and an abandoned staff truck in the grounds, a few metres from where the German start's south windows'
 * zombies appear.
 */
export const ASYLUM_HAZARDS: readonly HazardDefinition[] = [
  { id: 'back-room-barrel-a', kind: 'barrel', position: { x: 24.3, y: 0, z: 9.7 }, yaw: 0 },
  { id: 'back-room-barrel-b', kind: 'barrel', position: { x: 23.5, y: 0, z: 9.65 }, yaw: 0.4 },
  { id: 'courtyard-barrel-a', kind: 'barrel', position: { x: -17.6, y: 0, z: -18.4 }, yaw: 0 },
  { id: 'courtyard-barrel-b', kind: 'barrel', position: { x: -16.7, y: 0, z: -18.7 }, yaw: 0.7 },
  { id: 'grounds-truck', kind: 'truck', position: { x: -12.5, y: 0, z: 38.6 }, yaw: 1.35 },
];
/** Bouncing Betties, sold from the hallway's east wall between the Thompson and the crates. */
export const ASYLUM_EQUIPMENT: readonly EquipmentBuyDefinition[] = [
  { id: 'hallway-betty', item: 'bouncing-betty', position: { x: EAST - 0.24, y: G, z: -16.2 }, cost: 1000, refillCost: 500 },
];
const ASYLUM_EQUIPMENT_FACING: Readonly<Record<string, number>> = { 'hallway-betty': -Math.PI / 2 };

// Verrückt's upstairs entries, where zombies climb in off the roofs: one on the German balcony, two
// in Left Upstairs, two on the right balcony, and one each in the Speed Cola room, kitchen and power room.
export const ASYLUM_UPPER_ENTRIES = ['german-balcony-west', 'left-upstairs-west', 'left-upstairs-north', 'power-north',
  'kitchen-north', 'speed-cola-east', 'right-balcony-east', 'right-balcony-south'];
// Single-storey brick wings along the outside walls, roofed at the upper floor's level, under every
// upstairs entry: zombies walk in from the grounds, climb a wing's outer wall and cross its roof.
const WINGS = [
  { minX: WEST - 5.2, maxX: WEST - 0.2, minZ: NORTH - 0.2, maxZ: -2, chimneys: [[-32.7, -16]] },
  { minX: WEST - 5.2, maxX: 14, minZ: NORTH - 5.2, maxZ: NORTH - 0.2, chimneys: [[-17.5, -34.7], [0, -34.7]] },
  { minX: EAST + 0.2, maxX: EAST + 5.2, minZ: NORTH - 0.2, maxZ: -7, chimneys: [[32.7, -17]] },
  // Beside the BAR room, under the right balcony's south window.
  { minX: 25.2, maxX: EAST + 0.2, minZ: 9.2, maxZ: 15, chimneys: [] as number[][] },
];
for (const wing of WINGS) {
  const cx = (wing.minX + wing.maxX) / 2, cz = (wing.minZ + wing.maxZ) / 2, sx = wing.maxX - wing.minX, sz = wing.maxZ - wing.minZ;
  b.box(cx, (UP - 0.3) / 2, cz, sx, UP - 0.3, sz, 'wall', true, 'broken-plaster-brick');
  b.box(cx, UP - 0.15, cz, sx, 0.3, sz, 'upperFloor', false, 'cracked-concrete-floor');
  for (const [x, z] of wing.chimneys) b.box(x, UP + 1, z, 0.9, 2, 0.9, 'wall', true, 'broken-plaster-brick');
}
/** A wing's outer face, as a distance out from the window line of each upstairs entry above it. */
const WING_FACE: Readonly<Record<string, number>> = Object.fromEntries(ASYLUM_UPPER_ENTRIES.map(id => [id, id === 'right-balcony-south' ? 7 : 5.2]));
const windowById = (id: string): MapWindow => b.windows.find(w => w.id === id)!;
/**
 * How zombies come in, beyond the last 2.4 m every route shares: from 16-18 m out in the grounds to the
 * ground windows, across the courtyard (around the fountain) to its windows, and for the upstairs
 * windows, in from the grounds to the wing below, straight up its wall, then across its roof.
 */
const ENTRY_ROUTES: Readonly<Record<string, Vec3[]>> = {
  ...Object.fromEntries(['german-west', 'hallway-east'].map(id => [id, [windowPoint(windowById(id), 18, 0.6)]])),
  // The south front's zombies start a little closer, short of the gatehouse and the car.
  ...Object.fromEntries(['german-south', 'american-south-a', 'american-south-b'].map(id => [id, [windowPoint(windowById(id), 16, 0.6)]])),
  ...Object.fromEntries(ASYLUM_UPPER_ENTRIES.map(id => {
    const w = windowById(id), face = WING_FACE[id] + 0.45, ground = (d: number) => ({ ...windowPoint(w, d, 0.6), y: 0 });
    return [id, [ground(id === 'right-balcony-south' ? 26 : 20), ground(face), windowPoint(w, face, 0.6)]];
  })),
  'german-alcove': [windowPoint(windowById('german-alcove'), 13.8, 0.6)],
  'german-courtyard': [onGround(-8.5, -16.8), onGround(-6.2, -8)],
  'american-courtyard': [windowPoint(windowById('american-courtyard'), 13.8, 0.6)],
  'hallway-courtyard': [onGround(3, -16.8), onGround(9.5, -11.4)],
};
// The German balcony's other entry: zombies climb the courtyard wall and over the railing.
const RAILING = { x: YARD.minX, z: -16 };
export const ASYLUM_RAILING_ENTRY: BarrierDefinition = {
  id: 'german-balcony-railing', position: { x: RAILING.x, y: UP, z: RAILING.z }, outward: { x: 1, y: 0, z: 0 },
  width: 1.4, maxBoards: 0, vaultTicks: 150,
  approachPath: [onGround(-6, -16.8), { x: RAILING.x + 5, y: 0, z: RAILING.z + 0.6 },
    { x: RAILING.x + 2.4, y: 0, z: RAILING.z + 0.6 }, { x: RAILING.x + 0.6, y: 0, z: RAILING.z }],
  insidePoint: { x: RAILING.x - 0.95, y: UP, z: RAILING.z },
};
// A drainpipe up the wall marks the climb.
b.box(RAILING.x + 0.28, UP / 2 + 0.5, RAILING.z - 0.75, 0.12, UP + 1, 0.12, 'metal', false);
const barriers = [...barriersFromWindows(b.windows, 6, ASYLUM_UPPER_ENTRIES, ENTRY_ROUTES), ASYLUM_RAILING_ENTRY];
/** Where zombies appear besides the start of each route (see entrySpawns), where the default scatter won't fit. */
const SPAWN_SPOTS: Readonly<Record<string, Vec3[]>> = {
  // Across the courtyard, clear of the fountain and the beds.
  'german-balcony-railing': [onGround(-8.2, -18.2), onGround(-3.6, -18.6)],
  'hallway-courtyard': [onGround(0.8, -18.4), onGround(4.6, -18.9)],
  'german-courtyard': [onGround(-10.8, -18.4), onGround(-6.8, -18.9)],
};

// ---- The courtyard, overgrown: raised beds of dead shrubs, benches and lamps, clear of every route.
const yard = new Scenery();
const COURTYARD_BEDS = [
  { minX: 10.5, maxX: 15.3, minZ: -19.4, maxZ: -14 },
  { minX: 9.2, maxX: 15.3, minZ: -9.3, maxZ: -4.8 },
  { minX: -12.8, maxX: -10, minZ: -13.5, maxZ: -6.5 },
];
for (const bed of COURTYARD_BEDS) yard.bed(bed);
yard.bench(-1.5, -18.8, 'x');
yard.bench(3.3, -7.1, 'z');
yard.lampPost(-9.5, -4.5);
yard.lampPost(10, -13.2);
b.shell.push(...yard.boxes);

// ---- The grounds: a brick wall all round with a gateway to the south, a gatehouse, outbuildings and a
// drive up to the boarded main entrance. Zombies cross them to the building.
export const ASYLUM_GROUNDS = { minX: -56, maxX: 56, minZ: -60, maxZ: 45 };
const grounds = new Scenery();
const GR = ASYLUM_GROUNDS;
grounds.wall('x', GR.minZ, GR.minX, GR.maxX);
grounds.wall('z', GR.minX, GR.minZ, GR.maxZ);
grounds.wall('z', GR.maxX, GR.minZ, GR.maxZ);
grounds.wall('x', GR.maxZ, GR.minX, GR.maxX, { gaps: [[0, 7.2]] });
grounds.gate('x', GR.maxZ, 0, 5);
grounds.building({ minX: 5.5, maxX: 11.5, minZ: 38, maxZ: 42.5 }, { windows: [['north', 1.8], ['north', 4.2]], door: ['west', 2.2] });
grounds.building({ minX: -46, maxX: -42, minZ: 26, maxZ: 29.5 }, { height: 2.4, walls: 'old-planks', pitch: 1.1, door: ['east', 1.7] });
grounds.building({ minX: 38, maxX: 45, minZ: -52, maxZ: -42 }, { height: 3.6, pitch: 2.4, roof: 'weathered-concrete-b',
  windows: [['west', 2.5], ['west', 7.5]], door: ['south', 3.5] });
// A greenhouse, long since stripped of its glass: a brick base and an iron frame.
grounds.box(-46, 0.35, -51, 8, 0.7, 6, 'broken-plaster-brick', true);
for (let x = -50; x <= -42 + 1e-6; x += 2) {
  for (const z of [-54, -48]) grounds.box(x, 1.7, z, 0.08, 2, 0.08, 'rusted-metal');
  // Rafters rising 1 m over 3 m to the ridge.
  for (const side of [-1, 1]) grounds.box(x, 3.2, -51 + side * 1.5, 0.08, 0.08, 3.16, 'rusted-metal', false, { rotationX: side * 0.32 });
}
for (const z of [-54, -48]) grounds.box(-46, 2.7, z, 8, 0.08, 0.08, 'rusted-metal');
grounds.box(-46, 3.7, -51, 8, 0.08, 0.08, 'rusted-metal');
// The drive from the gateway to the main entrance, and the lamps along it.
grounds.box(0.5, 0.01, 32.3, 4.4, 0.02, 25.4, 'dirt', false, {}, 'floor');
for (const z of [26, 33, 40]) for (const x of [-2.6, 3.6]) grounds.lampPost(x, z);
// The main entrance on the south front: a stone doorway, boarded up, at the top of three steps.
for (let step = 0; step < 3; step++) {
  grounds.box(0.5, 0.075 + step * 0.15, SOUTH + 0.2 + 1.05 - step * 0.35, 4.2 - step * 0.4, 0.15, 2.1 - step * 0.7, 'weathered-concrete-b', false, {}, 'floor');
}
for (const side of [-1, 1]) grounds.box(0.5 + side * 1.55, 1.75, SOUTH + 0.35, 0.5, 3.5, 0.3, 'weathered-concrete-a');
grounds.box(0.5, 3.75, SOUTH + 0.35, 3.6, 0.5, 0.35, 'weathered-concrete-a');
grounds.box(0.5, 1.75, SOUTH + 0.24, 2.6, 3.1, 0.08, 'old-planks');
/** Dead trees in the courtyard beds (their soil is 0.4 m up) and about the grounds, clear of every route. */
const ASYLUM_TREES: readonly MapTree[] = [
  { x: 12.9, z: -16.7, scale: 0.8, y: 0.4 }, { x: 11.3, z: -14.9, scale: 0.4, y: 0.4 }, { x: 14.4, z: -18.6, scale: 0.35, y: 0.4 },
  { x: 12.3, z: -7, scale: 0.7, y: 0.4 }, { x: 10.1, z: -5.7, scale: 0.4, y: 0.4 },
  { x: -11.5, z: -10, scale: 0.75, y: 0.4 }, { x: -12.1, z: -7.4, scale: 0.4, y: 0.4 }, { x: -10.8, z: -12.6, scale: 0.4, y: 0.4 },
  { x: -44, z: 2, scale: 1 }, { x: -40, z: 36, scale: 1.1 }, { x: -22, z: 34, scale: 0.9 }, { x: 22, z: 30, scale: 1 },
  { x: 44, z: 20, scale: 1.1 }, { x: 46, z: -16, scale: 0.95 }, { x: -44, z: -40, scale: 1 }, { x: -14, z: -50, scale: 1.05 },
  { x: 22, z: -50, scale: 0.9 }, { x: 36, z: 38, scale: 1 },
];
const collision = collisionBoxesFor(b.shell, ASYLUM_PROPS);
/** Both sides of every boarded door, for navigation through narrow doorways. */
const doorSides = ASYLUM_DOORS.filter(d => d.id !== 'german-stairs' && d.id !== 'american-stairs').flatMap(d => {
  const alongZ = d.blocker.max.x - d.blocker.min.x < 1;
  return [-1, 1].map(side => ({ id: `${d.id}-${side}`, position: {
    x: d.position.x + (alongZ ? side : 0), y: d.position.y, z: d.position.z + (alongZ ? 0 : side) } }));
});
/** A stair's centre-line: the foot, points up the flight, and the landing at the top. */
const stairRoute = (id: string, x: number, bottomZ: number, topZ: number) => [
  { id: `${id}-foot`, position: { x, y: 0, z: bottomZ + Math.sign(bottomZ - topZ) * 0.8 } },
  ...Array.from({ length: 11 }, (_, i) => ({ id: `${id}-${i}`, position: { x, y: UP * i / 10, z: bottomZ + (topZ - bottomZ) * i / 10 } })),
  { id: `${id}-head`, position: { x, y: UP, z: topZ - Math.sign(bottomZ - topZ) * 0.8 } },
];
export const ASYLUM_STAIR_ROUTES = {
  german: stairRoute('german-stair', -27.8, 12, 4),
  american: stairRoute('american-stair', 23.5, -8, -16),
};
// Routes keep clear of every box spot, wherever the box is.
const ASYLUM_NAVIGATION = compileNavigation(b.surfaces, [...collision, ...ASYLUM_HAZARDS.map(hazardBox), ...ASYLUM_BOX_SPOTS.map(mysteryBoxBlocker)],
  { minX: WEST + 0.8, maxX: EAST, minZ: NORTH + 0.8, maxZ: SOUTH }, [0, UP], [
    { id: 'spawn', position: ASYLUM_PLAYER_SPAWN },
    ...doorSides,
    ...ASYLUM_STAIR_ROUTES.german, ...ASYLUM_STAIR_ROUTES.american,
    ...barriers.map(barrier => ({ id: barrier.id, position: barrier.insidePoint })),
  ]);

export const ASYLUM_MAP: GameMap = {
  id: 'asylum', name: 'Asylum', upperHeight: UP,
  greybox: b.shell, prisms: b.prisms, collisionBoxes: [...collision, ...collisionBoxesFor(grounds.boxes, [])],
  shotBlockers: slabShotBlockers(b.surfaces, UP), walkSurfaces: b.surfaces, navigation: ASYLUM_NAVIGATION,
  playerSpawn: ASYLUM_PLAYER_SPAWN, windows: b.windows, windowBoards: 6,
  barriers, zombieSpawns: barriers.flatMap(barrier => entrySpawns(barrier, SPAWN_SPOTS[barrier.id])),
  scenery: grounds.boxes,
  doors: ASYLUM_DOORS,
  doorStyles: Object.fromEntries(ASYLUM_DOORS.map(d => [d.id, d.id.endsWith('stairs')
    ? { kind: 'debris' as const, yaw: 0, width: d.blocker.max.x - d.blocker.min.x }
    : { kind: 'planks' as const, yaw: d.blocker.max.x - d.blocker.min.x < 1 ? 0 : Math.PI / 2, width: DOOR_WIDTH }])),
  wallWeapons: ASYLUM_WALL_WEAPONS, wallWeaponFacing: ASYLUM_WALL_WEAPON_FACING,
  hazards: ASYLUM_HAZARDS, equipment: ASYLUM_EQUIPMENT, equipmentFacing: ASYLUM_EQUIPMENT_FACING,
  mysteryBoxes: ASYLUM_MYSTERY_BOXES, boxCenter: ASYLUM_BOX_CENTER, boxYaw: -Math.PI / 2,
  fountain: FOUNTAIN,
  powerSwitch: ASYLUM_POWER_SWITCH, perkMachines: ASYLUM_PERK_MACHINES, perkMachineFacing: ASYLUM_PERK_FACING, traps: ASYLUM_TRAPS,
  rails: b.rails, props: ASYLUM_PROPS,
  decals: [
    { asset: 'leaking-grime', x: -20, y: 2.4, z: SOUTH - 0.211, width: 2.6, height: 2.5, yaw: Math.PI },
    { asset: 'smear-grime', x: 8, y: UP + 1.6, z: NORTH + 0.211, width: 2.4, height: 2.2, yaw: 0 },
    { asset: 'smear-grime', x: 29.79, y: 1.6, z: -8, width: 2.4, height: 2.2, yaw: -Math.PI / 2 },
  ],
  labels: [
    { text: 'POWER ROOM', x: -9, y: UP + 2.9, z: NORTH + 0.215, yaw: 0, width: 3, height: 0.42 },
    { text: 'KITCHEN', x: 12, y: UP + 2.9, z: NORTH + 0.215, yaw: 0, width: 2.3, height: 0.42 },
    { text: 'GEFAHR', x: 3.24, y: 3.2, z: 6, yaw: Math.PI / 2, width: 1.8, height: 0.42, color: '#8f2a22' },
    { text: 'GEFAHR', x: 2.76, y: 3.2, z: 6, yaw: -Math.PI / 2, width: 1.8, height: 0.42, color: '#8f2a22' },
  ],
  lights: [
    { x: -20, y: 3.4, z: 11 }, { x: -3, y: 3.4, z: 12 }, { x: 9, y: 3.4, z: 11 },
    { x: 23, y: 3.4, z: -4 }, { x: -24, y: UP + 3, z: -8 }, { x: -24, y: UP + 3, z: -26 },
    { x: -9, y: UP + 3, z: -26 }, { x: 8, y: UP + 3, z: -26 }, { x: 23, y: UP + 3, z: -26 }, { x: 23, y: UP + 3, z: -2 },
  ],
  rubble: [
    { minX: -25, maxX: 2, minZ: 4, maxZ: 18, y: 0, count: 26 },
    { minX: 4, maxX: 15, minZ: 4, maxZ: 18, y: 0, count: 14 },
    { minX: 17, maxX: 29, minZ: -19, maxZ: 8, y: 0, count: 22 },
    { minX: -29, maxX: -20, minZ: -19, maxZ: 3, y: UP, count: 16 },
    { minX: -29, maxX: 29, minZ: -31, maxZ: -21, y: UP, count: 30 },
  ],
  focus: { x: 0, z: -6.5, radius: 32 },
  grounds: ASYLUM_GROUNDS,
  trees: ASYLUM_TREES,
  previews: {
    american: { position: { x: 9, y: 0, z: 12 }, yaw: 0 },
    hallway: { position: { x: 18, y: 0, z: 5 }, yaw: 0 },
    balcony: { position: { x: -24, y: UP, z: 2 }, yaw: 0 },
    upstairs: { position: { x: -24, y: UP, z: -24 }, yaw: -Math.PI / 2 },
    power: { position: { x: -9, y: UP, z: -23 }, yaw: 0 },
    kitchen: { position: { x: 8, y: UP, z: -23 }, yaw: Math.PI / 2 },
    rightBalcony: { position: { x: 18, y: UP, z: 4 }, yaw: 0 },
    courtyard: { position: { x: 17.5, y: UP, z: -12 }, yaw: Math.PI / 2 },
    barrier: { position: { x: -15, y: 0, z: 1.5 }, yaw: 0 },
    upperEntry: { position: { x: -26.8, y: UP, z: -24 }, yaw: Math.PI / 2 },
    juggernog: { position: { x: -22, y: 0, z: 7.5 }, yaw: 0 },
  },
};
