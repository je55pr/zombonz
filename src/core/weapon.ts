import type { CollisionBox } from './collision.ts';
import type { EntityId, PlayerState, Vec3, WeaponState, ZombieState } from './types.ts';
import { SeededRng } from './rng.ts';
import { damagePlayer, type DamageEvent } from './health.ts';

export interface WeaponDefinition {
  id: string;
  /** Name shown on the HUD, wall chalk and box. */
  name: string;
  damage: number;
  range: number;
  fireIntervalTicks: number;
  trigger: 'semi' | 'auto';
  magazineSize: number;
  startingReserveAmmo: number;
  reloadTicks: number;
  hipSpreadRadians: number;
  /** Aiming scales hip spread by this (default 0.1); shotguns tighten far less. */
  aimSpreadMultiplier?: number;
  /** Rays per shot; shotgun pellets each deal `damage`, totalled per zombie. */
  pellets?: number;
  /** Impact burst: hurts zombies and the shooter within `radius`, falling off with distance. */
  explosive?: { radius: number; damage: number; selfDamage: number };
  /** Arcs from the first zombie hit to the nearest others, losing `falloff` of its damage per jump. */
  chain?: { targets: number; radius: number; falloff: number };
  /** Damage multipliers per hit zone; missing zones use DEFAULT_HIT_ZONE_MULTIPLIERS. */
  hitZoneMultipliers?: Partial<Record<HitZoneId, number>>;
}

export type HitZoneId = 'head' | 'body';

export interface HitZone {
  id: HitZoneId;
  /** Lowest impact height that counts, as a fraction of the zombie's current height. */
  minHeightFraction: number;
}

/** Checked top-down; an impact below every zone falls back to FALLBACK_HIT_ZONE. */
export const ZOMBIE_HIT_ZONES: readonly HitZone[] = [{ id: 'head', minHeightFraction: 1.42 / 1.72 }];
export const FALLBACK_HIT_ZONE: HitZoneId = 'body';
export const DEFAULT_HIT_ZONE_MULTIPLIERS: Readonly<Record<HitZoneId, number>> = { head: 3, body: 1 };

export function hitZoneMultiplier(definition: WeaponDefinition, zone: HitZoneId): number {
  return definition.hitZoneMultipliers?.[zone] ?? DEFAULT_HIT_ZONE_MULTIPLIERS[zone];
}

