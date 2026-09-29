import type { CollisionBox } from './collision.ts';
import { hasPerk, PERK_RULES } from './perks.ts';
import type { EntityId, PlayerState, Vec3, WeaponState, ZombieState } from './types.ts';
import { SeededRng } from './rng.ts';
import { damagePlayer, type DamageEvent } from './health.ts';
import { PLAYER_MOVEMENT } from './player.ts';
import { blastPlayers, blastZombies } from './blast.ts';
import { blastHazards, damageHazard, type HazardEvent, type HazardTarget } from './hazard.ts';
import { clearLine, rayAabbDistance } from './ray.ts';
import { rayZombieBody, zombieChest, type BodyPart } from './zombieBody.ts';
export { rayAabbDistance } from './ray.ts';

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
  /** Half-angle of the cone shots land in when fired from the hip, standing still, before the cone widens with movement and bloom. */
  hipSpreadRadians: number;
  /** Aiming scales the spread by this (default DEFAULT_AIM_SPREAD); shotguns tighten far less. */
  aimSpreadMultiplier?: number;
  /** Rays per shot; shotgun pellets each deal `damage`, totalled per zombie. */
  pellets?: number;
  /** Ordered zombie hits per bullet and the damage fraction retained after each body. Geometry stops it. */
  penetration?: { maxTargets: number; damageRetention: number };
  /** Impact burst: hurts zombies and the shooter within `radius`, falling off with distance. */
  explosive?: { radius: number; damage: number; selfDamage: number };
  /** Arcs from the first zombie hit to the nearest others, losing `falloff` of its damage per jump. */
  chain?: { targets: number; radius: number; falloff: number };
  /** Damage multipliers per hit zone; missing zones use DEFAULT_HIT_ZONE_MULTIPLIERS. */
  hitZoneMultipliers?: Partial<Record<HitZoneId, number>>;
}

export type HitZoneId = 'head' | 'body';

/** A hit on the head is a headshot; a hit on anything else (torso, arms, legs) is a body shot. */
export function hitZoneOf(part: BodyPart): HitZoneId { return part === 'head' ? 'head' : 'body'; }
/**
 * A headshot is worth twice a body shot unless the gun says otherwise. The pistol's 50 damage kills a round-1
 * zombie (150 health) in three body shots, as in the Nazi Zombies wiki, and so in two headshots rather than one;
 * bolt-action rifles and shotguns override this below. Zombie mode's own multipliers are not in the scripts we can
 * read (multiplayer's is 1.4 for pistols, SMGs and rifles), so this is a balance choice: see docs/combat.md.
 */
export const DEFAULT_HIT_ZONE_MULTIPLIERS: Readonly<Record<HitZoneId, number>> = { head: 2, body: 1 };

export function hitZoneMultiplier(definition: WeaponDefinition, zone: HitZoneId): number {
  return definition.hitZoneMultipliers?.[zone] ?? DEFAULT_HIT_ZONE_MULTIPLIERS[zone];
}

