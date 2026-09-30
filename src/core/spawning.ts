import { SeededRng } from './rng.ts';
import type { CollisionBox } from './collision.ts';
import { clearLine } from './ray.ts';
import type { Vec3 } from './types.ts';

export interface ZombieSpawnPoint extends Vec3 { barrierId?: string; minRound?: number }

export interface SpawnObserver {
  position: Vec3;
  eyeHeight: number;
}

export const SPAWN_SAFETY = {
  /** A spawn closer than this to any standing player is avoided while a safer entrance exists. */
  minimumDistance: 10,
  /** Aim at roughly a zombie's chest when asking whether a player has direct line of sight. */
  sightHeight: 1.15,
  /** Visible entrances remain possible only as a fallback, but are less likely than hidden ones. */
  visibleFallbackWeight: 0.25,
  /** Beyond this distance, extra metres stop increasing an entrance's lottery weight. */
  distanceWeightCap: 30,
} as const;

/**
 * Gives every spawn point a deterministic-selection weight while treating all points behind the same
 * barrier as one entrance. Safety is evaluated per scatter point, so one visible dot does not condemn
 * hidden siblings. If any entrance has at least one safe point, entrances with none receive zero
 * weight; otherwise all route-valid entrances stay eligible as a fallback.
 */
export function spawnSelectionWeights(
  spawnPoints: readonly ZombieSpawnPoint[],
  observers: readonly SpawnObserver[],
  blockers: readonly CollisionBox[],
): number[] {
  if (!spawnPoints.length) return [];
  const groups = new Map<string, number[]>();
  spawnPoints.forEach((spawn, index) => {
    const key = spawn.barrierId ?? `direct:${index}`;
    const list = groups.get(key);
    if (list) list.push(index); else groups.set(key, [index]);
  });

  const points = spawnPoints.map(spawn => {
    let nearest = Infinity;
    let visible = false;
    for (const observer of observers) {
      nearest = Math.min(nearest, Math.hypot(spawn.x - observer.position.x, spawn.z - observer.position.z));
      if (!visible && clearLine(
        { x: observer.position.x, y: observer.position.y + observer.eyeHeight, z: observer.position.z },
        { x: spawn.x, y: spawn.y + SPAWN_SAFETY.sightHeight, z: spawn.z }, blockers,
      )) visible = true;
    }
    const safe = observers.length === 0 || (!visible && nearest >= SPAWN_SAFETY.minimumDistance);
    const distanceWeight = observers.length === 0 ? 1
      : Math.max(0.25, Math.min(SPAWN_SAFETY.distanceWeightCap, nearest) / SPAWN_SAFETY.minimumDistance);
    const score = distanceWeight * (visible ? SPAWN_SAFETY.visibleFallbackWeight : 1);
    return { safe, score };
  });

  const scoredGroups = [...groups.values()].map(indices => ({
    indices,
    safeIndices: indices.filter(index => points[index].safe),
  }));
  const hasSafeEntrance = scoredGroups.some(group => group.safeIndices.length > 0);
  const weights = Array(spawnPoints.length).fill(0) as number[];

  for (const group of scoredGroups) {
    const eligible = hasSafeEntrance ? group.safeIndices : group.indices;
    if (!eligible.length) continue;

    // The entrance receives the average score of its eligible scatter points, then that total is
    // redistributed inside the entrance. Adding more authored dots therefore does not multiply its odds.
    const entranceWeight = eligible.reduce((sum, index) => sum + points[index].score, 0) / eligible.length;
    const pointTotal = eligible.reduce((sum, index) => sum + points[index].score, 0);
    for (const index of eligible) {
      weights[index] = pointTotal > 0 ? entranceWeight * points[index].score / pointTotal
        : entranceWeight / eligible.length;
    }
  }
  return weights;
}

/** Fixed-cadence, linear round sizes; useful for tests and development previews. */
export interface LinearSpawnConfig {
  curve?: 'linear';
  baseZombieCount: number;
  additionalPerRound: number;
  spawnIntervalTicks: number;
  maxAlive: number;
}

/** WaW/BO1 round sizing and spawn cadence. */
export interface ClassicSpawnConfig {
  curve: 'classic';
  baseRoundSize: number;
  perPlayer: number;
  /** Multipliers for rounds 1..n; later rounds use the full size. */
  earlyRoundFactors: readonly number[];
  initialSpawnIntervalTicks: number;
  spawnIntervalDecay: number;
  minSpawnIntervalTicks: number;
  maxRoundSize: number;
  maxAlive: number;
}

export type SpawnDirectorConfig = LinearSpawnConfig | ClassicSpawnConfig;