// Stats are WaW-inspired approximations tuned to this game's 60 Hz ticks, not datamined values.
export const WEAPON_DEFINITIONS: Readonly<Record<string, WeaponDefinition>> = {
  'starter-pistol': {
    id: 'starter-pistol', name: 'M1911', damage: 50, range: 60, fireIntervalTicks: 12, trigger: 'semi',
    magazineSize: 8, startingReserveAmmo: 32, reloadTicks: 90, hipSpreadRadians: 0.008,
  },
  kar98k: {
    id: 'kar98k', name: 'Kar98k', damage: 100, range: 80, fireIntervalTicks: 45, trigger: 'semi',
    magazineSize: 5, startingReserveAmmo: 50, reloadTicks: 120, hipSpreadRadians: 0.015,
    // WaW: one headshot kills through round 3 (350 health) but not round 4 (450).
    hitZoneMultipliers: { head: 4 },
  },
  springfield: {
    id: 'springfield', name: 'Springfield', damage: 100, range: 80, fireIntervalTicks: 50, trigger: 'semi',
    magazineSize: 5, startingReserveAmmo: 50, reloadTicks: 135, hipSpreadRadians: 0.015,
    hitZoneMultipliers: { head: 4 },
  },
  mosin: {
    id: 'mosin', name: 'Mosin-Nagant', damage: 110, range: 80, fireIntervalTicks: 55, trigger: 'semi',
    magazineSize: 5, startingReserveAmmo: 50, reloadTicks: 140, hipSpreadRadians: 0.015,
    hitZoneMultipliers: { head: 4 },
  },
  'm1-garand': {
    id: 'm1-garand', name: 'M1 Garand', damage: 105, range: 80, fireIntervalTicks: 9, trigger: 'semi',
    magazineSize: 8, startingReserveAmmo: 128, reloadTicks: 150, hipSpreadRadians: 0.014,
  },
  thompson: {
    id: 'thompson', name: 'Thompson', damage: 65, range: 60, fireIntervalTicks: 6, trigger: 'auto',
    magazineSize: 20, startingReserveAmmo: 160, reloadTicks: 120, hipSpreadRadians: 0.03,
  },
  mp40: {
    id: 'mp40', name: 'MP40', damage: 75, range: 65, fireIntervalTicks: 8, trigger: 'auto',
    magazineSize: 32, startingReserveAmmo: 192, reloadTicks: 138, hipSpreadRadians: 0.027,
  },
  ppsh41: {
    id: 'ppsh41', name: 'PPSh-41', damage: 70, range: 60, fireIntervalTicks: 4, trigger: 'auto',
    magazineSize: 71, startingReserveAmmo: 284, reloadTicks: 210, hipSpreadRadians: 0.035,
  },
  'm1-carbine': {
    id: 'm1-carbine', name: 'M1A1 Carbine', damage: 120, range: 70, fireIntervalTicks: 8, trigger: 'semi',
    magazineSize: 15, startingReserveAmmo: 120, reloadTicks: 150, hipSpreadRadians: 0.016,
  },
  m14: {
    id: 'm14', name: 'M14', damage: 105, range: 80, fireIntervalTicks: 8, trigger: 'semi',
    magazineSize: 8, startingReserveAmmo: 96, reloadTicks: 150, hipSpreadRadians: 0.014,
  },
  fal: {
    id: 'fal', name: 'FN FAL', damage: 130, range: 80, fireIntervalTicks: 7, trigger: 'semi',
    magazineSize: 20, startingReserveAmmo: 180, reloadTicks: 165, hipSpreadRadians: 0.016,
  },
  stg44: {
    id: 'stg44', name: 'STG-44', damage: 100, range: 70, fireIntervalTicks: 7, trigger: 'auto',
    magazineSize: 30, startingReserveAmmo: 180, reloadTicks: 150, hipSpreadRadians: 0.03,
  },
  fg42: {
    id: 'fg42', name: 'FG42', damage: 110, range: 75, fireIntervalTicks: 5, trigger: 'auto',
    magazineSize: 20, startingReserveAmmo: 240, reloadTicks: 180, hipSpreadRadians: 0.035,
  },
  commando: {
    id: 'commando', name: 'Commando', damage: 100, range: 70, fireIntervalTicks: 5, trigger: 'auto',
    magazineSize: 30, startingReserveAmmo: 270, reloadTicks: 150, hipSpreadRadians: 0.028,
  },
  ak74u: {
    id: 'ak74u', name: 'AK-74u', damage: 100, range: 60, fireIntervalTicks: 5, trigger: 'auto',
    magazineSize: 20, startingReserveAmmo: 160, reloadTicks: 150, hipSpreadRadians: 0.03,
  },
  mp5k: {
    id: 'mp5k', name: 'MP5K', damage: 80, range: 55, fireIntervalTicks: 4, trigger: 'auto',
    magazineSize: 30, startingReserveAmmo: 120, reloadTicks: 150, hipSpreadRadians: 0.03,
  },
  skorpion: {
    id: 'skorpion', name: 'Skorpion', damage: 60, range: 50, fireIntervalTicks: 4, trigger: 'auto',
    magazineSize: 20, startingReserveAmmo: 200, reloadTicks: 120, hipSpreadRadians: 0.035,
  },
  'magnum-357': {
    id: 'magnum-357', name: '.357 Magnum', damage: 240, range: 60, fireIntervalTicks: 18, trigger: 'semi',
    magazineSize: 6, startingReserveAmmo: 48, reloadTicks: 180, hipSpreadRadians: 0.012,
  },
  python: {
    id: 'python', name: 'Python', damage: 200, range: 60, fireIntervalTicks: 18, trigger: 'semi',
    magazineSize: 6, startingReserveAmmo: 84, reloadTicks: 180, hipSpreadRadians: 0.012,
  },
  rpk: {
    id: 'rpk', name: 'RPK', damage: 110, range: 80, fireIntervalTicks: 5, trigger: 'auto',
    magazineSize: 100, startingReserveAmmo: 400, reloadTicks: 330, hipSpreadRadians: 0.045,
  },
  bar: {
    id: 'bar', name: 'BAR', damage: 125, range: 80, fireIntervalTicks: 10, trigger: 'auto',
    magazineSize: 20, startingReserveAmmo: 140, reloadTicks: 150, hipSpreadRadians: 0.035,
  },
  mg42: {
    id: 'mg42', name: 'MG42', damage: 120, range: 90, fireIntervalTicks: 3, trigger: 'auto',
    magazineSize: 125, startingReserveAmmo: 500, reloadTicks: 360, hipSpreadRadians: 0.045,
  },
  'double-barrel': {
    id: 'double-barrel', name: 'Double-Barreled Shotgun', damage: 80, range: 22, fireIntervalTicks: 14,
    trigger: 'semi', magazineSize: 2, startingReserveAmmo: 60, reloadTicks: 165, hipSpreadRadians: 0.06,
    aimSpreadMultiplier: 0.6, pellets: 8, hitZoneMultipliers: { head: 1.5 },
  },
  'trench-gun': {
    id: 'trench-gun', name: 'M1897 Trench Gun', damage: 75, range: 22, fireIntervalTicks: 48,
    trigger: 'semi', magazineSize: 6, startingReserveAmmo: 60, reloadTicks: 240, hipSpreadRadians: 0.055,
    aimSpreadMultiplier: 0.6, pellets: 8, hitZoneMultipliers: { head: 1.5 },
  },
  spas12: {
    id: 'spas12', name: 'SPAS-12', damage: 70, range: 22, fireIntervalTicks: 18,
    trigger: 'semi', magazineSize: 8, startingReserveAmmo: 32, reloadTicks: 270, hipSpreadRadians: 0.06,
    aimSpreadMultiplier: 0.6, pellets: 8, hitZoneMultipliers: { head: 1.5 },
  },
  ithaca37: {
    id: 'ithaca37', name: 'Stakeout', damage: 85, range: 22, fireIntervalTicks: 45,
    trigger: 'semi', magazineSize: 6, startingReserveAmmo: 60, reloadTicks: 240, hipSpreadRadians: 0.055,
    aimSpreadMultiplier: 0.6, pellets: 8, hitZoneMultipliers: { head: 1.5 },
  },
  rpg7: {
    id: 'rpg7', name: 'RPG-7', damage: 1500, range: 90, fireIntervalTicks: 30, trigger: 'semi',
    magazineSize: 1, startingReserveAmmo: 4, reloadTicks: 150, hipSpreadRadians: 0.01,
    explosive: { radius: 4, damage: 2500, selfDamage: 75 },
  },
  // Original wonder weapons in the Ray Gun / Wunderwaffe roles; rare box rewards only.
  irrlicht: {
    id: 'irrlicht', name: 'Irrlicht', damage: 1000, range: 70, fireIntervalTicks: 20, trigger: 'semi',
    magazineSize: 20, startingReserveAmmo: 160, reloadTicks: 180, hipSpreadRadians: 0.01,
    explosive: { radius: 2.2, damage: 350, selfDamage: 35 },
  },
  molniya: {
    id: 'molniya', name: 'Molniya', damage: 1200, range: 50, fireIntervalTicks: 40, trigger: 'semi',
    magazineSize: 6, startingReserveAmmo: 42, reloadTicks: 200, hipSpreadRadians: 0.005,
    chain: { targets: 5, radius: 4, falloff: 0.15 },
  },
};

