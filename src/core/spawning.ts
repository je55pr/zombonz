import { SeededRng } from './rng.ts';
import type { Vec3 } from './types.ts';

export interface SpawnDirectorConfig {
  baseZombieCount: number;
  additionalPerRound: number;
  spawnIntervalTicks: number;
  maxAlive: number;
}

export interface SpawnDirectorState {
  round: number;
  total: number;
  spawned: number;
  ticksUntilNext: number;
}

export interface SpawnRequest {
  spawnIndex: number;
  position: Vec3;
}

export const DEFAULT_SPAWN_CONFIG: SpawnDirectorConfig = {
  baseZombieCount: 6,
  additionalPerRound: 2,
  spawnIntervalTicks: 45,
  maxAlive: 24,
};
export function zombieCountForRound(round: number, config: SpawnDirectorConfig = DEFAULT_SPAWN_CONFIG): number {
  return config.baseZombieCount + Math.max(0, round - 1) * config.additionalPerRound;
}

export function createSpawnDirector(round: number, config: SpawnDirectorConfig = DEFAULT_SPAWN_CONFIG): SpawnDirectorState {
  return { round, total: zombieCountForRound(round, config), spawned: 0, ticksUntilNext: 0 };
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
  const request = { spawnIndex, position: { ...spawnPoints[spawnIndex] } };
  state.spawned += 1;
  state.ticksUntilNext = config.spawnIntervalTicks;
  return request;
}
