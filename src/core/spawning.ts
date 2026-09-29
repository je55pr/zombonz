import { SeededRng } from './rng.ts';
import type { Vec3 } from './types.ts';

export interface ZombieSpawnPoint extends Vec3 { barrierId?: string; minRound?: number }

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

function chooseSpawnIndex(seed: number, round: number, spawned: number, count: number): number {
  const mixedSeed = (seed ^ Math.imul(round, 2654435761) ^ Math.imul(spawned + 1, 2246822507)) >>> 0;
  return new SeededRng(mixedSeed).int(0, count);
}
export function tickSpawnDirector(
  state: SpawnDirectorState,
  aliveZombies: number,
  spawnPoints: readonly Vec3[],
  worldSeed: number,
  config: SpawnDirectorConfig = DEFAULT_SPAWN_CONFIG,
): SpawnRequest | null {
  if (state.spawned >= state.total || aliveZombies >= config.maxAlive || spawnPoints.length === 0) return null;
  if (state.ticksUntilNext > 0) {
    state.ticksUntilNext -= 1;
    return null;
  }
  const spawnIndex = chooseSpawnIndex(worldSeed, state.round, state.spawned, spawnPoints.length);
  const point = spawnPoints[spawnIndex];
  const request = { spawnIndex, position: { x: point.x, y: point.y, z: point.z } };
  state.spawned += 1;
  state.ticksUntilNext = state.intervalTicks;
  return request;
}
