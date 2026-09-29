import type { CollisionBox, WalkSurface } from '../core/collision.ts';
import type { NavigationGraph } from '../core/navigation.ts';
import type { DoorDefinition } from '../core/door.ts';
import type { WallWeaponDefinition } from '../core/wallWeapon.ts';
import type { MysteryBoxDefinition } from '../core/mysteryBox.ts';
import type { PowerSwitchDefinition } from '../core/door.ts';
import type { PerkMachineDefinition } from '../core/perks.ts';
import type { TrapDefinition } from '../core/traps.ts';
import type { BarrierDefinition } from '../core/barrier.ts';
import type { EquipmentBuyDefinition } from '../core/equipment.ts';
import type { HazardDefinition } from '../core/hazard.ts';
import type { ZombieSpawnPoint } from '../core/spawning.ts';
import type { Vec3 } from '../core/types.ts';
import type { PropPlacement } from './bunkerProps.ts';

export type GreyboxMaterial = 'wall' | 'floor' | 'upperFloor' | 'stair' | 'barrier' | 'metal';
/** The environment pack's texture sets; a map can pin one on a box instead of the default for its role. */
export const SURFACE_LOOKS = ['weathered-concrete-a', 'weathered-concrete-b', 'cracked-concrete-floor',
  'broken-plaster-brick', 'concrete-rubble', 'cave-rock', 'dirt', 'splintered-wood', 'rusted-metal', 'sofa-upholstery',
  'peeling-paint-wall', 'dirty-tiles', 'old-linoleum', 'cobblestone', 'old-planks', 'old-wood-floor',
  'forest-floor'] as const;
/**
 * Metres per texture repeat, by look (2 m unless listed). Wall textures span a storey, so a
 * plaster-over-brick or tiled texture reads once per wall rather than as repeating stripes.
 */
export const LOOK_SCALE: Partial<Record<SurfaceLook, number>> = {
  'broken-plaster-brick': 4, 'peeling-paint-wall': 3, 'dirty-tiles': 1.2, 'cobblestone': 2.5,
  'forest-floor': 3, 'old-linoleum': 2.5, 'old-planks': 1.5, 'old-wood-floor': 1.5,
};
export type SurfaceLook = typeof SURFACE_LOOKS[number];
/** How far a stair's steps reach down, so neighbouring steps join into one stepped slab. */
export const STAIR_DEPTH = 0.5;

export interface GreyboxBox {
  center: Vec3; size: Vec3; material: GreyboxMaterial; collides?: boolean; rotationZ?: number; rotationX?: number; visible?: boolean;
  look?: SurfaceLook;
  /** A gabled roof filling the box instead of a block: a triangular prism whose ridge runs along x or z. */
  shape?: 'gableX' | 'gableZ';
  /** A floor slab's other faces (the ceiling below it), when they differ from its walked-on top. */
  underside?: SurfaceLook;
}
export interface GreyboxPrism {
  points: readonly (readonly [number, number])[]; bottom: number; top: number; material: GreyboxMaterial;
}
export interface MapMarker {
  id: string; type: 'zombieSpawn' | 'door' | 'wallBuy' | 'mysteryBox'; position: Vec3; label: string;
}
export interface MapWindow {
  id: string; x: number; z: number; y: number; axis: 'x' | 'z'; width: number; outward: Vec3;
}
export interface MapRail { from: Vec3; to: Vec3 }
export interface MapDecal { asset: string; x: number; y: number; z: number; width: number; height: number; yaw: number }
/** Text painted on a wall (presentation only). */
export interface MapLabel { text: string; x: number; y: number; z: number; yaw: number; width: number; height: number; color?: string }
/**
 * How a purchasable blocker looks: a boarded door (its width runs along the view's local z, and a label
 * faces local +x) or a pile of sofa and crate debris across a stairway.
 */
