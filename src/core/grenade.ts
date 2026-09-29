import { detonate, type BlastEvent, type BlastRules } from './blast.ts';
import { moveWithCollision, walkSurfaceHeight, type CollisionBox, type WalkSurface } from './collision.ts';
import { blastHazards, type HazardEvent, type HazardTarget } from './hazard.ts';
import type { DamageEvent } from './health.ts';
import { clearLine } from './ray.ts';
import type { EntityId, PlayerState, Vec3, ZombieState } from './types.ts';
import { rayFromPlayer, type WeaponEvent } from './weapon.ts';

export const GRENADE_RULES = {
  /** WaW/BO1: two to start, two more each round, carrying at most four. */
  starting: 2, perRound: 2, maximum: 4, fuseTicks: 120, radius: 4, damage: 350, playerDamage: 100, gravity: 13,
  windupTicks: 18,
} as const;

/**
 * Bouncing Betties, as in Black Ops: bought two at a time (at most two carried), set on the floor, and
 * armed after a moment. A zombie walking close springs one: it jumps to about chest height and goes off there.
 */
export const MINE_RULES = {
  perPurchase: 2, maximum: 2, armTicks: 75, popTicks: 20, popHeight: 1.25,
  /** A zombie this close (across the floor) and within this height of it springs the mine. */
  triggerRadius: 1.7, triggerHeight: 2,
  /** How far in front of the player it is set, and how many one player may have out at once. */
  placeDistance: 0.8, maxActive: 8,
  blast: { radius: 4.5, damage: 1200, playerDamage: 70 } satisfies BlastRules,
} as const;

export interface GrenadeState {
  id: string;
  ownerId: EntityId;
  position: Vec3;
  velocity: Vec3;
  fuseTicksRemaining: number;
}

/** A mine on the floor. `ticksRemaining` counts the arming or the jump; an armed mine just waits. */
export interface MineState {
  id: string;
  ownerId: EntityId;
  position: Vec3;
  phase: 'arming' | 'armed' | 'popping';
  ticksRemaining: number;
}

/** Everything thrown or set down that will go off: grenades in the air and mines on the floor. */
export interface GrenadePool {
  nextId: number;
  active: GrenadeState[];
  mines: MineState[];
  nextMineId: number;
}

export type GrenadeEvent =
  | { type: 'grenadeThrown'; grenadeId: string; playerId: EntityId }
  /** A grenade struck a wall or the floor hard enough to hear; `speed` is how fast it was going. */
  | { type: 'grenadeBounced'; grenadeId: string; position: Vec3; speed: number }
  | { type: 'grenadeExploded'; grenadeId: string; playerId: EntityId; position: Vec3 }
  | { type: 'minePlaced'; mineId: string; playerId: EntityId; position: Vec3 }
  | { type: 'mineArmed'; mineId: string; position: Vec3 }
  | { type: 'mineTriggered'; mineId: string; position: Vec3 }
  | { type: 'mineExploded'; mineId: string; playerId: EntityId; position: Vec3; radius: number };

type ExplosiveEvent = GrenadeEvent | WeaponEvent | DamageEvent | BlastEvent | HazardEvent;

export function createGrenadePool(): GrenadePool { return { nextId: 1, active: [], mines: [], nextMineId: 1 }; }

export function throwGrenade(pool: GrenadePool, player: PlayerState): GrenadeEvent[] {
  if (!player.alive || player.grenadeCharges <= 0 || player.noclip) return [];
  const throwHeight = player.stance === 'prone' ? 0.4 : player.stance === 'crouch' ? 0.9 : 1.3;
  const direction = rayFromPlayer(player, throwHeight).direction;
  const grenade: GrenadeState = {
    id: `g:${pool.nextId++}`, ownerId: player.id,
    position: { x: player.position.x + direction.x * 0.55,
      y: player.position.y + throwHeight, z: player.position.z + direction.z * 0.55 },
    velocity: { x: direction.x * 9 || 0, y: 3.5 + direction.y * 7, z: direction.z * 9 || 0 },
    fuseTicksRemaining: GRENADE_RULES.fuseTicks,
  };
  player.grenadeCharges -= 1;
  pool.active.push(grenade);
  return [{ type: 'grenadeThrown', grenadeId: grenade.id, playerId: player.id }];
}

function floorHeight(position: Vec3, surfaces: readonly WalkSurface[]): number {
  let best = Number.NEGATIVE_INFINITY;
  for (const surface of surfaces) {
    const height = walkSurfaceHeight(surface, position.x, position.z);
    if (height !== undefined && height <= position.y + 0.1 && height > best) best = height;
  }
  return Number.isFinite(best) ? best : 0;
}

/** A blast in the world: hurts zombies, the owner and hazards in reach, credited to the owner. */
function blastOf(centre: Vec3, rules: BlastRules, ownerId: EntityId, zombies: readonly ZombieState[],
  players: readonly PlayerState[], boxes: readonly CollisionBox[], instaKill: boolean,
  hazards: readonly HazardTarget[]): ExplosiveEvent[] {
  return [...detonate(centre, rules, ownerId, 'owner', { zombies, players, boxes, instaKill }),
    ...blastHazards(centre, rules, ownerId, hazards, boxes)];
}