// Hip spread is the largest single cause of missed shots at range: a hip-fired pistol is about 2.6 degrees (0.9 m at
// 20 m, so a distant head is a matter of luck), sub-machine guns 3 to 4, rifles 2.5 to 3, machine guns 4 to 5, and
// aiming tightens each to a tenth or so. Shotguns keep their pellet cone.
// Stats are WaW-inspired approximations tuned to this game's 60 Hz ticks. Penetration tiers follow
// the small/medium/large penetrateType fields in the WaW/BO1 weapon files; counts and retention are
// explicit balance choices because those files do not specify a zombie body count or loss per body.
export const WEAPON_DEFINITIONS: Readonly<Record<string, WeaponDefinition>> = {
  'starter-pistol': {
    id: 'starter-pistol', name: 'M1911', damage: 50, range: 60, fireIntervalTicks: 12, trigger: 'semi',
    magazineSize: 8, startingReserveAmmo: 32, reloadTicks: 90, hipSpreadRadians: 0.045,
    penetration: { maxTargets: 2, damageRetention: 0.7 },
  },
  kar98k: {
    id: 'kar98k', name: 'Kar98k', damage: 100, range: 80, fireIntervalTicks: 45, trigger: 'semi',
    magazineSize: 5, startingReserveAmmo: 50, reloadTicks: 120, hipSpreadRadians: 0.05, aimSpreadMultiplier: 0.05,
    // WaW: one headshot kills through round 3 (350 health) but not round 4 (450).
    hitZoneMultipliers: { head: 4 }, penetration: { maxTargets: 3, damageRetention: 0.8 },
  },
  springfield: {
    id: 'springfield', name: 'Springfield', damage: 100, range: 80, fireIntervalTicks: 50, trigger: 'semi',
    magazineSize: 5, startingReserveAmmo: 50, reloadTicks: 135, hipSpreadRadians: 0.05, aimSpreadMultiplier: 0.05,
    hitZoneMultipliers: { head: 4 }, penetration: { maxTargets: 3, damageRetention: 0.8 },
  },
  mosin: {
    id: 'mosin', name: 'Mosin-Nagant', damage: 110, range: 80, fireIntervalTicks: 55, trigger: 'semi',
    magazineSize: 5, startingReserveAmmo: 50, reloadTicks: 140, hipSpreadRadians: 0.05, aimSpreadMultiplier: 0.05,
    hitZoneMultipliers: { head: 4 }, penetration: { maxTargets: 3, damageRetention: 0.8 },
  },
  'm1-garand': {
    id: 'm1-garand', name: 'M1 Garand', damage: 105, range: 80, fireIntervalTicks: 9, trigger: 'semi',
    magazineSize: 8, startingReserveAmmo: 128, reloadTicks: 150, hipSpreadRadians: 0.04,
    penetration: { maxTargets: 3, damageRetention: 0.8 },
  },
  thompson: {
    id: 'thompson', name: 'Thompson', damage: 65, range: 60, fireIntervalTicks: 6, trigger: 'auto',
    magazineSize: 20, startingReserveAmmo: 160, reloadTicks: 120, hipSpreadRadians: 0.06,
    penetration: { maxTargets: 3, damageRetention: 0.8 },
  },
  mp40: {
    id: 'mp40', name: 'MP40', damage: 75, range: 65, fireIntervalTicks: 8, trigger: 'auto',
    magazineSize: 32, startingReserveAmmo: 192, reloadTicks: 138, hipSpreadRadians: 0.055,
    penetration: { maxTargets: 2, damageRetention: 0.7 },
  },
  ppsh41: {
    id: 'ppsh41', name: 'PPSh-41', damage: 70, range: 60, fireIntervalTicks: 4, trigger: 'auto',
    magazineSize: 71, startingReserveAmmo: 284, reloadTicks: 210, hipSpreadRadians: 0.07,
    penetration: { maxTargets: 2, damageRetention: 0.7 },
  },
  'm1-carbine': {
    id: 'm1-carbine', name: 'M1A1 Carbine', damage: 120, range: 70, fireIntervalTicks: 8, trigger: 'semi',
    magazineSize: 15, startingReserveAmmo: 120, reloadTicks: 150, hipSpreadRadians: 0.04,
    penetration: { maxTargets: 3, damageRetention: 0.8 },
  },
  m14: {
    id: 'm14', name: 'M14', damage: 105, range: 80, fireIntervalTicks: 8, trigger: 'semi',
    magazineSize: 8, startingReserveAmmo: 96, reloadTicks: 150, hipSpreadRadians: 0.04,
    penetration: { maxTargets: 4, damageRetention: 0.85 },
  },
  fal: {
    id: 'fal', name: 'FN FAL', damage: 130, range: 80, fireIntervalTicks: 7, trigger: 'semi',
    magazineSize: 20, startingReserveAmmo: 180, reloadTicks: 165, hipSpreadRadians: 0.04,
    penetration: { maxTargets: 3, damageRetention: 0.8 },
  },
  stg44: {
    id: 'stg44', name: 'STG-44', damage: 100, range: 70, fireIntervalTicks: 7, trigger: 'auto',
    magazineSize: 30, startingReserveAmmo: 180, reloadTicks: 150, hipSpreadRadians: 0.05,
    penetration: { maxTargets: 3, damageRetention: 0.8 },
  },
  fg42: {
    id: 'fg42', name: 'FG42', damage: 110, range: 75, fireIntervalTicks: 5, trigger: 'auto',
    magazineSize: 20, startingReserveAmmo: 240, reloadTicks: 180, hipSpreadRadians: 0.06,
    penetration: { maxTargets: 2, damageRetention: 0.7 },
  },
  commando: {
    id: 'commando', name: 'Commando', damage: 100, range: 70, fireIntervalTicks: 5, trigger: 'auto',
    magazineSize: 30, startingReserveAmmo: 270, reloadTicks: 150, hipSpreadRadians: 0.05,
    penetration: { maxTargets: 3, damageRetention: 0.8 },
  },
  ak74u: {
    id: 'ak74u', name: 'AK-74u', damage: 100, range: 60, fireIntervalTicks: 5, trigger: 'auto',
    magazineSize: 20, startingReserveAmmo: 160, reloadTicks: 150, hipSpreadRadians: 0.06,
    penetration: { maxTargets: 2, damageRetention: 0.7 },
  },
  mp5k: {
    id: 'mp5k', name: 'MP5K', damage: 80, range: 55, fireIntervalTicks: 4, trigger: 'auto',
    magazineSize: 30, startingReserveAmmo: 120, reloadTicks: 150, hipSpreadRadians: 0.06,
    penetration: { maxTargets: 2, damageRetention: 0.7 },
  },
  skorpion: {
    id: 'skorpion', name: 'Skorpion', damage: 60, range: 50, fireIntervalTicks: 4, trigger: 'auto',
    magazineSize: 20, startingReserveAmmo: 200, reloadTicks: 120, hipSpreadRadians: 0.07,
    penetration: { maxTargets: 2, damageRetention: 0.7 },
  },
  'magnum-357': {
    id: 'magnum-357', name: '.357 Magnum', damage: 240, range: 60, fireIntervalTicks: 18, trigger: 'semi',
    magazineSize: 6, startingReserveAmmo: 48, reloadTicks: 180, hipSpreadRadians: 0.04,
    penetration: { maxTargets: 4, damageRetention: 0.85 },
  },
  python: {
    id: 'python', name: 'Python', damage: 200, range: 60, fireIntervalTicks: 18, trigger: 'semi',
    magazineSize: 6, startingReserveAmmo: 84, reloadTicks: 180, hipSpreadRadians: 0.04,
    penetration: { maxTargets: 3, damageRetention: 0.8 },
  },
  rpk: {
    id: 'rpk', name: 'RPK', damage: 110, range: 80, fireIntervalTicks: 5, trigger: 'auto',
    magazineSize: 100, startingReserveAmmo: 400, reloadTicks: 330, hipSpreadRadians: 0.075,
    penetration: { maxTargets: 4, damageRetention: 0.8 },
  },
  bar: {
    id: 'bar', name: 'BAR', damage: 125, range: 80, fireIntervalTicks: 10, trigger: 'auto',
    magazineSize: 20, startingReserveAmmo: 140, reloadTicks: 150, hipSpreadRadians: 0.065,
    penetration: { maxTargets: 3, damageRetention: 0.8 },
  },
  mg42: {
    id: 'mg42', name: 'MG42', damage: 120, range: 90, fireIntervalTicks: 3, trigger: 'auto',
    magazineSize: 125, startingReserveAmmo: 500, reloadTicks: 360, hipSpreadRadians: 0.08,
    penetration: { maxTargets: 4, damageRetention: 0.8 },
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
    magazineSize: 1, startingReserveAmmo: 4, reloadTicks: 150, hipSpreadRadians: 0.02,
    explosive: { radius: 4, damage: 2500, selfDamage: 75 },
  },
  // Original wonder weapons in the Ray Gun / Wunderwaffe roles; rare box rewards only.
  irrlicht: {
    id: 'irrlicht', name: 'Irrlicht', damage: 1000, range: 70, fireIntervalTicks: 20, trigger: 'semi',
    magazineSize: 20, startingReserveAmmo: 160, reloadTicks: 180, hipSpreadRadians: 0.025,
    explosive: { radius: 2.2, damage: 350, selfDamage: 35 },
  },
  molniya: {
    id: 'molniya', name: 'Molniya', damage: 1200, range: 50, fireIntervalTicks: 40, trigger: 'semi',
    magazineSize: 6, startingReserveAmmo: 42, reloadTicks: 200, hipSpreadRadians: 0.02,
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
  | { kind: 'zombie'; distance: number; zombieId: EntityId; hitZone: HitZoneId; part: BodyPart; point: Vec3 }
  | { kind: 'hazard'; distance: number; hazardId: string }
  | { kind: 'none'; distance: number };

export type WeaponEvent =
  | { type: 'weaponSwitched'; playerId: EntityId; weaponId: string }
  | { type: 'weaponFired'; playerId: EntityId; weaponId: string }
  | { type: 'weaponReloadStarted'; playerId: EntityId; weaponId: string; reloadTicks: number }
  | { type: 'weaponReloadCompleted'; playerId: EntityId; weaponId: string; loaded: number; magazineAmmo: number; reserveAmmo: number }
  /** `part`, `point` (where the shot struck) and `direction` (which way it was going) say where and how, for the client's blood. */
  | { type: 'weaponHit'; playerId: EntityId; weaponId: string; zombieId: EntityId; damage: number; distance: number; hitZone?: HitZoneId;
    part?: BodyPart; point?: Vec3; direction?: Vec3 }
  | { type: 'meleeSwung'; playerId: EntityId }
  | { type: 'meleeHit'; playerId: EntityId; zombieId: EntityId; damage: number }
  | { type: 'grenadeHit'; playerId: EntityId; zombieId: EntityId; damage: number }
  | { type: 'weaponExploded'; playerId: EntityId; weaponId: string; position: Vec3; radius: number }
  | { type: 'weaponChained'; playerId: EntityId; weaponId: string; points: Vec3[] }
  | { type: 'zombieDamaged'; zombieId: EntityId; playerId: EntityId; damage: number; health: number }
  | { type: 'zombieDied'; zombieId: EntityId; playerId: EntityId; method?: HitZoneId | 'melee' }
  | HazardEvent;

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

/**
 * Seeded angular variation keeps gameplay repeatable while making ADS useful. Shots land evenly over a disc of
 * half-angle `radians` (the circle the crosshair draws), not a square, so no shot strays farther than the spread.
 */
export function spreadHitscanRay(ray: HitscanRay, radians: number, seed: number): HitscanRay {
  if (radians <= 0) return ray;
  const rng = new SeededRng(seed);
  const angle = rng.next() * Math.PI * 2, reach = Math.sqrt(rng.next()) * radians;
  const yaw = Math.atan2(-ray.direction.x, -ray.direction.z) + Math.cos(angle) * reach;
  const pitch = Math.asin(Math.max(-1, Math.min(1, ray.direction.y))) + Math.sin(angle) * reach;
  const cosPitch = Math.cos(pitch);
  return { origin: ray.origin, direction: normalize({
    x: -Math.sin(yaw) * cosPitch, y: Math.sin(pitch), z: -Math.cos(yaw) * cosPitch,
  }) };
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

function nearestHazardHit(ray: HitscanRay, hazards: readonly HazardTarget[], range: number,
  worldDistance: number | null): { hazardId: string; distance: number } | null {
  let best: { hazardId: string; distance: number } | null = null;
  for (const hazard of hazards) {
    const distance = rayAabbDistance(ray, hazard.box.min, hazard.box.max, range);
    if (distance === null || (worldDistance !== null && distance >= worldDistance)) continue;
    if (!best || distance < best.distance || distance === best.distance && hazard.state.id < best.hazardId) {
      best = { hazardId: hazard.state.id, distance };
    }
  }
  return best;
}

/**
 * What a shot meets first. Hazards (barrels, cars) stop a shot as zombies do, and are hit by it; they are
 * not among `worldBoxes`, which are the walls.
 */
export function resolveHitscan(
  ray: HitscanRay,
  zombies: readonly ZombieState[],
  worldBoxes: readonly CollisionBox[],
  range: number,
  hazards: readonly HazardTarget[] = [],
): HitscanTarget {
  const worldDistance = nearestWorldDistance(ray, worldBoxes, range);
  const bestHazard = nearestHazardHit(ray, hazards, range, worldDistance);
  const targets = resolveHitscanZombies(ray, zombies, worldBoxes, range, hazards);
  if (targets.length) return targets[0];
  if (bestHazard) return { kind: 'hazard', ...bestHazard };
  if (worldDistance !== null) return { kind: 'world', distance: worldDistance };
  return { kind: 'none', distance: range };
}

/** All zombie intersections before the first wall or hazard, in stable ray order. */
export function resolveHitscanZombies(
  ray: HitscanRay,
  zombies: readonly ZombieState[],
  worldBoxes: readonly CollisionBox[],
  range: number,
  hazards: readonly HazardTarget[] = [],
): Array<Extract<HitscanTarget, { kind: 'zombie' }>> {
  const worldDistance = nearestWorldDistance(ray, worldBoxes, range);
  const hazardDistance = nearestHazardHit(ray, hazards, range, worldDistance)?.distance ?? null;
  const hits: Array<Extract<HitscanTarget, { kind: 'zombie' }>> = [];
  for (const zombie of zombies) {
    if (!zombie.alive) continue;
    const hit = rayZombieBody(ray.origin, ray.direction, zombie, range);
    if (hit === null || (worldDistance !== null && hit.distance >= worldDistance)
      || (hazardDistance !== null && hit.distance >= hazardDistance)) continue;
    hits.push({ kind: 'zombie', zombieId: zombie.id, distance: hit.distance, hitZone: hitZoneOf(hit.part), part: hit.part, point: hit.point });
  }
  return hits.sort((a, b) => a.distance - b.distance || a.zombieId.localeCompare(b.zombieId));
}
/** A full reload's length for this player; Speed Cola halves it. */
export function reloadTicksFor(player: PlayerState, definition: WeaponDefinition): number {
  return hasPerk(player, 'speed-cola') ? Math.round(definition.reloadTicks * PERK_RULES.speedColaReload) : definition.reloadTicks;
}

export function beginReload(player: PlayerState): WeaponEvent[] {
  const definition = WEAPON_DEFINITIONS[player.weapon.weaponId];
  if (!definition || !player.alive || player.meleeCooldownTicks > 0 || player.switchTicksRemaining > 0) return [];
  if (player.weapon.reloadTicksRemaining > 0) return [];
  if (player.weapon.magazineAmmo >= definition.magazineSize || player.weapon.reserveAmmo <= 0) return [];
  const reloadTicks = reloadTicksFor(player, definition);
  player.weapon.reloadTicksRemaining = reloadTicks;
  return [{ type: 'weaponReloadStarted', playerId: player.id, weaponId: definition.id, reloadTicks }];
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

/**
 * WaW-style dynamic spread: hip fire opens up while moving (most while sprinting) and blooms with each
 * shot, settling back over about half a second. Aiming scales the whole cone by the gun's aim multiplier.
 */
export const SPREAD_RULES = {
  movingExtra: 1, sprintExtra: 2, bloomPerShot: 0.3, maxBloom: 1.2, bloomDecayPerTick: 0.03,
  /** The widest a cone ever gets, whatever the gun and however it is fired (11 degrees). */
  maxCone: 0.2,
} as const;
/** Aiming down the sights leaves this much of a gun's spread unless it says otherwise. */
export const DEFAULT_AIM_SPREAD = 0.12;

/** The spread cone (radians) the player's next shot will use; the HUD crosshair draws the same value. */
export function currentSpread(player: PlayerState): number {
  const definition = WEAPON_DEFINITIONS[player.weapon.weaponId];
  if (!definition) return 0;
  const pace = Math.min(1, Math.hypot(player.velocity.x, player.velocity.z) / PLAYER_MOVEMENT.maxSpeed);
  const movement = player.sprinting ? SPREAD_RULES.sprintExtra : SPREAD_RULES.movingExtra * pace;
  return Math.min(SPREAD_RULES.maxCone, definition.hipSpreadRadians * (1 + movement + player.spreadBloom)
    * (player.aiming ? definition.aimSpreadMultiplier ?? DEFAULT_AIM_SPREAD : 1));
}

export function tickWeaponState(player: PlayerState): WeaponEvent[] {
  if (player.switchTicksRemaining > 0) player.switchTicksRemaining -= 1;
  player.spreadBloom = Math.max(0, player.spreadBloom - SPREAD_RULES.bloomDecayPerTick);
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

/**
 * Splash around an impact (a directly struck zombie takes it too); walls block it, it hurts a close shooter,
 * and it sets off hazards in reach. The reach and falloff are the shared blast rules (see blast.ts).
 */
function explodeAt(events: Array<WeaponEvent | DamageEvent>, player: PlayerState, definition: WeaponDefinition,
  impact: Vec3, zombies: readonly ZombieState[], boxes: readonly CollisionBox[], instaKill: boolean,
  hazards: readonly HazardTarget[]): void {
  const blast = definition.explosive!;
  events.push({ type: 'weaponExploded', playerId: player.id, weaponId: definition.id, position: { ...impact }, radius: blast.radius });
  for (const { target: zombie, distance, scale } of blastZombies(impact, blast.radius, zombies, boxes)) {
    damageZombie(events, player, definition.id, zombie, blast.damage * scale, distance, instaKill);
  }
  for (const { scale } of blastPlayers(impact, blast.radius, [player], boxes)) {
    events.push(...damagePlayer(player, Math.round(blast.selfDamage * scale)));
  }
  events.push(...blastHazards(impact, { radius: blast.radius, damage: blast.damage, playerDamage: blast.selfDamage }, player.id,
    hazards, boxes));
}

/** Jumps from zombie to nearest zombie in line of sight, weakening each time. */
function chainFrom(events: Array<WeaponEvent | DamageEvent>, player: PlayerState, definition: WeaponDefinition,
  origin: Vec3, first: ZombieState, zombies: readonly ZombieState[], boxes: readonly CollisionBox[], instaKill: boolean): void {
  const chain = definition.chain!;
  const struck = new Set<EntityId>([first.id]);
  const points = [{ ...origin }, zombieChest(first)];
  let from = first, damage = definition.damage * (1 - chain.falloff);
  for (let jump = 1; jump < chain.targets; jump += 1) {
    const here = zombieChest(from);
    const next = zombies.filter(zombie => zombie.alive && !struck.has(zombie.id)).map(zombie => {
      const target = zombieChest(zombie);
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
  hazards: readonly HazardTarget[] = [],
): Array<WeaponEvent | DamageEvent> {
  const definition = WEAPON_DEFINITIONS[player.weapon.weaponId];
  if (!definition || player.weapon.cooldownTicks > 0 || !player.alive) return [];
  if (player.switchTicksRemaining > 0 || player.meleeCooldownTicks > 0 || player.weapon.reloadTicksRemaining > 0 || player.weapon.magazineAmmo <= 0) return [];
  player.weapon.magazineAmmo -= 1;
  player.weapon.cooldownTicks = hasPerk(player, 'double-tap')
    ? Math.max(1, Math.round(definition.fireIntervalTicks * PERK_RULES.doubleTapInterval)) : definition.fireIntervalTicks;
  const events: Array<WeaponEvent | DamageEvent> = [{ type: 'weaponFired', playerId: player.id, weaponId: definition.id }];
  if (player.weapon.magazineAmmo === 0) events.push(...beginReload(player));
  const seed = spreadSeed ^ Math.imul(Number(player.id.slice(2)), 0x9e3779b9);
  const spread = currentSpread(player);
  player.spreadBloom = Math.min(SPREAD_RULES.maxBloom, player.spreadBloom + SPREAD_RULES.bloomPerShot);
  // Pellets resolve against the pre-shot state, then each zombie takes one combined hit.
  const hits = new Map<EntityId, { damage: number; distance: number; hitZone: HitZoneId; part: BodyPart; point: Vec3; direction: Vec3 }>();
  const hazardHits = new Map<string, { damage: number; point: Vec3 }>();
  const addHazardHit = (hazardId: string, distance: number, shotRay: HitscanRay, damage: number) => {
    const { origin, direction } = shotRay;
    const total = hazardHits.get(hazardId)
      ?? { damage: 0, point: { x: origin.x + direction.x * distance, y: origin.y + direction.y * distance,
        z: origin.z + direction.z * distance } };
    total.damage += damage; hazardHits.set(hazardId, total);
  };
  let first: { ray: HitscanRay; hit: HitscanTarget } | null = null;
  for (let pellet = 0; pellet < (definition.pellets ?? 1); pellet += 1) {
    const pelletSeed = pellet === 0 ? seed : seed ^ Math.imul(pellet, 0x85ebca6b);
    const pelletRay = spreadHitscanRay(ray, spread, pelletSeed);
    const hit = resolveHitscan(pelletRay, zombies, worldBoxes, definition.range, hazards);
    first ??= { ray: pelletRay, hit };
    if (hit.kind === 'hazard') addHazardHit(hit.hazardId, hit.distance, pelletRay, definition.damage);
    const penetration = definition.penetration;
    const targets = hit.kind === 'zombie'
      ? resolveHitscanZombies(pelletRay, zombies, worldBoxes, definition.range, hazards).slice(0, penetration?.maxTargets ?? 1) : [];
    targets.forEach((target, index) => {
      const total = hits.get(target.zombieId) ?? { damage: 0, distance: target.distance, hitZone: target.hitZone,
        part: target.part, point: target.point, direction: pelletRay.direction };
      total.damage += definition.damage * hitZoneMultiplier(definition, target.hitZone)
        * (penetration?.damageRetention ?? 1) ** index;
      // The hit that is reported is the nearest pellet's, or a headshot's if any pellet struck the head.
      if (target.distance < total.distance) Object.assign(total, { distance: target.distance, point: target.point, part: target.part });
      if (target.hitZone === 'head' && total.hitZone !== 'head') Object.assign(total, { hitZone: 'head', part: 'head', point: target.point });
      hits.set(target.zombieId, total);
    });
    if (hit.kind === 'zombie' && targets.length < (penetration?.maxTargets ?? 1)) {
      const obstacle = nearestHazardHit(pelletRay, hazards, definition.range,
        nearestWorldDistance(pelletRay, worldBoxes, definition.range));
      if (obstacle) addHazardHit(obstacle.hazardId, obstacle.distance, pelletRay,
        Math.round(definition.damage * (penetration?.damageRetention ?? 1) ** targets.length));
    }
  }
  for (const [zombieId, hit] of [...hits].sort((a, b) => a[1].distance - b[1].distance || a[0].localeCompare(b[0]))) {
    const zombie = zombies.find((candidate) => candidate.id === zombieId && candidate.alive);
    if (!zombie) continue;
    const applied = Math.min(zombie.health, instaKill ? zombie.health : Math.round(hit.damage));
    zombie.health -= applied;
    events.push({
      type: 'weaponHit', playerId: player.id, weaponId: definition.id,
      zombieId: zombie.id, damage: applied, distance: hit.distance, hitZone: hit.hitZone,
      part: hit.part, point: hit.point, direction: hit.direction,
    });
    events.push({ type: 'zombieDamaged', zombieId: zombie.id, playerId: player.id, damage: applied, health: zombie.health });
    if (zombie.health === 0) {
      zombie.alive = false;
      zombie.velocity = { x: 0, y: 0, z: 0 };
      events.push({ type: 'zombieDied', zombieId: zombie.id, playerId: player.id, method: hit.hitZone });
    }
  }
  for (const [hazardId, hit] of hazardHits) {
    const target = hazards.find(candidate => candidate.state.id === hazardId);
    if (!target) continue;
    events.push({ type: 'hazardHit', hazardId, kind: target.definition.kind, playerId: player.id, damage: hit.damage, position: hit.point },
      ...damageHazard(target, hit.damage, player.id));
  }
  if (first && definition.chain && first.hit.kind === 'zombie') {
    const struck = zombies.find(zombie => zombie.id === (first!.hit as { zombieId: EntityId }).zombieId)!;
    chainFrom(events, player, definition, first.ray.origin, struck, zombies, worldBoxes, instaKill);
  }
  if (first && definition.explosive && first.hit.kind !== 'none') {
    // Burst just in front of the surface or zombie that stopped the shot.
    const distance = Math.max(0, first.hit.distance - 0.05), { origin, direction } = first.ray;
    const impact = { x: origin.x + direction.x * distance, y: origin.y + direction.y * distance, z: origin.z + direction.z * distance };
    explodeAt(events, player, definition, impact, zombies, worldBoxes, instaKill, hazards);
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
    const chest = zombieChest(zombie);
    const offset = { x: chest.x - ray.origin.x, y: chest.y - ray.origin.y, z: chest.z - ray.origin.z };
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
