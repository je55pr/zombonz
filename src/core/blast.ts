import type { CollisionBox } from './collision.ts';
import { damagePlayer, type DamageEvent } from './health.ts';
import { clearLine } from './ray.ts';
import type { EntityId, PlayerState, Vec3, ZombieState } from './types.ts';
import type { WeaponEvent } from './weapon.ts';

/**
 * How an explosion hurts, whatever set it off (a grenade, a rocket, a Bouncing Betty, a barrel or a
 * burning car): damage is greatest at the centre and falls in a straight line to nothing at `radius`.
 * `damage` is what zombies and other hazards take; players take `playerDamage`.
 */
export interface BlastRules {
  radius: number;
  damage: number;
  playerDamage: number;
}

/** The point on a standing figure a blast is measured to. */
export function chestOf(position: Vec3): Vec3 {
  return { x: position.x, y: position.y + 0.9, z: position.z };
}

/** 1 at the centre, 0 at the edge. */
export function blastScale(distance: number, radius: number): number {
  return Math.max(0, 1 - distance / radius);
}

export interface BlastHit<T> {
  target: T;
  distance: number;
  /** `blastScale` at that distance. */
  scale: number;
}

/**
 * Everything among `things` a blast at `centre` reaches: inside the radius, and in a straight line from
 * the centre with no wall between (`boxes` are the walls; a thing's own solid body must not be in them).
 * Results are in the order given, so the same match always resolves the same way.
 */
export function blastReach<T>(centre: Vec3, radius: number, things: readonly T[], pointOf: (thing: T) => Vec3,
  boxes: readonly CollisionBox[]): BlastHit<T>[] {
  const hits: BlastHit<T>[] = [];
  for (const thing of things) {
    const point = pointOf(thing);
    const distance = Math.hypot(point.x - centre.x, point.y - centre.y, point.z - centre.z);
    if (distance >= radius || !clearLine(centre, point, boxes)) continue;
    hits.push({ target: thing, distance, scale: blastScale(distance, radius) });
  }
  return hits;
}

export const blastZombies = (centre: Vec3, radius: number, zombies: readonly ZombieState[], boxes: readonly CollisionBox[]) =>
  blastReach(centre, radius, zombies.filter(zombie => zombie.alive), zombie => chestOf(zombie.position), boxes);

export const blastPlayers = (centre: Vec3, radius: number, players: readonly PlayerState[], boxes: readonly CollisionBox[]) =>
  blastReach(centre, radius, players.filter(player => player.alive), player => chestOf(player.position), boxes);

/** What an explosion acts on: `boxes` are the walls that shelter things from it. */
export interface BlastContext {
  zombies: readonly ZombieState[];
  players: readonly PlayerState[];
  boxes: readonly CollisionBox[];
  /** Insta-Kill: any zombie the blast reaches dies, however far from the centre. */
  instaKill: boolean;
}

export type BlastEvent = Extract<WeaponEvent, { type: 'grenadeHit' | 'zombieDamaged' | 'zombieDied' }> | DamageEvent;

/**
 * The blast of a grenade, a Betty, a barrel or a car. Zombies in reach are hurt and credited to `credit`
 * (who is paid for the kills); a thrown or placed explosive hurts only its owner among the players
 * (`victims` 'owner'), while a barrel or car in the map hurts everyone near it (`victims` 'all').
 */
export function detonate(centre: Vec3, rules: BlastRules, credit: EntityId, victims: 'owner' | 'all',
  context: BlastContext): BlastEvent[] {
  const events: BlastEvent[] = [];
  for (const { target: zombie, scale } of blastZombies(centre, rules.radius, context.zombies, context.boxes)) {
    const damage = Math.min(zombie.health, context.instaKill ? zombie.health : Math.round(rules.damage * scale));
    if (damage <= 0) continue;
    zombie.health -= damage;
    events.push({ type: 'grenadeHit', playerId: credit, zombieId: zombie.id, damage },
      { type: 'zombieDamaged', zombieId: zombie.id, playerId: credit, damage, health: zombie.health });
    if (zombie.health === 0) {
      zombie.alive = false; zombie.velocity = { x: 0, y: 0, z: 0 };
      events.push({ type: 'zombieDied', zombieId: zombie.id, playerId: credit, method: 'body' });
    }
  }
  const exposed = victims === 'all' ? context.players : context.players.filter(player => player.id === credit);
  for (const { target: player, scale } of blastPlayers(centre, rules.radius, exposed, context.boxes)) {
    events.push(...damagePlayer(player, Math.round(rules.playerDamage * scale)));
  }
  return events;
}