export function weaponName(id: string): string {
  return WEAPON_DEFINITIONS[id]?.name ?? id.toUpperCase();
}

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
  | { kind: 'zombie'; distance: number; zombieId: EntityId; hitZone: HitZoneId }
  | { kind: 'none'; distance: number };

export type WeaponEvent =
  | { type: 'weaponSwitched'; playerId: EntityId; weaponId: string }
  | { type: 'weaponFired'; playerId: EntityId; weaponId: string }
  | { type: 'weaponReloadStarted'; playerId: EntityId; weaponId: string; reloadTicks: number }
  | { type: 'weaponReloadCompleted'; playerId: EntityId; weaponId: string; loaded: number; magazineAmmo: number; reserveAmmo: number }
  | { type: 'weaponHit'; playerId: EntityId; weaponId: string; zombieId: EntityId; damage: number; distance: number; hitZone?: HitZoneId }
  | { type: 'meleeSwung'; playerId: EntityId }
  | { type: 'meleeHit'; playerId: EntityId; zombieId: EntityId; damage: number }
  | { type: 'grenadeHit'; playerId: EntityId; zombieId: EntityId; damage: number }
  | { type: 'weaponExploded'; playerId: EntityId; weaponId: string; position: Vec3; radius: number }
  | { type: 'weaponChained'; playerId: EntityId; weaponId: string; points: Vec3[] }
  | { type: 'zombieDamaged'; zombieId: EntityId; playerId: EntityId; damage: number; health: number }
  | { type: 'zombieDied'; zombieId: EntityId; playerId: EntityId; method?: HitZoneId | 'melee' };

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
    const height = 1.72 * (zombie.entry?.phase === 'vaulting' ? 0.85 : 1);
    const impactY = ray.origin.y + ray.direction.y * bestZombie.distance - zombie.position.y;
    const zone = ZOMBIE_HIT_ZONES.find(zone => impactY >= zone.minHeightFraction * height);
    return { kind: 'zombie', ...bestZombie, hitZone: zone?.id ?? FALLBACK_HIT_ZONE };
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

