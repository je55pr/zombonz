import type { BarrierState } from './barrier.ts';
import type { CollisionBox, WalkSurface } from './collision.ts';
import { moveWithCollision, sampleWalkHeight } from './collision.ts';
import { damagePlayer, type DamageEvent } from './health.ts';
import { mix32, hashString } from './rng.ts';
import { hasClearNavigationLine, navigationWaypoint, type NavigationGraph, type NavigationQuery } from './navigation.ts';
import type { SeededRng } from './rng.ts';
import { CRAWLER, LEGS_MASK, faceToward, zombieSpeed } from './zombieBody.ts';
import { ZOMBIE_MELEE, swingTiming } from './zombieMelee.ts';
import type { EntityId, PlayerState, Vec3, ZombieGait, ZombieState } from './types.ts';

export const ZOMBIE_MOVEMENT = {
  radius: 0.32,
  height: 1.72,
} as const;

/** A blow landed on a player. */
export interface ZombieAttackEvent {
  type: 'zombieAttacked';
  zombieId: EntityId;
  playerId: EntityId;
  damage: number;
}

/** A zombie began a swing at a player: the wind-up starts, and the blow lands `swingTiming` ticks later if they are still in reach. */
export interface ZombieSwingEvent {
  type: 'zombieSwung';
  zombieId: EntityId;
  playerId: EntityId;
}

export type ZombieMeleeEvent = ZombieAttackEvent | ZombieSwingEvent;

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
  // A zombie swinging, or close enough to start, stands its ground and turns to face its target.
  if (zombie.attackTicks > 0 || inMeleeReach(zombie, target, collisionBoxes, meleeReach(zombie).startRange)) {
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
  const speed = zombieSpeed(zombie);
  const velocityX = planarDistance > 0 ? (dx / planarDistance) * speed : 0;
  const velocityZ = planarDistance > 0 ? (dz / planarDistance) * speed : 0;
  zombie.velocity.x = velocityX;
  zombie.velocity.z = velocityZ;
  if (planarDistance > 0) faceToward(zombie, Math.atan2(dx, dz), deltaSeconds);
  const requested = { x: velocityX * deltaSeconds, y: 0, z: velocityZ * deltaSeconds };
  const next = moveWithCollision(
    zombie.position,
    requested,
    ZOMBIE_MOVEMENT.radius,
    zombie.limbs & LEGS_MASK ? CRAWLER.height : ZOMBIE_MOVEMENT.height,
    collisionBoxes,
  );
  next.y = sampleWalkHeight(next.x, next.z, zombie.position.y, walkSurfaces);
  zombie.position = next;
}

/** How far a zombie reaches, from where it starts a swing and from where a blow still lands: a crawler has the shorter arms of one that drags itself. */
export function meleeReach(zombie: Pick<ZombieState, 'limbs'>): { startRange: number; strikeRange: number } {
  return zombie.limbs & LEGS_MASK ? ZOMBIE_MELEE.crawlerReach : ZOMBIE_MELEE.reach;
}

/**
 * Whether a zombie could put a hand on a player: within `range` across the floor, on the same floor, with no wall,
 * closed door, sill, barrel or anything else solid standing between their feet. A window's sill is such a thing, which
 * is why a zombie outside a boarded window cannot reach a player inside it (only the window swipe below can).
 */
export function inMeleeReach(zombie: ZombieState, player: PlayerState, boxes: readonly CollisionBox[], range: number): boolean {
  const dx = player.position.x - zombie.position.x, dz = player.position.z - zombie.position.z;
  return Math.hypot(dx, dz) <= range && Math.abs(player.position.y - zombie.position.y) <= ZOMBIE_MELEE.maxHeightDelta
    && hasClearNavigationLine(zombie.position, player.position, boxes);
}

/** Whether the zombie is facing within `arc` radians of where the player is. */
function facesWithin(zombie: ZombieState, player: PlayerState, arc: number): boolean {
  const heading = Math.atan2(player.position.x - zombie.position.x, player.position.z - zombie.position.z);
  return Math.abs(Math.atan2(Math.sin(heading - zombie.yaw), Math.cos(heading - zombie.yaw))) <= arc;
}

