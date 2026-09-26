import type { CollisionBox } from './collision.ts';
import type { EntityId, PlayerState, Vec3, WeaponState, ZombieState } from './types.ts';
import { SeededRng } from './rng.ts';

export interface WeaponDefinition {
  id: string;
  damage: number;
  range: number;
  fireIntervalTicks: number;
  trigger: 'semi' | 'auto';
  magazineSize: number;
  startingReserveAmmo: number;
  reloadTicks: number;
  hipSpreadRadians: number;
}

export const WEAPON_DEFINITIONS: Readonly<Record<string, WeaponDefinition>> = {
  'starter-pistol': {
    id: 'starter-pistol', damage: 50, range: 60, fireIntervalTicks: 12, trigger: 'semi',
    magazineSize: 8, startingReserveAmmo: 32, reloadTicks: 90, hipSpreadRadians: 0.008,
  },
  kar98k: {
    id: 'kar98k', damage: 100, range: 80, fireIntervalTicks: 45, trigger: 'semi',
    magazineSize: 5, startingReserveAmmo: 50, reloadTicks: 120, hipSpreadRadians: 0.015,
  },
  thompson: {
    id: 'thompson', damage: 65, range: 60, fireIntervalTicks: 6, trigger: 'auto',
    magazineSize: 20, startingReserveAmmo: 160, reloadTicks: 120, hipSpreadRadians: 0.03,
  },
  mp40: {
    id: 'mp40', damage: 75, range: 65, fireIntervalTicks: 8, trigger: 'auto',
    magazineSize: 32, startingReserveAmmo: 192, reloadTicks: 138, hipSpreadRadians: 0.027,
  },
  bar: {
    id: 'bar', damage: 125, range: 80, fireIntervalTicks: 10, trigger: 'auto',
    magazineSize: 20, startingReserveAmmo: 140, reloadTicks: 150, hipSpreadRadians: 0.035,
  },
};

export function createWeaponState(weaponId: string): WeaponState {
  const definition = WEAPON_DEFINITIONS[weaponId];
  if (!definition) throw new Error(`Unknown weapon: ${weaponId}`);
  return {
    weaponId: definition.id, cooldownTicks: 0,
    magazineAmmo: definition.magazineSize, reserveAmmo: definition.startingReserveAmmo,
    reloadTicksRemaining: 0,
  };
}

export function createStarterWeaponState(): WeaponState {
  return createWeaponState('starter-pistol');
}

export const WEAPON_SWITCH_TICKS = 24;

export function ownedWeapon(player: PlayerState, id: string): WeaponState | undefined {
  return [player.weapon, player.holsteredWeapon].find(weapon => weapon?.weaponId === id) ?? undefined;
}

/** Fill the second slot first; only a third distinct gun replaces the held weapon. */
export function equipWeapon(player: PlayerState, id: string): void {
  const next = createWeaponState(id);
  player.weapon.reloadTicksRemaining = 0;
  if (player.weapon.weaponId === id) { player.weapon = next; return; }
  if (!player.holsteredWeapon) player.holsteredWeapon = player.weapon;
  else if (player.holsteredWeapon.weaponId === id) player.holsteredWeapon = player.weapon;
  player.weapon = next;
  player.switchTicksRemaining = WEAPON_SWITCH_TICKS;
}

export function switchWeapon(player: PlayerState): WeaponEvent[] {
  if (!player.alive || !player.holsteredWeapon || player.switchTicksRemaining > 0 || player.meleeCooldownTicks > 0) return [];
  player.weapon.reloadTicksRemaining = 0;
  [player.weapon, player.holsteredWeapon] = [player.holsteredWeapon, player.weapon];
  player.switchTicksRemaining = WEAPON_SWITCH_TICKS;
  return [{ type: 'weaponSwitched', playerId: player.id, weaponId: player.weapon.weaponId }];
}
export interface HitscanRay {
  origin: Vec3;
  direction: Vec3;
}

export type HitscanTarget =
  | { kind: 'world'; distance: number }
  | { kind: 'zombie'; distance: number; zombieId: EntityId; hitZone: 'head' | 'body' }
  | { kind: 'none'; distance: number };