function chest(position: Vec3): Vec3 {
  return { x: position.x, y: position.y + 0.9, z: position.z };
}

function clearLine(from: Vec3, to: Vec3, boxes: readonly CollisionBox[]): boolean {
  const distance = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
  if (distance < 0.001) return true;
  const direction = { x: (to.x - from.x) / distance, y: (to.y - from.y) / distance, z: (to.z - from.z) / distance };
  return boxes.every(box => rayAabbDistance({ origin: from, direction }, box.min, box.max, distance - 0.01) === null);
}

function damageZombie(events: Array<WeaponEvent | DamageEvent>, player: PlayerState, weaponId: string,
  zombie: ZombieState, damage: number, distance: number, instaKill: boolean): void {
  const applied = Math.min(zombie.health, instaKill ? zombie.health : Math.round(damage));
  if (applied <= 0) return;
  zombie.health -= applied;
  events.push({ type: 'weaponHit', playerId: player.id, weaponId, zombieId: zombie.id, damage: applied, distance, hitZone: 'body' },
    { type: 'zombieDamaged', zombieId: zombie.id, playerId: player.id, damage: applied, health: zombie.health });
  if (zombie.health === 0) {
    zombie.alive = false; zombie.velocity = { x: 0, y: 0, z: 0 };
    events.push({ type: 'zombieDied', zombieId: zombie.id, playerId: player.id, method: 'body' });
  }
}

/** Splash around an impact (a directly struck zombie takes it too); walls block it, and it hurts a close shooter. */
function explodeAt(events: Array<WeaponEvent | DamageEvent>, player: PlayerState, definition: WeaponDefinition,
  impact: Vec3, zombies: readonly ZombieState[], boxes: readonly CollisionBox[], instaKill: boolean): void {
  const blast = definition.explosive!;
  events.push({ type: 'weaponExploded', playerId: player.id, weaponId: definition.id, position: { ...impact }, radius: blast.radius });
  for (const zombie of zombies) {
    if (!zombie.alive) continue;
    const target = chest(zombie.position);
    const distance = Math.hypot(target.x - impact.x, target.y - impact.y, target.z - impact.z);
    if (distance >= blast.radius || !clearLine(impact, target, boxes)) continue;
    damageZombie(events, player, definition.id, zombie, blast.damage * (1 - distance / blast.radius), distance, instaKill);
  }
  const self = chest(player.position);
  const selfDistance = Math.hypot(self.x - impact.x, self.y - impact.y, self.z - impact.z);
  if (selfDistance < blast.radius && clearLine(impact, self, boxes)) {
    events.push(...damagePlayer(player, Math.round(blast.selfDamage * (1 - selfDistance / blast.radius))));
  }
}