/**
 * One tick of a zombie's swing. It starts one (wind-up) when it has a target in reach and is off cooldown; the blow lands
 * when the wind-up ends (if a player is still in reach then, and none has been hit in the last moment: a blow that finds
 * the player in their grace waits, its arm out, for it to pass); the recovery follows, then a short pause. `reach` says
 * whether a player is in reach to start a swing or to land the blow.
 */
function advanceSwing(zombie: ZombieState, players: readonly PlayerState[], target: PlayerState | null,
  reach: (player: PlayerState, phase: 'start' | 'strike') => boolean): Array<ZombieMeleeEvent | DamageEvent> {
  const timing = swingTiming(zombie);
  if (zombie.attackCooldownTicks > 0) zombie.attackCooldownTicks -= 1;
  if (zombie.attackTicks === 0) {
    if (!target || zombie.attackCooldownTicks > 0 || !reach(target, 'start')) return [];
    zombie.attackTicks = 1;
    zombie.attackStyle = (zombie.attackStyle + 1) % 8;
    zombie.targetId = target.id;
    return [{ type: 'zombieSwung', zombieId: zombie.id, playerId: target.id }];
  }
  const events: Array<ZombieMeleeEvent | DamageEvent> = [];
  if (zombie.attackTicks === timing.windupTicks) {
    // The blow: at whoever it was after if they are still in reach, else anyone else who is.
    const victims = players.filter(player => player.alive && !player.downed && reach(player, 'strike'))
      .sort((a, b) => Number(b.id === zombie.targetId) - Number(a.id === zombie.targetId) || a.id.localeCompare(b.id));
    const victim = victims[0];
    if (victim) {
      // Another zombie has just hit them: wait, arm out, until the moment has passed.
      if (victim.hurtGraceTicks > 0) return events;
      victim.hurtGraceTicks = ZOMBIE_MELEE.hurtGraceTicks;
      events.push({ type: 'zombieAttacked', zombieId: zombie.id, playerId: victim.id, damage: ZOMBIE_MELEE.damage },
        ...damagePlayer(victim, ZOMBIE_MELEE.damage));
    }
  }
  zombie.attackTicks += 1;
  if (zombie.attackTicks > timing.totalTicks) {
    zombie.attackTicks = 0;
    zombie.attackCooldownTicks = mix32(hashString(zombie.id) ^ Math.imul(zombie.health + 1, 0x9e3779b1) ^ zombie.attackStyle) % (ZOMBIE_MELEE.gapTicks + 1);
  }
  return events;
}

/** A zombie in the open: swings at a player who is in reach and in front of it, then recovers. */
export function tickZombieMelee(
  zombie: ZombieState,
  players: readonly PlayerState[],
  collisionBoxes: readonly CollisionBox[] = [],
): Array<ZombieMeleeEvent | DamageEvent> {
  if (!zombie.alive || zombie.entry) return [];
  const target = players.find((player) => player.id === zombie.targetId && player.alive && !player.downed)
    ?? chooseZombieTarget(zombie, players);
  const { startRange, strikeRange } = meleeReach(zombie);
  return advanceSwing(zombie, players, target, (player, phase) => inMeleeReach(zombie, player, collisionBoxes,
    phase === 'start' ? startRange : strikeRange) && facesWithin(zombie, player, phase === 'start' ? ZOMBIE_MELEE.startArc : ZOMBIE_MELEE.strikeArc));
}

/**
 * Players this close to a window's inner face (and no farther out to either side than its opening) can be swiped by
 * a zombie tearing at it, once a board is gone. A zombie stands about 0.85 m outside the window, so this is an arm's
 * length through the gap, not the length of the room.
 */
export const WINDOW_ATTACK = { reach: 1, sideMargin: 0.3, maxHeightDelta: 1 } as const;

export interface WindowAttackResult {
  /** A zombie busy swiping through the window stops tearing boards. */
  engaged: boolean;
  events: Array<ZombieMeleeEvent | DamageEvent>;
}

/** Whether a player is inside, at the window, and close enough to the opening for a zombie's arm through it. */
function inWindowReach(barrier: BarrierState, player: PlayerState): boolean {
  if (!player.alive || player.downed || Math.abs(player.position.y - barrier.position.y) > WINDOW_ATTACK.maxHeightDelta) return false;
  const dx = player.position.x - barrier.position.x, dz = player.position.z - barrier.position.z;
  const inside = -(dx * barrier.outward.x + dz * barrier.outward.z), along = Math.abs(dx * barrier.outward.z - dz * barrier.outward.x);
  return inside > 0 && inside <= WINDOW_ATTACK.reach && along <= barrier.width / 2 + WINDOW_ATTACK.sideMargin;
}