export type WeaponEvent =
  | { type: 'weaponSwitched'; playerId: EntityId; weaponId: string }
  | { type: 'weaponFired'; playerId: EntityId; weaponId: string }
  | { type: 'weaponReloadStarted'; playerId: EntityId; weaponId: string; reloadTicks: number }
  | { type: 'weaponReloadCompleted'; playerId: EntityId; weaponId: string; loaded: number; magazineAmmo: number; reserveAmmo: number }
  | { type: 'weaponHit'; playerId: EntityId; weaponId: string; zombieId: EntityId; damage: number; distance: number; hitZone?: 'head' | 'body' }
  | { type: 'meleeSwung'; playerId: EntityId }
  | { type: 'meleeHit'; playerId: EntityId; zombieId: EntityId; damage: number }
  | { type: 'grenadeHit'; playerId: EntityId; zombieId: EntityId; damage: number }
  | { type: 'zombieDamaged'; zombieId: EntityId; playerId: EntityId; damage: number; health: number }
  | { type: 'zombieDied'; zombieId: EntityId; playerId: EntityId; method?: 'body' | 'head' | 'melee' };

function normalize(direction: Vec3): Vec3 {
  const length = Math.hypot(direction.x, direction.y, direction.z);
  if (length <= 0) throw new RangeError('Hitscan direction must be non-zero.');
  return { x: direction.x / length, y: direction.y / length, z: direction.z / length };
}
export function rayFromPlayer(player: PlayerState, eyeHeight: number): HitscanRay {
  const cosPitch = Math.cos(player.pitch);
  return {
    origin: { x: player.position.x, y: player.position.y + eyeHeight, z: player.position.z },
    direction: normalize({
      x: -Math.sin(player.yaw) * cosPitch,
      y: Math.sin(player.pitch),
      z: -Math.cos(player.yaw) * cosPitch,
    }),
  };
}

/** Seeded angular variation keeps gameplay repeatable while making ADS useful. */
export function spreadHitscanRay(ray: HitscanRay, radians: number, seed: number): HitscanRay {
  if (radians <= 0) return ray;
  const rng = new SeededRng(seed);
  const yaw = Math.atan2(-ray.direction.x, -ray.direction.z) + (rng.next() * 2 - 1) * radians;
  const pitch = Math.asin(Math.max(-1, Math.min(1, ray.direction.y))) + (rng.next() * 2 - 1) * radians;
  const cosPitch = Math.cos(pitch);
  return { origin: ray.origin, direction: normalize({
    x: -Math.sin(yaw) * cosPitch, y: Math.sin(pitch), z: -Math.cos(yaw) * cosPitch,
  }) };
}

export function rayAabbDistance(
  ray: HitscanRay,
  min: Vec3,
  max: Vec3,
  maxDistance: number,
): number | null {
  let tMin = 0;
  let tMax = maxDistance;
  for (const axis of ['x', 'y', 'z'] as const) {
    const origin = ray.origin[axis];
    const direction = ray.direction[axis];
    if (Math.abs(direction) < 1e-12) {
      if (origin < min[axis] || origin > max[axis]) return null;
      continue;
    }
    let near = (min[axis] - origin) / direction;
    let far = (max[axis] - origin) / direction;
    if (near > far) [near, far] = [far, near];
    tMin = Math.max(tMin, near);
    tMax = Math.min(tMax, far);
    if (tMin > tMax) return null;
  }
  return tMin <= maxDistance ? tMin : null;
}
function nearestWorldDistance(
  ray: HitscanRay,
  boxes: readonly CollisionBox[],
  maxDistance: number,
): number | null {
  let best: number | null = null;
  for (const box of boxes) {
    const distance = rayAabbDistance(ray, box.min, box.max, maxDistance);
    if (distance === null) continue;
    if (best === null || distance < best) best = distance;
  }
  return best;
}

function zombieHitDistance(ray: HitscanRay, zombie: ZombieState, maxDistance: number): number | null {
  const radius = 0.32;
  const height = zombie.entry?.phase === 'vaulting' ? 1.72 * 0.85 : 1.72;
  return rayAabbDistance(
    ray,
    { x: zombie.position.x - radius, y: zombie.position.y, z: zombie.position.z - radius },
    { x: zombie.position.x + radius, y: zombie.position.y + height, z: zombie.position.z + radius },
    maxDistance,
  );
}