/** Jumps from zombie to nearest zombie in line of sight, weakening each time. */
function chainFrom(events: Array<WeaponEvent | DamageEvent>, player: PlayerState, definition: WeaponDefinition,
  origin: Vec3, first: ZombieState, zombies: readonly ZombieState[], boxes: readonly CollisionBox[], instaKill: boolean): void {
  const chain = definition.chain!;
  const struck = new Set<EntityId>([first.id]);
  const points = [{ ...origin }, chest(first.position)];
  let from = first, damage = definition.damage * (1 - chain.falloff);
  for (let jump = 1; jump < chain.targets; jump += 1) {
    const here = chest(from.position);
    const next = zombies.filter(zombie => zombie.alive && !struck.has(zombie.id)).map(zombie => {
      const target = chest(zombie.position);
      return { zombie, target, distance: Math.hypot(target.x - here.x, target.y - here.y, target.z - here.z) };
    }).filter(candidate => candidate.distance <= chain.radius && clearLine(here, candidate.target, boxes))
      .sort((a, b) => a.distance - b.distance || a.zombie.id.localeCompare(b.zombie.id))[0];
    if (!next) break;
    struck.add(next.zombie.id); points.push(next.target);
    damageZombie(events, player, definition.id, next.zombie, damage, next.distance, instaKill);
    from = next.zombie; damage *= 1 - chain.falloff;
  }
  events.push({ type: 'weaponChained', playerId: player.id, weaponId: definition.id, points });
}

export function firePlayerWeapon(
  player: PlayerState,
  ray: HitscanRay,
  zombies: readonly ZombieState[],
  worldBoxes: readonly CollisionBox[],
  instaKill = false,
  spreadSeed = 0,
): Array<WeaponEvent | DamageEvent> {
  const definition = WEAPON_DEFINITIONS[player.weapon.weaponId];
  if (!definition || player.weapon.cooldownTicks > 0 || !player.alive) return [];
  if (player.switchTicksRemaining > 0 || player.meleeCooldownTicks > 0 || player.weapon.reloadTicksRemaining > 0 || player.weapon.magazineAmmo <= 0) return [];
  player.weapon.magazineAmmo -= 1;
  player.weapon.cooldownTicks = definition.fireIntervalTicks;
  const events: Array<WeaponEvent | DamageEvent> = [{ type: 'weaponFired', playerId: player.id, weaponId: definition.id }];
  if (player.weapon.magazineAmmo === 0) events.push(...beginReload(player));
  const seed = spreadSeed ^ Math.imul(Number(player.id.slice(2)), 0x9e3779b9);
  const spread = definition.hipSpreadRadians * (player.aiming ? definition.aimSpreadMultiplier ?? 0.1 : 1);
  // Pellets resolve against the pre-shot state, then each zombie takes one combined hit.
  const hits = new Map<EntityId, { damage: number; distance: number; hitZone: HitZoneId }>();
  let first: { ray: HitscanRay; hit: HitscanTarget } | null = null;
  for (let pellet = 0; pellet < (definition.pellets ?? 1); pellet += 1) {
    const pelletSeed = pellet === 0 ? seed : seed ^ Math.imul(pellet, 0x85ebca6b);
    const pelletRay = spreadHitscanRay(ray, spread, pelletSeed);
    const hit = resolveHitscan(pelletRay, zombies, worldBoxes, definition.range);
    first ??= { ray: pelletRay, hit };
    if (hit.kind !== 'zombie') continue;
    const total = hits.get(hit.zombieId) ?? { damage: 0, distance: hit.distance, hitZone: hit.hitZone };
    total.damage += definition.damage * hitZoneMultiplier(definition, hit.hitZone);
    total.distance = Math.min(total.distance, hit.distance);
    if (hit.hitZone === 'head') total.hitZone = 'head';
    hits.set(hit.zombieId, total);
  }
  for (const [zombieId, hit] of hits) {
    const zombie = zombies.find((candidate) => candidate.id === zombieId && candidate.alive);
    if (!zombie) continue;
    const applied = Math.min(zombie.health, instaKill ? zombie.health : hit.damage);
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
  }
  if (first && definition.chain && first.hit.kind === 'zombie') {
    const struck = zombies.find(zombie => zombie.id === (first!.hit as { zombieId: EntityId }).zombieId)!;
    chainFrom(events, player, definition, first.ray.origin, struck, zombies, worldBoxes, instaKill);
  }
  if (first && definition.explosive && first.hit.kind !== 'none') {
    // Burst just in front of the surface or zombie that stopped the shot.
    const distance = Math.max(0, first.hit.distance - 0.05), { origin, direction } = first.ray;
    const impact = { x: origin.x + direction.x * distance, y: origin.y + direction.y * distance, z: origin.z + direction.z * distance };
    explodeAt(events, player, definition, impact, zombies, worldBoxes, instaKill);
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
