import type { CollisionBox } from './collision.ts';
import type { EntityId, PlayerState, Vec3, WeaponState, ZombieState } from './types.ts';

export interface WeaponDefinition {
  id: string;
  damage: number;
  range: number;
  fireIntervalTicks: number;
  trigger: 'semi' | 'auto';
  magazineSize: number;
  startingReserveAmmo: number;
  reloadTicks: number;
}

export const WEAPON_DEFINITIONS: Readonly<Record<string, WeaponDefinition>> = {
  'starter-pistol': {
    id: 'starter-pistol', damage: 50, range: 60, fireIntervalTicks: 12, trigger: 'semi',
    magazineSize: 8, startingReserveAmmo: 32, reloadTicks: 90,
  },
  kar98k: {
    id: 'kar98k', damage: 100, range: 80, fireIntervalTicks: 45, trigger: 'semi',
    magazineSize: 5, startingReserveAmmo: 50, reloadTicks: 120,
  },
  thompson: {
    id: 'thompson', damage: 65, range: 60, fireIntervalTicks: 6, trigger: 'auto',
    magazineSize: 20, startingReserveAmmo: 160, reloadTicks: 120,
  },
  mp40: {
    id: 'mp40', damage: 75, range: 65, fireIntervalTicks: 8, trigger: 'auto',
    magazineSize: 32, startingReserveAmmo: 192, reloadTicks: 138,
  },
  bar: {
    id: 'bar', damage: 125, range: 80, fireIntervalTicks: 10, trigger: 'auto',
    magazineSize: 20, startingReserveAmmo: 140, reloadTicks: 150,
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
export interface HitscanRay {
  origin: Vec3;
  direction: Vec3;
}

export type HitscanTarget =
  | { kind: 'world'; distance: number }
  | { kind: 'zombie'; distance: number; zombieId: EntityId }
  | { kind: 'none'; distance: number };

export type WeaponEvent =
  | { type: 'weaponFired'; playerId: EntityId; weaponId: string }
  | { type: 'weaponReloadStarted'; playerId: EntityId; weaponId: string; reloadTicks: number }
  | { type: 'weaponReloadCompleted'; playerId: EntityId; weaponId: string; loaded: number; magazineAmmo: number; reserveAmmo: number }
  | { type: 'weaponHit'; playerId: EntityId; weaponId: string; zombieId: EntityId; damage: number; distance: number }
  | { type: 'zombieDamaged'; zombieId: EntityId; playerId: EntityId; damage: number; health: number }
  | { type: 'zombieDied'; zombieId: EntityId; playerId: EntityId };

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
  if (bestZombie) return { kind: 'zombie', ...bestZombie };
  if (worldDistance !== null) return { kind: 'world', distance: worldDistance };
  return { kind: 'none', distance: range };
}
export function beginReload(player: PlayerState): WeaponEvent[] {
  const definition = WEAPON_DEFINITIONS[player.weapon.weaponId];
  if (!definition || !player.alive) return [];
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
): WeaponEvent[] {
  const definition = WEAPON_DEFINITIONS[player.weapon.weaponId];
  if (!definition || player.weapon.cooldownTicks > 0 || !player.alive) return [];
  if (player.weapon.reloadTicksRemaining > 0 || player.weapon.magazineAmmo <= 0) return [];
  player.weapon.magazineAmmo -= 1;
  player.weapon.cooldownTicks = definition.fireIntervalTicks;
  const events: WeaponEvent[] = [{ type: 'weaponFired', playerId: player.id, weaponId: definition.id }];
  const hit = resolveHitscan(ray, zombies, worldBoxes, definition.range);
  if (hit.kind !== 'zombie') return events;

  const zombie = zombies.find((candidate) => candidate.id === hit.zombieId && candidate.alive);
  if (!zombie) return events;
  const applied = Math.min(zombie.health, definition.damage);
  zombie.health -= applied;
  events.push({
    type: 'weaponHit', playerId: player.id, weaponId: definition.id,
    zombieId: zombie.id, damage: applied, distance: hit.distance,
  });
  events.push({ type: 'zombieDamaged', zombieId: zombie.id, playerId: player.id, damage: applied, health: zombie.health });
  if (zombie.health === 0) {
    zombie.alive = false;
    zombie.velocity = { x: 0, y: 0, z: 0 };
    events.push({ type: 'zombieDied', zombieId: zombie.id, playerId: player.id });
  }
  return events;
}
