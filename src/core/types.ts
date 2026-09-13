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

export interface PlayerState extends EntityBase {
  kind: 'player';
  velocity: Vec3;
  yaw: number;
  pitch: number;
  health: number;
  points: number;
}

export interface ZombieState extends EntityBase {
  kind: 'zombie';
  velocity: Vec3;
  health: number;
  moveSpeed: number;
  attackCooldownTicks: number;
  targetId: EntityId | null;
}
export interface InteractableState extends EntityBase {
  kind: 'interactable';
  interactionType: string;
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
