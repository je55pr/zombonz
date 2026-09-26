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
  health: number;
  recoveryDelayTicks: number;
  meleeCooldownTicks: number;
  repairRewardRound: number;
  repairPointsEarned: number;
  points: number;
  weapon: WeaponState;
  holsteredWeapon: WeaponState | null;
  switchTicksRemaining: number;
  godMode: boolean;
  noclip: boolean;
  noclipAnchor: Vec3 | null;
}

export interface ZombieState extends EntityBase {
  kind: 'zombie';
  velocity: Vec3;
  health: number;
  moveSpeed: number;
  attackCooldownTicks: number;
  targetId: EntityId | null;
  entry: ZombieEntryState | null;
  deadTicks: number;
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