export interface SpawnDirectorState {
  round: number;
  total: number;
  spawned: number;
  intervalTicks: number;
  ticksUntilNext: number;
}

export interface SpawnRequest {
  spawnIndex: number;
  position: Vec3;
}

export const CLASSIC_SPAWN_CONFIG: Readonly<ClassicSpawnConfig> = {
  curve: 'classic',
  baseRoundSize: 24,
  perPlayer: 6,
  earlyRoundFactors: [0.25, 0.3, 0.5, 0.7, 0.9],
  // Two seconds between spawns in round one, 5% shorter each round, never below ~0.08s.
  initialSpawnIntervalTicks: 120,
  spawnIntervalDecay: 0.95,
  minSpawnIntervalTicks: 5,
  maxRoundSize: 100_000,
  maxAlive: 24,
};

export const DEFAULT_SPAWN_CONFIG: Readonly<SpawnDirectorConfig> = CLASSIC_SPAWN_CONFIG;

export function zombieCountForRound(round: number, config: SpawnDirectorConfig = DEFAULT_SPAWN_CONFIG,
  playerCount = 1): number {
  const level = Math.max(1, Math.floor(round));
  if (config.curve !== 'classic') return config.baseZombieCount + (level - 1) * config.additionalPerRound;
  const players = Math.max(1, Math.floor(playerCount));
  let multiplier = Math.max(1, level / 5);
  if (level >= 10) multiplier *= level * 0.15;
  // Solo gets half a player's share; each extra co-op player adds a full share.
  const share = players === 1 ? 0.5 : players - 1;
  let size = config.baseRoundSize + Math.trunc(share * config.perPlayer * multiplier + 1e-9);
  const early = config.earlyRoundFactors[level - 1];
  if (early !== undefined) size = Math.trunc(size * early + 1e-9);
  return Math.min(config.maxRoundSize, Math.max(1, size));
}

export function spawnIntervalForRound(round: number, config: SpawnDirectorConfig = DEFAULT_SPAWN_CONFIG): number {
  if (config.curve !== 'classic') return config.spawnIntervalTicks;
  const level = Math.max(1, Math.floor(round));
  return Math.max(config.minSpawnIntervalTicks,
    Math.round(config.initialSpawnIntervalTicks * config.spawnIntervalDecay ** (level - 1)));
}

export function createSpawnDirector(round: number, config: SpawnDirectorConfig = DEFAULT_SPAWN_CONFIG,
  playerCount = 1): SpawnDirectorState {
  return { round, total: zombieCountForRound(round, config, playerCount), spawned: 0,
    intervalTicks: spawnIntervalForRound(round, config), ticksUntilNext: 0 };
}

export function remainingSpawns(state: SpawnDirectorState | null): number {
  return state ? Math.max(0, state.total - state.spawned) : 0;
}

function chooseSpawnIndex(seed: number, round: number, spawned: number, count: number, weights?: readonly number[]): number {
  const mixedSeed = (seed ^ Math.imul(round, 2654435761) ^ Math.imul(spawned + 1, 2246822507)) >>> 0;
  const rng = new SeededRng(mixedSeed);
  if (weights?.length === count) {
    const total = weights.reduce((sum, weight) => sum + (Number.isFinite(weight) && weight > 0 ? weight : 0), 0);
    if (total > 0) {
      let pick = rng.next() * total;
      let last = 0;
      for (let index = 0; index < count; index++) {
        const weight = Number.isFinite(weights[index]) && weights[index] > 0 ? weights[index] : 0;
        if (weight <= 0) continue;
        last = index;
        if (pick < weight) return index;
        pick -= weight;
      }
      return last;
    }
  }
  return rng.int(0, count);
}
export function tickSpawnDirector(
  state: SpawnDirectorState,
  aliveZombies: number,
  spawnPoints: readonly Vec3[],
  worldSeed: number,
  config: SpawnDirectorConfig = DEFAULT_SPAWN_CONFIG,
  spawnWeights?: readonly number[],
): SpawnRequest | null {
  if (state.spawned >= state.total || aliveZombies >= config.maxAlive || spawnPoints.length === 0) return null;
  if (state.ticksUntilNext > 0) {
    state.ticksUntilNext -= 1;
    return null;
  }
  const spawnIndex = chooseSpawnIndex(worldSeed, state.round, state.spawned, spawnPoints.length, spawnWeights);
  const point = spawnPoints[spawnIndex];
  const request = { spawnIndex, position: { x: point.x, y: point.y, z: point.z } };
  state.spawned += 1;
  state.ticksUntilNext = state.intervalTicks;
  return request;
}