export interface DoorStyle { kind: 'planks' | 'debris'; yaw: number; width: number; label?: string }
/** A dead tree planted in the map (presentation only; zombie routes keep clear of them). */
export interface MapTree { x: number; z: number; scale: number; /** The ground it stands on (0 by default). */ y?: number }
/** A floor area scattered with low rubble (below the step height, so it never blocks anyone). */
export interface ScatterArea { minX: number; maxX: number; minZ: number; maxZ: number; y: number; count: number }
export interface PreviewView { position: Vec3; yaw: number }

/**
 * Everything the game needs to build and run one map: shared simulation data (collision, navigation,
 * entries, purchases, spawns) and presentation anchors (labels, lights, props, decals). Core systems
 * read only the first group, so the simulation stays deterministic and renderer-independent.
 */
export interface GameMap {
  id: string;
  name: string;
  upperHeight: number;
  greybox: readonly GreyboxBox[];
  /**
   * What players see but never reach: outbuildings, boundary walls, fences and garden dressing. Drawn in
   * coarser batches than the building; the ones that collide are in `collisionBoxes` too.
   */
  scenery?: readonly GreyboxBox[];
  prisms: readonly GreyboxPrism[];
  collisionBoxes: readonly CollisionBox[];
  /** Upper floors that stop bullets from below. */
  shotBlockers: readonly CollisionBox[];
  walkSurfaces: readonly WalkSurface[];
  navigation: NavigationGraph;
  playerSpawn: Vec3;
  windows: readonly MapWindow[];
  windowBoards: number;
  barriers: readonly BarrierDefinition[];
  zombieSpawns: readonly ZombieSpawnPoint[];
  doors: readonly DoorDefinition[];
  doorStyles: Readonly<Record<string, DoorStyle>>;
  wallWeapons: readonly WallWeaponDefinition[];
  /** The yaw each chalk outline faces, away from its wall. */
  wallWeaponFacing: Readonly<Record<string, number>>;
  mysteryBoxes: readonly MysteryBoxDefinition[];
  /** A stone fountain, drawn round, on this spot of ground (presentation only). */
  fountain?: { x: number; z: number };
  /** A map with a switch starts with the power off; its electric doors, perks and traps wait for it. */
  powerSwitch?: PowerSwitchDefinition;
  perkMachines?: readonly PerkMachineDefinition[];
  /** The yaw each perk machine's front faces (0 faces +z). Its buy point stands in front of it. */
  perkMachineFacing?: Readonly<Record<string, number>>;
  traps?: readonly TrapDefinition[];
  /**
   * Barrels and vehicles that explode when shot (see core/hazard.ts). They are not in `collisionBoxes`: the
   * simulation adds each one's body while it stands, so shooting one clears its collision.
   */
  hazards?: readonly HazardDefinition[];
  /** Equipment (Bouncing Betties) sold from the wall, and the yaw each chalk outline faces, away from its wall. */
  equipment?: readonly EquipmentBuyDefinition[];
  equipmentFacing?: Readonly<Record<string, number>>;
  /** Where the box starts. A box with `locations` moves between them; the renderer follows its state. */
  boxCenter: Vec3;
  /** The box's front (where buyers stand) faces (cos yaw, -sin yaw) in x/z. */
  boxYaw: number;
  /** A box that moves is marked by a pale beam of light over it. Off unless the map asks for it. */
  boxLocatorBeam?: boolean;
  rails: readonly MapRail[];
  props: readonly PropPlacement[];
  decals: readonly MapDecal[];
  labels: readonly MapLabel[];
  /** Warm practical lamps. */
  lights: readonly Vec3[];
  rubble: readonly ScatterArea[];
  /** Middle and half-size of the building, for the key light's shadow frustum and the treeline. */
  focus: { x: number; z: number; radius: number };
  /** The grounds inside a boundary wall or fence: the treeline stands outside them. */
  grounds?: { minX: number; maxX: number; minZ: number; maxZ: number };
  /** Dead trees planted inside the grounds. */
  trees?: readonly MapTree[];
  /** Development inspection views (`?preview=`), beyond the ones every map gets at its player spawn. */
  previews: Readonly<Record<string, PreviewView>>;
}