export function tickGrenades(pool: GrenadePool, zombies: readonly ZombieState[],
  players: readonly PlayerState[], boxes: readonly CollisionBox[], surfaces: readonly WalkSurface[],
  deltaSeconds: number, instaKill = false, hazards: readonly HazardTarget[] = []): ExplosiveEvent[] {
  const events: ExplosiveEvent[] = [];
  const remaining: GrenadeState[] = [];
  for (const grenade of pool.active) {
    const requested = { x: grenade.velocity.x * deltaSeconds, y: 0, z: grenade.velocity.z * deltaSeconds };
    const next = moveWithCollision(grenade.position, requested, 0.1, 0.2, boxes);
    // How hard it hit anything this tick, for the sound of it.
    let impact = 0;
    if (Math.abs(next.x - grenade.position.x - requested.x) > 1e-7) { impact = Math.max(impact, Math.abs(grenade.velocity.x)); grenade.velocity.x *= -0.45; }
    if (Math.abs(next.z - grenade.position.z - requested.z) > 1e-7) { impact = Math.max(impact, Math.abs(grenade.velocity.z)); grenade.velocity.z *= -0.45; }
    grenade.velocity.y -= GRENADE_RULES.gravity * deltaSeconds;
    next.y = grenade.position.y + grenade.velocity.y * deltaSeconds;
    const floor = floorHeight({ x: next.x, y: grenade.position.y, z: next.z }, surfaces);
    if (next.y < floor + 0.1) {
      next.y = floor + 0.1;
      if (Math.abs(grenade.velocity.y) > 1) impact = Math.max(impact, Math.abs(grenade.velocity.y));
      grenade.velocity.y = Math.abs(grenade.velocity.y) > 1 ? -grenade.velocity.y * 0.35 : 0;
      grenade.velocity.x *= 0.78; grenade.velocity.z *= 0.78;
    }
    grenade.position = next;
    grenade.fuseTicksRemaining -= 1;
    if (impact > 1.5) events.push({ type: 'grenadeBounced', grenadeId: grenade.id, position: { ...next }, speed: impact });
    if (grenade.fuseTicksRemaining <= 0) {
      const centre = { ...grenade.position };
      events.push({ type: 'grenadeExploded', grenadeId: grenade.id, playerId: grenade.ownerId, position: centre },
        ...blastOf(centre, GRENADE_RULES, grenade.ownerId, zombies, players, boxes, instaKill, hazards));
    } else remaining.push(grenade);
  }
  pool.active = remaining;
  return events;
}

/**
 * Sets a mine on the floor in front of the player (at their feet if a wall is in the way), spending a charge.
 * Nothing is set from last stand, while flying, or beyond `MINE_RULES.maxActive` at once.
 */
export function placeMine(pool: GrenadePool, player: PlayerState, boxes: readonly CollisionBox[],
  surfaces: readonly WalkSurface[]): GrenadeEvent[] {
  if (!player.alive || player.downed || player.noclip || player.mineCharges <= 0) return [];
  if (pool.mines.filter(mine => mine.ownerId === player.id).length >= MINE_RULES.maxActive) return [];
  let x = player.position.x - Math.sin(player.yaw) * MINE_RULES.placeDistance;
  let z = player.position.z - Math.cos(player.yaw) * MINE_RULES.placeDistance;
  const waist = player.position.y + 0.5;
  if (!clearLine({ x: player.position.x, y: waist, z: player.position.z }, { x, y: waist, z }, boxes)) {
    x = player.position.x; z = player.position.z;
  }
  const floor = floorHeight({ x, y: player.position.y, z }, surfaces);
  const mine: MineState = { id: `m:${pool.nextMineId++}`, ownerId: player.id,
    position: { x, y: surfaces.length ? floor : player.position.y, z }, phase: 'arming', ticksRemaining: MINE_RULES.armTicks };
  player.mineCharges -= 1;
  pool.mines.push(mine);
  return [{ type: 'minePlaced', mineId: mine.id, playerId: player.id, position: { ...mine.position } }];
}

/** Arms mines, springs them under passing zombies and sets off the ones that have jumped. */
export function tickMines(pool: GrenadePool, zombies: readonly ZombieState[], players: readonly PlayerState[],
  boxes: readonly CollisionBox[], instaKill = false, hazards: readonly HazardTarget[] = []): ExplosiveEvent[] {
  const events: ExplosiveEvent[] = [];
  const remaining: MineState[] = [];
  for (const mine of pool.mines) {
    if (mine.phase === 'arming') {
      mine.ticksRemaining -= 1;
      if (mine.ticksRemaining <= 0) {
        mine.phase = 'armed'; mine.ticksRemaining = 0;
        events.push({ type: 'mineArmed', mineId: mine.id, position: { ...mine.position } });
      }
    } else if (mine.phase === 'armed') {
      const sprung = zombies.some(zombie => zombie.alive
        && Math.hypot(zombie.position.x - mine.position.x, zombie.position.z - mine.position.z) <= MINE_RULES.triggerRadius
        && Math.abs(zombie.position.y - mine.position.y) < MINE_RULES.triggerHeight);
      if (sprung) {
        mine.phase = 'popping'; mine.ticksRemaining = MINE_RULES.popTicks;
        events.push({ type: 'mineTriggered', mineId: mine.id, position: { ...mine.position } });
      }
    } else {
      mine.ticksRemaining -= 1;
      if (mine.ticksRemaining <= 0) {
        const centre = { x: mine.position.x, y: mine.position.y + MINE_RULES.popHeight, z: mine.position.z };
        events.push({ type: 'mineExploded', mineId: mine.id, playerId: mine.ownerId, position: centre, radius: MINE_RULES.blast.radius },
          ...blastOf(centre, MINE_RULES.blast, mine.ownerId, zombies, players, boxes, instaKill, hazards));
        continue;
      }
    }
    remaining.push(mine);
  }
  pool.mines = remaining;
  return events;
}
