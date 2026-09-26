import type { CollisionBox, WalkSurface } from './collision.ts';
import { moveWithCollision, sampleWalkHeight } from './collision.ts';
import { damagePlayer, type DamageEvent } from './health.ts';
import { hasClearNavigationLine, navigationWaypoint, type NavigationGraph, type NavigationQuery } from './navigation.ts';
import type { EntityId, PlayerState, Vec3, ZombieState } from './types.ts';

export const ZOMBIE_MOVEMENT = {
  radius: 0.32,
  height: 1.72,
  baseSpeed: 1.35,
  attackRange: 1.05,
  attackDamage: 50,
  attackCooldownTicks: 60,
} as const;

export interface ZombieAttackEvent {
  type: 'zombieAttacked';
  zombieId: EntityId;
  playerId: EntityId;
  damage: number;
}

export function createZombieState(id: EntityId, position: Vec3, round: number): ZombieState {
  return {
    id,
    kind: 'zombie',
    position: { ...position },
    velocity: { x: 0, y: 0, z: 0 },
    health: zombieHealthForRound(round),
    moveSpeed: ZOMBIE_MOVEMENT.baseSpeed + Math.min(0.65, Math.max(0, round - 1) * 0.04),
    attackCooldownTicks: 0,
    targetId: null,
    entry: null,
    deadTicks: 0,
    alive: true,
  };
}

export function zombieHealthForRound(round: number): number {
  const level = Math.max(1, Math.floor(round));
  // Classic early-round ramp, then exponential scaling; bounded for long test runs.
  return Math.min(1_000_000_000, Math.round((150 + 100 * Math.min(8, level - 1))
    * 1.1 ** Math.min(200, Math.max(0, level - 9))));
}
function distanceSquared(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

export function chooseZombieTarget(zombie: ZombieState, players: readonly PlayerState[]): PlayerState | null {
  const candidates = players.filter((player) => player.alive);
  candidates.sort((a, b) => {
    const distanceDelta = distanceSquared(zombie.position, a.position) - distanceSquared(zombie.position, b.position);
    return distanceDelta !== 0 ? distanceDelta : a.id.localeCompare(b.id);
  });
  const target = candidates[0] ?? null;
  zombie.targetId = target?.id ?? null;
  return target;
}

export function updateZombiePursuit(
  zombie: ZombieState,
  players: readonly PlayerState[],
  deltaSeconds: number,
  collisionBoxes: readonly CollisionBox[],
  walkSurfaces: readonly WalkSurface[] = [],
  navigationGraph?: NavigationGraph,
  navigationQuery?: NavigationQuery,
): void {
  if (!zombie.alive) return;
  const target = chooseZombieTarget(zombie, players);
  if (!target) {
    zombie.velocity = { x: 0, y: 0, z: 0 };
    return;
  }
  const targetDx = target.position.x - zombie.position.x;
  const targetDz = target.position.z - zombie.position.z;
  if (Math.hypot(targetDx, targetDz, target.position.y - zombie.position.y) <= ZOMBIE_MOVEMENT.attackRange
    && hasClearNavigationLine(zombie.position, target.position, collisionBoxes)) {
    zombie.velocity.x = 0;
    zombie.velocity.z = 0;
    return;
  }
  const waypoint = navigationQuery ? navigationQuery(zombie.position, target.position) : navigationWaypoint(
    navigationGraph,
    zombie.position,
    target.position,
    collisionBoxes,
    ZOMBIE_MOVEMENT.radius,
    walkSurfaces,
  );
  const dx = waypoint.x - zombie.position.x;
  const dz = waypoint.z - zombie.position.z;
  const planarDistance = Math.hypot(dx, dz);
  const velocityX = planarDistance > 0 ? (dx / planarDistance) * zombie.moveSpeed : 0;
  const velocityZ = planarDistance > 0 ? (dz / planarDistance) * zombie.moveSpeed : 0;
  zombie.velocity.x = velocityX;
  zombie.velocity.z = velocityZ;
  const requested = { x: velocityX * deltaSeconds, y: 0, z: velocityZ * deltaSeconds };
  const next = moveWithCollision(
    zombie.position,
    requested,
    ZOMBIE_MOVEMENT.radius,
    ZOMBIE_MOVEMENT.height,
    collisionBoxes,
  );
  next.y = sampleWalkHeight(next.x, next.z, zombie.position.y, walkSurfaces);
  zombie.position = next;
}

export function tickZombieMelee(
  zombie: ZombieState,
  players: readonly PlayerState[],
  collisionBoxes: readonly CollisionBox[] = [],
): Array<ZombieAttackEvent | DamageEvent> {
  if (!zombie.alive || zombie.entry) return [];
  if (zombie.attackCooldownTicks > 0) zombie.attackCooldownTicks -= 1;
  const target = players.find((player) => player.id === zombie.targetId && player.alive)
    ?? chooseZombieTarget(zombie, players);
  if (!target || zombie.attackCooldownTicks > 0) return [];
  const dx = target.position.x - zombie.position.x;
  const dz = target.position.z - zombie.position.z;
  if (Math.hypot(dx, dz, target.position.y - zombie.position.y) > ZOMBIE_MOVEMENT.attackRange
    || !hasClearNavigationLine(zombie.position, target.position, collisionBoxes)) return [];

  zombie.attackCooldownTicks = ZOMBIE_MOVEMENT.attackCooldownTicks;
  const events: Array<ZombieAttackEvent | DamageEvent> = [{
    type: 'zombieAttacked',
    zombieId: zombie.id,
    playerId: target.id,
    damage: ZOMBIE_MOVEMENT.attackDamage,
  }];
  events.push(...damagePlayer(target, ZOMBIE_MOVEMENT.attackDamage));
  return events;
}
