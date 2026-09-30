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
  stance: 'stand' | 'crouch' | 'prone';
  grounded: boolean;
  /** Remaining wind-up before the held grenade leaves the hand. */
  grenadeWindupTicks: number;
  /** Remaining sprint stamina, in ticks. */
  sprintTicks: number;
  sprintRechargeDelayTicks: number;
  aiming: boolean;
  /** Extra hip spread from sustained fire, as a multiple of the gun's base spread; recovers each tick. */
  spreadBloom: number;
  health: number;
  recoveryDelayTicks: number;
  meleeCooldownTicks: number;
  /** Ticks until a knife swing already begun lands its blow, or 0 when none is pending (see MELEE_RULES). */
  meleeStrikeTicks: number;
  /** After a zombie's blow lands, ticks during which no other zombie's can (see ZOMBIE_MELEE.hurtGraceTicks). */
  hurtGraceTicks: number;
  grenadeCharges: number;
  /** Bouncing Betties carried (see MINE_RULES). */
  mineCharges: number;
  /** Whether this player has purchased Bouncing Betties this match, even if none are currently carried. */
  bouncingBettyOwned: boolean;
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
  /** Ticks in a row it has meant to move and stayed within a step or two of where it was (see `trackZombieProgress`). */
  stall: number;
  /** Where that stay began. Only the host uses these two, so they are left out of snapshots. */
  anchorX: number;
  anchorZ: number;
  /**
   * Where the current swing's blow has got to: 0 nothing yet, 1 someone was in reach as the arm came down (so the blow has
   * them even if they step out by the moment of contact), 2 landed. Only the host uses it (see `ZOMBIE_MELEE.hitWindow`).
   */
  blow: 0 | 1 | 2;
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
