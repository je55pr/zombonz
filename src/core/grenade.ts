import { moveWithCollision, walkSurfaceHeight, type CollisionBox, type WalkSurface } from './collision.ts';
import { damagePlayer, type DamageEvent } from './health.ts';
import type { EntityId, PlayerState, Vec3, ZombieState } from './types.ts';
import { rayAabbDistance, rayFromPlayer, type WeaponEvent } from './weapon.ts';

export const GRENADE_RULES = {
  /** WaW/BO1: two to start, two more each round, carrying at most four. */
  starting: 2, perRound: 2, maximum: 4, fuseTicks: 120, radius: 4, damage: 350, gravity: 13,
} as const;

export interface GrenadeState {
  id: string;
  ownerId: EntityId;
  position: Vec3;
  velocity: Vec3;
  fuseTicksRemaining: number;
}

export interface GrenadePool {
  nextId: number;
  active: GrenadeState[];
}

export type GrenadeEvent =
  | { type: 'grenadeThrown'; grenadeId: string; playerId: EntityId }
  | { type: 'grenadeExploded'; grenadeId: string; playerId: EntityId; position: Vec3 };

export function createGrenadePool(): GrenadePool { return { nextId: 1, active: [] }; }

export function throwGrenade(pool: GrenadePool, player: PlayerState): GrenadeEvent[] {
  if (!player.alive || player.grenadeCharges <= 0 || player.noclip) return [];
  const direction = rayFromPlayer(player, 1.3).direction;
  const grenade: GrenadeState = {
    id: `g:${pool.nextId++}`, ownerId: player.id,
    position: { x: player.position.x + direction.x * 0.55,
      y: player.position.y + 1.3, z: player.position.z + direction.z * 0.55 },
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

function clearBlast(from: Vec3, to: Vec3, boxes: readonly CollisionBox[]): boolean {
  const distance = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
  if (distance < 0.001) return true;
  const direction = { x: (to.x - from.x) / distance,
    y: (to.y - from.y) / distance, z: (to.z - from.z) / distance };
  return boxes.every(box => rayAabbDistance({ origin: from, direction }, box.min, box.max,
    distance - 0.01) === null);
}

function explode(grenade: GrenadeState, zombies: readonly ZombieState[], players: readonly PlayerState[],
  boxes: readonly CollisionBox[], instaKill: boolean): (GrenadeEvent | WeaponEvent | DamageEvent)[] {
  const center = { ...grenade.position };
  const events: (GrenadeEvent | WeaponEvent | DamageEvent)[] = [
    { type: 'grenadeExploded', grenadeId: grenade.id, playerId: grenade.ownerId, position: center },
  ];
  for (const zombie of zombies) {
    if (!zombie.alive) continue;
    const target = { x: zombie.position.x, y: zombie.position.y + 0.9, z: zombie.position.z };
    const distance = Math.hypot(target.x - center.x, target.y - center.y, target.z - center.z);
    if (distance >= GRENADE_RULES.radius || !clearBlast(center, target, boxes)) continue;
    const damage = Math.min(zombie.health, instaKill ? zombie.health
      : Math.round(GRENADE_RULES.damage * (1 - distance / GRENADE_RULES.radius)));
    if (damage <= 0) continue;
    zombie.health -= damage;
    events.push({ type: 'grenadeHit', playerId: grenade.ownerId, zombieId: zombie.id, damage },
      { type: 'zombieDamaged', zombieId: zombie.id, playerId: grenade.ownerId, damage, health: zombie.health });
    if (zombie.health === 0) {
      zombie.alive = false; zombie.velocity = { x: 0, y: 0, z: 0 };
      events.push({ type: 'zombieDied', zombieId: zombie.id, playerId: grenade.ownerId, method: 'body' });
    }
  }
  const owner = players.find(player => player.id === grenade.ownerId);
  if (owner?.alive) {
    const target = { x: owner.position.x, y: owner.position.y + 0.9, z: owner.position.z };
    const distance = Math.hypot(target.x - center.x, target.y - center.y, target.z - center.z);
    if (distance < GRENADE_RULES.radius && clearBlast(center, target, boxes)) {
      events.push(...damagePlayer(owner, Math.round(100 * (1 - distance / GRENADE_RULES.radius))));
    }
  }
  return events;
}

export function tickGrenades(pool: GrenadePool, zombies: readonly ZombieState[],
  players: readonly PlayerState[], boxes: readonly CollisionBox[], surfaces: readonly WalkSurface[],
  deltaSeconds: number, instaKill = false): (GrenadeEvent | WeaponEvent | DamageEvent)[] {
  const events: (GrenadeEvent | WeaponEvent | DamageEvent)[] = [];
  const remaining: GrenadeState[] = [];
  for (const grenade of pool.active) {
    const requested = { x: grenade.velocity.x * deltaSeconds, y: 0, z: grenade.velocity.z * deltaSeconds };
    const next = moveWithCollision(grenade.position, requested, 0.1, 0.2, boxes);
    if (Math.abs(next.x - grenade.position.x - requested.x) > 1e-7) grenade.velocity.x *= -0.45;
    if (Math.abs(next.z - grenade.position.z - requested.z) > 1e-7) grenade.velocity.z *= -0.45;
    grenade.velocity.y -= GRENADE_RULES.gravity * deltaSeconds;
    next.y = grenade.position.y + grenade.velocity.y * deltaSeconds;
    const floor = floorHeight({ x: next.x, y: grenade.position.y, z: next.z }, surfaces);
    if (next.y < floor + 0.1) {
      next.y = floor + 0.1;
      grenade.velocity.y = Math.abs(grenade.velocity.y) > 1 ? -grenade.velocity.y * 0.35 : 0;
      grenade.velocity.x *= 0.78; grenade.velocity.z *= 0.78;
    }
    grenade.position = next;
    grenade.fuseTicksRemaining -= 1;
    if (grenade.fuseTicksRemaining <= 0) events.push(...explode(grenade, zombies, players, boxes, instaKill));
    else remaining.push(grenade);
  }
  pool.active = remaining;
  return events;
}