export function tickWindowAttack(zombie: ZombieState, barrier: BarrierState,
  players: readonly PlayerState[]): WindowAttackResult {
  // Only once at least one board is gone is there a gap to reach through, and a crawler cannot reach up to it.
  if (!zombie.alive || zombie.entry?.phase !== 'breaking' || barrier.boards >= barrier.maxBoards || zombie.limbs & LEGS_MASK) {
    if (zombie.attackCooldownTicks > 0) zombie.attackCooldownTicks -= 1;
    zombie.attackTicks = 0;
    return { engaged: false, events: [] };
  }
  const inReach = players.filter(player => inWindowReach(barrier, player))
    .sort((a, b) => distanceSquared(zombie.position, a.position) - distanceSquared(zombie.position, b.position) || a.id.localeCompare(b.id));
  const target = inReach[0] ?? null;
  if (target) zombie.targetId = target.id;
  const events = advanceSwing(zombie, players, target, player => inWindowReach(barrier, player));
  return { engaged: zombie.attackTicks > 0 || target !== null, events };
}

/**
 * Keeps zombies out of each other and out of the players they hunt, so a crowd spreads round its target instead of piling
 * onto one point (whose blows would then all land together). Each pair closer than their bodies allow is pushed apart, half
 * each (all of it for the one that is free to move, when the other is mid-swing or coming through a window), and a zombie
 * that has walked into a player is pushed back out. Walls still hold. Call once a tick, after the zombies have moved.
 */
export function separateZombies(zombies: readonly ZombieState[], players: readonly PlayerState[],
  boxes: readonly CollisionBox[], surfaces: readonly WalkSurface[]): void {
  const gap = ZOMBIE_MOVEMENT.radius * 2 * 0.9, playerGap = ZOMBIE_MOVEMENT.radius + 0.3;
  const shove = (zombie: ZombieState, dx: number, dz: number) => {
    const next = moveWithCollision(zombie.position, { x: dx, y: 0, z: dz }, ZOMBIE_MOVEMENT.radius, ZOMBIE_MOVEMENT.height, boxes);
    next.y = sampleWalkHeight(next.x, next.z, zombie.position.y, surfaces);
    zombie.position = next;
  };
  // Free to be moved: on the ground, out in the open, and not in the middle of a swing.
  const free = (zombie: ZombieState) => !zombie.entry && zombie.attackTicks === 0;
  for (let i = 0; i < zombies.length; i++) {
    const a = zombies[i];
    if (!a.alive) continue;
    for (let j = i + 1; j < zombies.length; j++) {
      const b = zombies[j];
      if (!b.alive || Math.abs(a.position.y - b.position.y) > 1) continue;
      let dx = a.position.x - b.position.x, dz = a.position.z - b.position.z, distance = Math.hypot(dx, dz);
      if (distance >= gap) continue;
      if (distance < 1e-4) { const angle = (mix32(hashString(a.id) ^ hashString(b.id)) / 0x1_0000_0000) * Math.PI * 2; dx = Math.cos(angle); dz = Math.sin(angle); distance = 1; }
      const overlap = gap - Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z), ux = dx / distance, uz = dz / distance;
      const aFree = free(a), bFree = free(b);
      if (aFree && bFree) { shove(a, ux * overlap / 2, uz * overlap / 2); shove(b, -ux * overlap / 2, -uz * overlap / 2); }
      else if (aFree) shove(a, ux * overlap, uz * overlap);
      else if (bFree) shove(b, -ux * overlap, -uz * overlap);
    }
  }
  for (const zombie of zombies) {
    if (!zombie.alive || zombie.entry) continue;
    for (const player of players) {
      if (!player.alive || Math.abs(player.position.y - zombie.position.y) > 1) continue;
      const dx = zombie.position.x - player.position.x, dz = zombie.position.z - player.position.z, distance = Math.hypot(dx, dz);
      if (distance >= playerGap) continue;
      const push = playerGap - distance, ux = distance > 1e-4 ? dx / distance : Math.sin(zombie.yaw), uz = distance > 1e-4 ? dz / distance : Math.cos(zombie.yaw);
      shove(zombie, ux * push, uz * push);
    }
  }
}
