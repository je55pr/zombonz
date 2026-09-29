import type { PerkId } from './perks.ts';
import type { DownedState } from './downs.ts';
import type { ZombieEntryState } from './barrier.ts';

export type EntityId = `e:${number}`;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface EntityBase {
  id: EntityId;
  position: Vec3;
  alive: boolean;
}

export interface WeaponState {
  weaponId: string;
  cooldownTicks: number;
  magazineAmmo: number;
  reserveAmmo: number;
  reloadTicksRemaining: number;
}

export interface PlayerState extends EntityBase {
  kind: 'player';
  velocity: Vec3;
  yaw: number;
  pitch: number;
  sprinting: boolean;
  /** Remaining sprint stamina, in ticks. */
  sprintTicks: number;
  sprintRechargeDelayTicks: number;
  aiming: boolean;
  /** Extra hip spread from sustained fire, as a multiple of the gun's base spread; recovers each tick. */
  spreadBloom: number;
  health: number;
  recoveryDelayTicks: number;
  meleeCooldownTicks: number;
  /** After a zombie's blow lands, ticks during which no other zombie's can (see ZOMBIE_MELEE.hurtGraceTicks). */
  hurtGraceTicks: number;
  grenadeCharges: number;
  /** Bouncing Betties carried (see MINE_RULES). */
  mineCharges: number;
  repairRewardRound: number;
  repairPointsEarned: number;
  points: number;
  /** Every point awarded this match, starting points included; spending never lowers it. */
  pointsEarned: number;
  kills: number;
  headshots: number;
  weapon: WeaponState;
  holsteredWeapon: WeaponState | null;
  switchTicksRemaining: number;
  /** Perk-a-colas drunk, in the order bought. */
  perks: PerkId[];
  /** In last stand (still alive), or null when up. */
  downed: DownedState | null;
  /** Solo Quick Revive self-revives used, out of three. */
  selfRevives: number;
  godMode: boolean;
  noclip: boolean;
  noclipAnchor: Vec3 | null;
}

export type ZombieGait = 'walk' | 'run' | 'sprint';

export interface ZombieState extends EntityBase {
  kind: 'zombie';
  velocity: Vec3;
  health: number;
  gait: ZombieGait;
  moveSpeed: number;
  attackCooldownTicks: number;
  targetId: EntityId | null;
  entry: ZombieEntryState | null;
  deadTicks: number;
  /** Which way it faces, in radians, as the renderer turns a model (0 faces +z). */
  yaw: number;
  /** Its look, chosen when it spawned: which model it is drawn with, and so where its body is (see zombieBody.ts). */
  variant: number;
  /** Limbs it has lost, as bits of LIMB; a zombie with a leg gone is a crawler. */
  limbs: number;
  /** Ticks into the current melee swing, or 0 when it is not swinging. */
  attackTicks: number;
  /** Which of its model's swings the current one is. */
  attackStyle: number;
}
export interface InteractableState extends EntityBase {
  kind: 'interactable';
  interactionType: string;
  actionId: string;
  prompt: string;
  interactionRange: number;
  minFacingDot: number;
  enabled: boolean;
}

export type EntityState = PlayerState | ZombieState | InteractableState;

export interface WorldState {
  tick: number;
  seed: number;
  nextEntityNumber: number;
  entities: Record<EntityId, EntityState>;
}

export function origin(): Vec3 {
  return { x: 0, y: 0, z: 0 };
}