export function resolveHitscan(
  ray: HitscanRay,
  zombies: readonly ZombieState[],
  worldBoxes: readonly CollisionBox[],
  range: number,
): HitscanTarget {
  const worldDistance = nearestWorldDistance(ray, worldBoxes, range);
  let bestZombie: { zombieId: EntityId; distance: number } | null = null;
  for (const zombie of zombies) {
    if (!zombie.alive) continue;
    const distance = zombieHitDistance(ray, zombie, range);
    if (distance === null || (worldDistance !== null && distance >= worldDistance)) continue;
    if (!bestZombie || distance < bestZombie.distance || (distance === bestZombie.distance && zombie.id < bestZombie.zombieId)) {
      bestZombie = { zombieId: zombie.id, distance };
    }
  }
  if (bestZombie) {
    const zombie = zombies.find(zombie => zombie.id === bestZombie!.zombieId)!;
    const scale = zombie.entry?.phase === 'vaulting' ? 0.85 : 1;
    const impactY = ray.origin.y + ray.direction.y * bestZombie.distance - zombie.position.y;
    return { kind: 'zombie', ...bestZombie, hitZone: impactY >= 1.42 * scale ? 'head' : 'body' };
  }
  if (worldDistance !== null) return { kind: 'world', distance: worldDistance };
  return { kind: 'none', distance: range };
}
export function beginReload(player: PlayerState): WeaponEvent[] {
  const definition = WEAPON_DEFINITIONS[player.weapon.weaponId];
  if (!definition || !player.alive || player.meleeCooldownTicks > 0 || player.switchTicksRemaining > 0) return [];
  if (player.weapon.reloadTicksRemaining > 0) return [];
  if (player.weapon.magazineAmmo >= definition.magazineSize || player.weapon.reserveAmmo <= 0) return [];
  player.weapon.reloadTicksRemaining = definition.reloadTicks;
  return [{ type: 'weaponReloadStarted', playerId: player.id, weaponId: definition.id, reloadTicks: definition.reloadTicks }];
}

function completeReload(player: PlayerState): WeaponEvent[] {
  const definition = WEAPON_DEFINITIONS[player.weapon.weaponId];
  if (!definition) return [];
  const missing = Math.max(0, definition.magazineSize - player.weapon.magazineAmmo);
  const loaded = Math.min(missing, player.weapon.reserveAmmo);
  player.weapon.magazineAmmo += loaded;
  player.weapon.reserveAmmo -= loaded;
  return [{ type: 'weaponReloadCompleted', playerId: player.id, weaponId: definition.id, loaded,
    magazineAmmo: player.weapon.magazineAmmo, reserveAmmo: player.weapon.reserveAmmo }];
}

export function tickWeaponState(player: PlayerState): WeaponEvent[] {
  if (player.switchTicksRemaining > 0) player.switchTicksRemaining -= 1;
  if (player.holsteredWeapon) tickWeaponCooldown(player.holsteredWeapon);
  const state = player.weapon;
  if (state.cooldownTicks > 0) state.cooldownTicks -= 1;
  if (state.reloadTicksRemaining <= 0) return [];
  state.reloadTicksRemaining -= 1;
  if (state.reloadTicksRemaining > 0) return [];
  return completeReload(player);
}

export function tickWeaponCooldown(state: WeaponState): void {
  if (state.cooldownTicks > 0) state.cooldownTicks -= 1;
}

export function wantsToFire(player: PlayerState, pressed: boolean, held: boolean): boolean {
  const definition = WEAPON_DEFINITIONS[player.weapon.weaponId];
  if (!definition) return false;
  // A click shorter than one fixed tick still fires once on an automatic gun.
  return definition.trigger === 'semi' ? pressed : held || pressed;
}

