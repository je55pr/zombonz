import type { BarrierState } from './barrier.ts';
import type { CollisionBox, WalkSurface } from './collision.ts';
import { moveWithCollision, sampleWalkHeight } from './collision.ts';
import { damagePlayer, type DamageEvent } from './health.ts';
import { hasClearNavigationLine, navigationWaypoint, type NavigationGraph, type NavigationQuery } from './navigation.ts';
import type { SeededRng } from './rng.ts';
import { faceToward } from './zombieBody.ts';
import type { EntityId, PlayerState, Vec3, ZombieGait, ZombieState } from './types.ts';

export const ZOMBIE_MOVEMENT = {
  radius: 0.32,
  height: 1.72,
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

/**
 * Walkers shamble at their walk cycle's own ground pace (about 0.75 m/s), so feet don't slide and an
 * early round is as slow as WaW's. Runners jog at about half the player's 4.2 m/s walk (their run cycle
 * covers about 1.84 m/s and plays slightly faster). Sprinters sit just under the player's walk, so only
 * sprinting opens a gap.
 */
export const ZOMBIE_GAIT_SPEEDS: Readonly<Record<ZombieGait, number>> = { walk: 0.8, run: 2.2, sprint: 4.1 };

/**
 * WaW/BO1 set_run_speed: roll [speed, speed + 35); up to 35 walks, up to 70 runs, beyond sprints.
 * round_think sets the speed from the round number *before* incrementing it, so round N rolls from
 * (N - 1) x 8: round 2 is about one runner in five, walkers are gone by round 6, and round 10 is all sprinters.
 */
export const ZOMBIE_GAIT_RULES = { speedPerRound: 8, rollRange: 35, walkMax: 35, runMax: 70 } as const;

export function zombieGaitForRound(round: number, rng: SeededRng): ZombieGait {
  const level = Math.max(1, Math.floor(round));
  // Round one keeps the classic initial move speed of 1, so every zombie walks.
  const speed = Math.max(1, (level - 1) * ZOMBIE_GAIT_RULES.speedPerRound);
  const roll = speed + rng.int(0, ZOMBIE_GAIT_RULES.rollRange);
  return roll <= ZOMBIE_GAIT_RULES.walkMax ? 'walk' : roll <= ZOMBIE_GAIT_RULES.runMax ? 'run' : 'sprint';
}

/** The look (model) of a new zombie, chosen by weight from a map's `zombieLooks`; the first look if it names none. */
export function zombieLookFor(weights: readonly number[] | undefined, rng: SeededRng): number {
  const total = (weights ?? []).reduce((sum, weight) => sum + Math.max(0, weight), 0);
  if (!weights || total <= 0) return 0;
  let roll = rng.next() * total;
  for (let look = 0; look < weights.length; look++) {
    roll -= Math.max(0, weights[look]);
    if (roll < 0) return look;
  }
  return 0;
}

export function createZombieState(id: EntityId, position: Vec3, round: number, gait: ZombieGait = 'walk', variant = 0): ZombieState {
  return {
    id,
    kind: 'zombie',
    position: { ...position },
    velocity: { x: 0, y: 0, z: 0 },
    health: zombieHealthForRound(round),
    gait,
    moveSpeed: ZOMBIE_GAIT_SPEEDS[gait],
    attackCooldownTicks: 0,
    targetId: null,
    entry: null,
    deadTicks: 0,
    yaw: 0,
    variant,
    limbs: 0,
    attackTicks: 0,
    attackStyle: 0,
    alive: true,
  };
}

const HEALTH_CAP = 1_000_000_000;
const healthByRound: number[] = [0, 150];
/**
 * Health of a zombie spawned in `round`, step for step as WaW's ai_calculate_health does it: 150 at the start,
 * 100 more each round up to round 9, and from round 10 a tenth more than the round before, truncated each round
 * (so round 11 is 1149, not the 1150 a single rounding would give). Capped so a long match cannot overflow.
 */
export function zombieHealthForRound(round: number): number {
  const level = Math.min(400, Math.max(1, Math.floor(round)));
  while (healthByRound.length <= level) {
    const next = healthByRound.length, previous = healthByRound[next - 1];
    healthByRound.push(Math.min(HEALTH_CAP, next >= 10 ? previous + Math.floor(previous * 0.1) : previous + 100));
  }
  return healthByRound[level];
}
function distanceSquared(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

export function chooseZombieTarget(zombie: ZombieState, players: readonly PlayerState[]): PlayerState | null {
  const candidates = players.filter((player) => player.alive && !player.downed);
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
    faceToward(zombie, Math.atan2(targetDx, targetDz), deltaSeconds);
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
  if (planarDistance > 0) faceToward(zombie, Math.atan2(dx, dz), deltaSeconds);
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
  const target = players.find((player) => player.id === zombie.targetId && player.alive && !player.downed)
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

/** Players this close to a window's inner face can be swiped by a zombie tearing at it. */
export const WINDOW_ATTACK = { reach: 1.4, maxHeightDelta: 1 } as const;

export interface WindowAttackResult {
  /** A zombie busy swiping through the window stops tearing boards. */
  engaged: boolean;
  events: Array<ZombieAttackEvent | DamageEvent>;
}

export function tickWindowAttack(zombie: ZombieState, barrier: BarrierState,
  players: readonly PlayerState[]): WindowAttackResult {
  if (zombie.attackCooldownTicks > 0) zombie.attackCooldownTicks -= 1;
  // Only once at least one board is gone is there a gap to reach through.
  if (!zombie.alive || zombie.entry?.phase !== 'breaking' || barrier.boards >= barrier.maxBoards) {
    return { engaged: false, events: [] };
  }
  const inReach = players.filter(player => {
    if (!player.alive || player.downed || Math.abs(player.position.y - barrier.position.y) > WINDOW_ATTACK.maxHeightDelta) return false;
    const dx = player.position.x - barrier.position.x, dz = player.position.z - barrier.position.z;
    return dx * barrier.outward.x + dz * barrier.outward.z < 0 && Math.hypot(dx, dz) <= WINDOW_ATTACK.reach;
  }).sort((a, b) => distanceSquared(zombie.position, a.position) - distanceSquared(zombie.position, b.position)
    || a.id.localeCompare(b.id));
  const target = inReach[0];
  if (!target) return { engaged: false, events: [] };
  zombie.targetId = target.id;
  if (zombie.attackCooldownTicks > 0) return { engaged: true, events: [] };
  zombie.attackCooldownTicks = ZOMBIE_MOVEMENT.attackCooldownTicks;
  return { engaged: true, events: [
    { type: 'zombieAttacked', zombieId: zombie.id, playerId: target.id, damage: ZOMBIE_MOVEMENT.attackDamage },
    ...damagePlayer(target, ZOMBIE_MOVEMENT.attackDamage),
  ] };
}
