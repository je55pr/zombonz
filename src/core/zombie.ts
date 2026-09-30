import { work } from './profiling.ts';
import type { BarrierState } from './barrier.ts';
import type { CollisionBox, WalkSurface } from './collision.ts';
import { moveWithCollision, pushOutOfBoxes, sampleWalkHeight } from './collision.ts';
import type { CollisionIndex } from './collisionIndex.ts';
import { damagePlayer, type DamageEvent } from './health.ts';
import { PLAYER_MOVEMENT, playerHeight } from './player.ts';
import { mix32, hashString } from './rng.ts';
import { hasClearNavigationLine, hasWalkableConnection, navigationWaypoint, type NavigationGraph, type NavigationQuery } from './navigation.ts';
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
 * early round is as slow as WaW's. Runners jog at a little over half the player's 4 m/s walk (their run cycle
 * covers about 1.84 m/s and plays slightly faster). Sprinters run at 3.24, so that the fastest zombie a horde can hold
 * (a sprinter at the most its own pace may be over, 8%) is 3.5, seven eighths of the player's walk: at 4.1 against a 4.2
 * walk (issue #210) they matched a walking player, so once sprint stamina ran out a late-round horde stayed on top of
 * them for good. Now walking away always opens a gap, slowly; sprinting opens a big one; a corner or a dead end still
 * costs the player what it should. See docs/zombie-difficulty.md.
 */
export const ZOMBIE_GAIT_SPEEDS: Readonly<Record<ZombieGait, number>> = { walk: 0.8, run: 2.2, sprint: 3.24 };

/**
 * Each zombie's own pace is its gait's speed within this fraction either way (fixed by its id, so it is the same on every
 * peer for the zombie's life): a horde that is all sprinters still strings out into a line behind a player who walks
 * away, instead of arriving as one blob.
 */
export const ZOMBIE_PACE_SPREAD = 0.08;

/** The factor (1 - spread to 1 + spread) a zombie's speed is its gait's speed times. */
export function zombiePaceFactor(id: EntityId): number {
  return 1 + ((mix32(hashString(id) ^ 0x5bd1e995) % 2001) / 1000 - 1) * ZOMBIE_PACE_SPREAD;
}

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
    moveSpeed: Math.round(ZOMBIE_GAIT_SPEEDS[gait] * zombiePaceFactor(id) * 1000) / 1000,
    attackCooldownTicks: 0,
    targetId: null,
    entry: null,
    deadTicks: 0,
    yaw: 0,
    variant,
    limbs: 0,
    attackTicks: 0,
    attackStyle: 0,
    stall: 0,
    struck: false,
    anchorX: position.x,
    anchorZ: position.z,
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
  /** The same walls as `collisionBoxes`, indexed: moves then look only at the walls around the zombie. */
  solids?: CollisionIndex,
): void {
  if (!zombie.alive) return;
  const target = chooseZombieTarget(zombie, players);
  if (!target) {
    zombie.velocity = { x: 0, y: 0, z: 0 };
    trackZombieProgress(zombie, false);
    return;
  }
  const height = zombie.limbs & LEGS_MASK ? CRAWLER.height : ZOMBIE_MOVEMENT.height;
  freeFromWalls(zombie, height, collisionBoxes, solids);
  const targetDx = target.position.x - zombie.position.x;
  const targetDz = target.position.z - zombie.position.z;
  // A zombie that has got to its target (touching) stands and turns to face it. Until then it keeps coming, swinging or
  // not: a swing is a lunge on the move, not a halt short of them.
  if (inMeleeReach(zombie, target, collisionBoxes, ARRIVED)) {
    zombie.velocity.x = 0;
    zombie.velocity.z = 0;
    trackZombieProgress(zombie, false);
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
  // Stood still for seconds with a way to go: get to somewhere it can walk from.
  if (zombie.stall >= STALL.relocateTicks) {
    const spot = freeSpotNear(zombie, waypoint, collisionBoxes, walkSurfaces, height);
    zombie.stall = spot ? 0 : STALL.relocateTicks - STALL.retryTicks;
    if (spot) { zombie.position = spot; work.stuckRecoveries++; return; }
  }
  const step = (vx: number, vz: number): Vec3 => {
    const delta = { x: vx * deltaSeconds, y: 0, z: vz * deltaSeconds };
    return solids ? solids.move(zombie.position, delta, ZOMBIE_MOVEMENT.radius, height)
      : moveWithCollision(zombie.position, delta, ZOMBIE_MOVEMENT.radius, height, collisionBoxes);
  };
  /** How much nearer the waypoint a step would put the zombie. */
  const closes = (to: Vec3) => planarDistance - Math.hypot(waypoint.x - to.x, waypoint.z - to.z);
  let next = step(velocityX, velocityZ);
  // Pressed against a wall or a corner it gets little of its step: try other headings and take the one that gets it
  // furthest on (the way along the wall to the door, not away from it), else, when none does, the side that is its own,
  // so that a crowd spreads.
  if (planarDistance > 0 && closes(next) < speed * deltaSeconds * STALL.blocked) {
    const first = mix32(hashString(zombie.id)) & 1 ? 1 : -1;
    let best = closes(next);
    for (const turn of SLIDE_TURNS) for (const side of [first, -first]) {
      const angle = turn * side, cos = Math.cos(angle), sin = Math.sin(angle);
      const candidate = step(velocityX * cos - velocityZ * sin, velocityX * sin + velocityZ * cos);
      if (closes(candidate) > best + 1e-9) { next = candidate; best = closes(candidate); }
    }
  }
  next.y = sampleWalkHeight(next.x, next.z, zombie.position.y, walkSurfaces);
  zombie.position = next;
  // Sliding along a wall, shuffling in a corner or dithering between two waypoints is moving but not getting anywhere
  // (a zombie mid-swing is not trying to get anywhere, it is busy).
  trackZombieProgress(zombie, planarDistance > 0 && zombie.attackTicks === 0);
}

/**
 * How a zombie that cannot get anywhere is recognised and helped. It is stalled while it means to move and stays within
 * `radius` metres of where it was; after `relocateTicks` of that it is put somewhere free close by (never across a wall),
 * and it tries again `retryTicks` later if there was nowhere. Closing on its waypoint by `blocked` or less of its step,
 * it tries the headings in `SLIDE_TURNS`, to either side, and takes whichever closes on it most.
 */
export const STALL = { radius: 0.2, relocateTicks: 180, retryTicks: 60, blocked: 0.2 } as const;
/** Turns off a blocked heading, in radians: a slide, along the wall, and back the way it came round. */
const SLIDE_TURNS = [Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4] as const;

/** Frees a zombie from the margin of a wall it has been pushed into, to the nearest edge of it. */
function freeFromWalls(zombie: ZombieState, height: number, boxes: readonly CollisionBox[], solids?: CollisionIndex): void {
  const near = solids ? solids.near(zombie.position.x, zombie.position.z, ZOMBIE_MOVEMENT.radius + 1e-6) : boxes;
  const out = pushOutOfBoxes(zombie.position, ZOMBIE_MOVEMENT.radius, height, near);
  if (!out) return;
  zombie.position = { x: out.x, y: zombie.position.y, z: out.z };
  work.stuckRecoveries++;
}

/**
 * Counts a tick against a zombie that meant to move (`wanting`: it had somewhere to go and was not swinging) and is still
 * within `STALL.radius` of where it stood when the count began. Once it has left that circle, or has no wish to move, the
 * count starts again from where it is. Measuring the distance from a fixed spot, not each tick's step, is what catches a
 * zombie that shuffles or dithers in place, which moves every tick and gets nowhere.
 */
export function trackZombieProgress(zombie: ZombieState, wanting: boolean): void {
  if (wanting && Math.hypot(zombie.position.x - zombie.anchorX, zombie.position.z - zombie.anchorZ) < STALL.radius) {
    zombie.stall += 1;
  } else {
    zombie.stall = 0;
    zombie.anchorX = zombie.position.x;
    zombie.anchorZ = zombie.position.z;
  }
}

/**
 * Somewhere close to a stalled zombie that it can stand and walk from: clear of every wall's margin, on the same floor,
 * and reached from where it is by a line with no wall across it (so it is never put through one), nearest the way it was
 * heading. Null when there is nowhere (a zombie walled in stays walled in).
 */
export function freeSpotNear(zombie: ZombieState, toward: Vec3, boxes: readonly CollisionBox[],
  surfaces: readonly WalkSurface[], height: number): Vec3 | null {
  const from = zombie.position, first = (mix32(hashString(zombie.id)) & 7) * (Math.PI / 4);
  let best: Vec3 | null = null, bestDistance = Infinity;
  for (const ring of [0.5, 1, 1.5, 2]) for (let k = 0; k < 8; k++) {
    const angle = first + k * (Math.PI / 4);
    const x = from.x + Math.sin(angle) * ring, z = from.z + Math.cos(angle) * ring;
    const y = sampleWalkHeight(x, z, from.y, surfaces);
    const spot = { x, y, z };
    if (Math.abs(y - from.y) > 0.2 || pushOutOfBoxes(spot, ZOMBIE_MOVEMENT.radius, height, boxes)
      || !hasClearNavigationLine(from, spot, boxes, 0, height) || !hasWalkableConnection(from, spot, surfaces)) continue;
    const distance = Math.hypot(toward.x - x, toward.z - z);
    if (distance < bestDistance) { best = spot; bestDistance = distance; }
  }
  return best;
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
    zombie.struck = false;
    zombie.attackStyle = (zombie.attackStyle + 1) % 8;
    zombie.targetId = target.id;
    return [{ type: 'zombieSwung', zombieId: zombie.id, playerId: target.id }];
  }
  const events: Array<ZombieMeleeEvent | DamageEvent> = [];
  // The blow is live from contact, the tick the arm comes down at the end of the wind-up, until the swing has finished (issue
  // #210): it is a swipe, not a single tick, so whoever is in reach at any point in it is hit, once. A blow that finds the player
  // in another zombie's grace lands when the grace ends, if they are still in reach and the swing is not over.
  if (!zombie.struck && zombie.attackTicks >= timing.windupTicks) {
    // At whoever it was after if they are in reach, else anyone else who is.
    const victim = players.filter(player => player.alive && !player.downed && reach(player, 'strike'))
      .sort((a, b) => Number(b.id === zombie.targetId) - Number(a.id === zombie.targetId) || a.id.localeCompare(b.id))[0];
    if (victim && victim.hurtGraceTicks <= 0) {
      victim.hurtGraceTicks = ZOMBIE_MELEE.hurtGraceTicks;
      zombie.struck = true;
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
  const inReach = (player: PlayerState, range: number, arc: number) => inMeleeReach(zombie, player, collisionBoxes, range) && facesWithin(zombie, player, arc);
  return advanceSwing(zombie, players, target, (player, phase) => phase === 'strike'
    ? inReach(player, strikeRange, ZOMBIE_MELEE.strikeArc)
    : inReach(player, startRange, ZOMBIE_MELEE.startArc) || willConnect(zombie, player, collisionBoxes, strikeRange));
}

/**
 * Whether a blow begun now would land: the player, carrying on as they are, and the zombie, carrying on toward them, are
 * within strike range and the zombie is facing them when the wind-up ends (looking ahead at most
 * `ZOMBIE_MELEE.anticipation` metres of their travel between them). It is all the zombie has to go on; a player who stops short,
 * turns off or backs away in the wind-up is missed.
 */
function willConnect(zombie: ZombieState, player: PlayerState, boxes: readonly CollisionBox[], strikeRange: number): boolean {
  if (!facesWithin(zombie, player, ZOMBIE_MELEE.startArc)) return false;
  const closing = Math.hypot(player.velocity.x, player.velocity.z) + zombieSpeed(zombie);
  const lead = Math.min(swingTiming(zombie).windupTicks / 60, closing > 0 ? ZOMBIE_MELEE.anticipation.maxLeadMetres / closing : Infinity);
  const ahead = { ...player, position: { x: player.position.x + player.velocity.x * lead, y: player.position.y, z: player.position.z + player.velocity.z * lead } };
  // The zombie keeps coming while it swings, so it will be that much nearer too.
  return inMeleeReach(zombie, ahead, boxes, strikeRange + zombieSpeed(zombie) * lead) && facesWithin(zombie, ahead, ZOMBIE_MELEE.strikeArc);
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
 * How far apart zombies keep their middles, in metres: a little more than a body's width (0.64), so a swarm takes up more room
 * and does not pack into a knot. It was 0.58 (bodies overlapping a tenth); the wider it is, the wider a horde stands round its
 * target and the further it strings out behind a player.
 */
export const ZOMBIE_SPACING = 0.72;

/** How far apart a player's middle and a zombie's are when their bodies touch. */
export const BODY_CONTACT = PLAYER_MOVEMENT.radius + ZOMBIE_MOVEMENT.radius;
/** A zombie this near its target has got to them and stops closing (a step from touching). */
const ARRIVED = BODY_CONTACT + 0.04;

/**
 * The share of a squeeze that a zombie free to move (not mid-swing, not coming through a window) gives way by, so a
 * player can shoulder past one slowly. One that is swinging does not give way at all: it is a wall.
 */
export const ZOMBIE_GIVE = 0.3;

/** Deeper than this into the bodies round them, a player is wedged and stops where they were (see `blockPlayerByZombies`). */
export const WEDGE_DEPTH = 0.05;

/**
 * Keeps a player out of the zombies' bodies, as the walls keep them out of a wall (issue #210): a player runs into a
 * zombie and stops, or slides round it, rather than pushing through it. Call after the player has moved from `from`.
 * A swinging zombie holds its ground; one that is free gives way a little (`ZOMBIE_GIVE`; `separateZombies` then moves it
 * the rest of the way, walls permitting), so no crowd is quite a hard wall. The push cannot carry the player through a
 * wall, and only what carried the player into the zombie is taken off their speed, so they keep what runs along it.
 * Wedged between bodies, with no spot within reach that clears them all, the player stops where they were.
 */
export function blockPlayerByZombies(player: PlayerState, from: Vec3, zombies: readonly ZombieState[], boxes: readonly CollisionBox[]): void {
  if (!player.alive || player.downed || player.noclip) return;
  const near = zombies.filter(zombie => zombie.alive && !zombie.entry && Math.abs(player.position.y - zombie.position.y) <= 1
    && Math.hypot(player.position.x - zombie.position.x, player.position.z - zombie.position.z) < BODY_CONTACT + 0.5);
  if (!near.length) return;
  const height = playerHeight(player);
  if (pushPlayerOut(player, near, boxes, height, true) > WEDGE_DEPTH) {
    player.position = { x: from.x, y: player.position.y, z: from.z };
    player.velocity.x = 0; player.velocity.z = 0;
    pushPlayerOut(player, near, boxes, height, false);
  }
}

/** Pushes the player out of the bodies they overlap, a few passes for when one push leads into another; how deep the worst overlap is left. */
function pushPlayerOut(player: PlayerState, zombies: readonly ZombieState[], boxes: readonly CollisionBox[], height: number, give: boolean): number {
  /** How far into a free zombie the player may stay (its give), by zombie. */
  const allowed = new Map<EntityId, number>();
  for (let pass = 0; pass < 4; pass++) {
    let touched = false;
    for (const zombie of zombies) {
      let dx = player.position.x - zombie.position.x, dz = player.position.z - zombie.position.z, distance = Math.hypot(dx, dz);
      let overlap = BODY_CONTACT - (allowed.get(zombie.id) ?? 0) - distance;
      if (overlap <= 0) continue;
      touched = true;
      let shared = 0;
      if (give && pass === 0 && zombie.attackTicks === 0) {
        shared = ZOMBIE_GIVE;
        allowed.set(zombie.id, overlap * shared);
        overlap *= 1 - shared;
      }
      if (distance < 1e-4) { dx = Math.sin(zombie.yaw); dz = Math.cos(zombie.yaw); distance = 1; }
      const ux = dx / distance, uz = dz / distance;
      player.position = moveWithCollision(player.position, { x: ux * overlap, y: 0, z: uz * overlap },
        PLAYER_MOVEMENT.radius, height, boxes);
      const into = player.velocity.x * ux + player.velocity.z * uz;
      if (into < 0) { player.velocity.x -= into * ux * (1 - shared); player.velocity.z -= into * uz * (1 - shared); }
    }
    if (!touched) break;
  }
  let deepest = 0;
  for (const zombie of zombies) {
    const distance = Math.hypot(player.position.x - zombie.position.x, player.position.z - zombie.position.z);
    deepest = Math.max(deepest, BODY_CONTACT - (allowed.get(zombie.id) ?? 0) - distance);
  }
  return deepest;
}

/**
 * Keeps zombies out of each other and out of the players they hunt, so a crowd spreads round its target instead of piling
 * onto one point (whose blows would then all land together). Each pair closer than their bodies allow is pushed apart, half
 * each (all of it for the one that is free to move, when the other is mid-swing or coming through a window), and a zombie
 * that has walked into a player is pushed back out (unless it is swinging, and the player can be stopped: then the player
 * is the one held off, see `blockPlayerByZombies`). Walls still hold. Call once a tick, after the zombies have moved.
 */
export function separateZombies(zombies: readonly ZombieState[], players: readonly PlayerState[],
  boxes: readonly CollisionBox[], surfaces: readonly WalkSurface[], solids?: CollisionIndex): void {
  const gap = ZOMBIE_SPACING, playerGap = BODY_CONTACT;
  /** Pushes a zombie, walls permitting, and says how far along the push it got. */
  const shove = (zombie: ZombieState, dx: number, dz: number): number => {
    const delta = { x: dx, y: 0, z: dz };
    const next = solids ? solids.move(zombie.position, delta, ZOMBIE_MOVEMENT.radius, ZOMBIE_MOVEMENT.height)
      : moveWithCollision(zombie.position, delta, ZOMBIE_MOVEMENT.radius, ZOMBIE_MOVEMENT.height, boxes);
    next.y = sampleWalkHeight(next.x, next.z, zombie.position.y, surfaces);
    const along = ((next.x - zombie.position.x) * dx + (next.z - zombie.position.z) * dz) / (Math.hypot(dx, dz) || 1);
    zombie.position = next;
    return along;
  };
  // Free to be moved: out in the open, and not swinging on the spot (one swinging on the move can be jostled like any other).
  const free = (zombie: ZombieState) => !zombie.entry && !(zombie.attackTicks > 0 && zombie.velocity.x === 0 && zombie.velocity.z === 0);
  /** Pairs pressed against each other, to find who is queued behind a fight (see `holdBehindFighters`). */
  let touching: Array<[number, number]> | null = null;
  // A few passes, each settling every pair and then every zombie against its player: one is not enough for a queue pressing
  // on a zombie that holds its ground (each pair's push is undone by the next pair down the line), and stops early once
  // nothing is more than a few millimetres off.
  for (let pass = 0; pass < SEPARATION_PASSES; pass++) {
    let unsettled = false;
    for (let i = 0; i < zombies.length; i++) {
      const a = zombies[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < zombies.length; j++) {
        const b = zombies[j];
        if (!b.alive || Math.abs(a.position.y - b.position.y) > 1) continue;
        work.separationPairs++;
        let dx = a.position.x - b.position.x, dz = a.position.z - b.position.z, distance = Math.hypot(dx, dz);
        if (pass === 0 && distance < gap + TOUCH_SLACK) (touching ??= []).push([i, j]);
        if (distance >= gap) continue;
        work.separationShoves++;
        if (distance < 1e-4) { const angle = (mix32(hashString(a.id) ^ hashString(b.id)) / 0x1_0000_0000) * Math.PI * 2; dx = Math.cos(angle); dz = Math.sin(angle); distance = 1; }
        const overlap = gap - Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z), ux = dx / distance, uz = dz / distance;
        if (overlap > SETTLED) unsettled = true;
        const aFree = free(a), bFree = free(b);
        if (aFree && bFree) {
          // A zombie against a wall cannot give way, so the other gives way for it rather than staying in its body.
          const gaveA = shove(a, ux * overlap / 2, uz * overlap / 2), owedB = overlap - gaveA;
          const gaveB = shove(b, -ux * owedB, -uz * owedB), rest = owedB - gaveB;
          if (rest > 1e-6) shove(a, ux * rest, uz * rest);
        } else if (aFree) shove(a, ux * overlap, uz * overlap);
        else if (bFree) shove(b, -ux * overlap, -uz * overlap);
      }
    }
    for (const zombie of zombies) {
      if (!zombie.alive || zombie.entry) continue;
      for (const player of players) {
        if (!player.alive || Math.abs(player.position.y - zombie.position.y) > 1) continue;
        // A swinging zombie holds its ground against a player who is stopped by it (blockPlayerByZombies); a downed player
        // is not, so a zombie over one is still pushed off.
        if (zombie.attackTicks > 0 && !player.downed) continue;
        const dx = zombie.position.x - player.position.x, dz = zombie.position.z - player.position.z, distance = Math.hypot(dx, dz);
        if (distance >= playerGap) continue;
        const push = playerGap - distance, ux = distance > 1e-4 ? dx / distance : Math.sin(zombie.yaw), uz = distance > 1e-4 ? dz / distance : Math.cos(zombie.yaw);
        if (push > SETTLED) unsettled = true;
        shove(zombie, ux * push, uz * push);
      }
    }
    if (!unsettled) break;
  }
  if (touching) holdBehindFighters(zombies, players, touching);
}

/** How much nearer than touching two bodies must be to count as pressed together. */
const TOUCH_SLACK = 0.1;
/** Passes of separation a tick, at most, and the overlap (metres) under which a pass finds nothing left to settle. */
const SEPARATION_PASSES = 4, SETTLED = 0.005;

/**
 * A zombie queued behind others that are fighting (swinging, or against a player) is held up by them, not stuck on the
 * map, so its stall count starts again: otherwise it is taken for stuck after three seconds and put down somewhere
 * close (`freeSpotNear`), which in a crowd is through the ones in front of it, on top of the player. A jam with no
 * fighter in it (zombies wedged on a corner, say) is not held, and recovers as before.
 */
function holdBehindFighters(zombies: readonly ZombieState[], players: readonly PlayerState[], touching: ReadonlyArray<readonly [number, number]>): void {
  const parent = zombies.map((_, index) => index);
  const find = (index: number): number => {
    while (parent[index] !== index) { parent[index] = parent[parent[index]]; index = parent[index]; }
    return index;
  };
  for (const [i, j] of touching) parent[find(i)] = find(j);
  const fighting = new Set<number>();
  zombies.forEach((zombie, index) => {
    if (zombie.alive && (zombie.attackTicks > 0 || players.some(player => player.alive
      && Math.hypot(player.position.x - zombie.position.x, player.position.z - zombie.position.z) < BODY_CONTACT + 0.25))) fighting.add(find(index));
  });
  zombies.forEach((zombie, index) => {
    if (!zombie.alive || !fighting.has(find(index))) return;
    zombie.stall = 0; zombie.anchorX = zombie.position.x; zombie.anchorZ = zombie.position.z;
  });
}