export function firePlayerWeapon(
  player: PlayerState,
  ray: HitscanRay,
  zombies: readonly ZombieState[],
  worldBoxes: readonly CollisionBox[],
  instaKill = false,
  spreadSeed = 0,
): WeaponEvent[] {
  const definition = WEAPON_DEFINITIONS[player.weapon.weaponId];
  if (!definition || player.weapon.cooldownTicks > 0 || !player.alive) return [];
  if (player.switchTicksRemaining > 0 || player.meleeCooldownTicks > 0 || player.weapon.reloadTicksRemaining > 0 || player.weapon.magazineAmmo <= 0) return [];
  player.weapon.magazineAmmo -= 1;
  player.weapon.cooldownTicks = definition.fireIntervalTicks;
  const events: WeaponEvent[] = [{ type: 'weaponFired', playerId: player.id, weaponId: definition.id }];
  const seed = spreadSeed ^ Math.imul(Number(player.id.slice(2)), 0x9e3779b9);
  const shotRay = spreadHitscanRay(ray, definition.hipSpreadRadians * (player.aiming ? 0.1 : 1), seed);
  const hit = resolveHitscan(shotRay, zombies, worldBoxes, definition.range);
  if (hit.kind !== 'zombie') return events;

  const zombie = zombies.find((candidate) => candidate.id === hit.zombieId && candidate.alive);
  if (!zombie) return events;
  const applied = Math.min(zombie.health, instaKill ? zombie.health
    : definition.damage * (hit.hitZone === 'head' ? 3 : 1));
  zombie.health -= applied;
  events.push({
    type: 'weaponHit', playerId: player.id, weaponId: definition.id,
    zombieId: zombie.id, damage: applied, distance: hit.distance, hitZone: hit.hitZone,
  });
  events.push({ type: 'zombieDamaged', zombieId: zombie.id, playerId: player.id, damage: applied, health: zombie.health });
  if (zombie.health === 0) {
    zombie.alive = false;
    zombie.velocity = { x: 0, y: 0, z: 0 };
    events.push({ type: 'zombieDied', zombieId: zombie.id, playerId: player.id, method: hit.hitZone });
  }
  return events;
}

export const MELEE_RULES = { damage: 150, range: 1.6, cooldownTicks: 48, minFacingDot: 0.65 } as const;

export function meleeAttack(player: PlayerState, zombies: readonly ZombieState[], boxes: readonly CollisionBox[],
  instaKill = false): WeaponEvent[] {
  if (!player.alive || player.meleeCooldownTicks > 0) return [];
  player.meleeCooldownTicks = MELEE_RULES.cooldownTicks;
  player.weapon.reloadTicksRemaining = 0;
  const events: WeaponEvent[] = [{ type: 'meleeSwung', playerId: player.id }];
  const ray = rayFromPlayer(player, 1.3);
  const candidates = zombies.filter(zombie => zombie.alive).map(zombie => {
    const offset = { x: zombie.position.x - ray.origin.x, y: zombie.position.y + 1.1 - ray.origin.y,
      z: zombie.position.z - ray.origin.z };
    const distance = Math.hypot(offset.x, offset.y, offset.z);
    const direction = distance > 0 ? normalize(offset) : ray.direction;
    const facing = direction.x * ray.direction.x + direction.y * ray.direction.y + direction.z * ray.direction.z;
    const blocked = nearestWorldDistance({ origin: ray.origin, direction }, boxes, distance);
    return { zombie, distance, facing, blocked };
  }).filter(hit => hit.distance <= MELEE_RULES.range && hit.facing >= MELEE_RULES.minFacingDot && hit.blocked === null)
    .sort((a, b) => a.distance - b.distance || a.zombie.id.localeCompare(b.zombie.id));
  const zombie = candidates[0]?.zombie;
  if (!zombie) return events;
  const damage = Math.min(zombie.health, instaKill ? zombie.health : MELEE_RULES.damage);
  zombie.health -= damage;
  events.push({ type: 'meleeHit', playerId: player.id, zombieId: zombie.id, damage },
    { type: 'zombieDamaged', playerId: player.id, zombieId: zombie.id, damage, health: zombie.health });
  if (zombie.health === 0) {
    zombie.alive = false; zombie.velocity = { x: 0, y: 0, z: 0 };
    events.push({ type: 'zombieDied', playerId: player.id, zombieId: zombie.id, method: 'melee' });
  }
  return events;
}
