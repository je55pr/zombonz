import { describe, expect, it } from 'vitest';
import {
  SPAWN_SAFETY, createSpawnDirector, spawnSelectionWeights, tickSpawnDirector,
  type CollisionBox, type SpawnObserver, type ZombieSpawnPoint,
} from '../src/core/index.ts';

const observer = (x: number, z: number): SpawnObserver => ({ position: { x, y: 0, z }, eyeHeight: 1.62 });
const wall = (minX: number, maxX: number, minZ: number, maxZ: number): CollisionBox => ({
  min: { x: minX, y: 0, z: minZ }, max: { x: maxX, y: 3, z: maxZ },
});

describe('spawn safety and entrance weighting', () => {
  it('drops a visible/too-close entrance while a hidden distant entrance exists', () => {
    const spawns: ZombieSpawnPoint[] = [
      { x: 5, y: 0, z: 0, barrierId: 'near' },
      { x: 20, y: 0, z: 0, barrierId: 'far' },
    ];
    // This wall hides only the far spawn from the player at the origin.
    const weights = spawnSelectionWeights(spawns, [observer(0, 0)], [wall(10, 11, -2, 2)]);
    expect(weights[0]).toBe(0);
    expect(weights[1]).toBeGreaterThan(0);
  });

  it('keeps an entrance usable through hidden scatter points while suppressing its exposed point', () => {
    const spawns: ZombieSpawnPoint[] = [
      { x: 5, y: 0, z: 0, barrierId: 'mixed' },
      { x: 20, y: 0, z: 0, barrierId: 'mixed' },
      { x: -20, y: 0, z: 0, barrierId: 'other-safe' },
    ];
    const weights = spawnSelectionWeights(
      spawns,
      [observer(0, 0)],
      [wall(10, 11, -2, 2), wall(-11, -10, -2, 2)],
    );
    expect(weights[0]).toBe(0);
    expect(weights[1]).toBeGreaterThan(0);
    expect(weights[2]).toBeGreaterThan(0);
  });

  it('checks safety against every standing player, not just player one', () => {
    const spawns: ZombieSpawnPoint[] = [
      { x: 20, y: 0, z: 0, barrierId: 'near-second-player' },
      { x: 0, y: 0, z: 20, barrierId: 'safe' },
    ];
    // The horizontal wall hides the north spawn from both observers. The east spawn is only 2 m
    // from player two, so it must lose even though it is far from player one.
    const weights = spawnSelectionWeights(
      spawns,
      [observer(0, 0), observer(18, 0)],
      [wall(-5, 25, 8, 9)],
    );
    expect(weights[0]).toBe(0);
    expect(weights[1]).toBeGreaterThan(0);
  });

  it('falls back to all route-valid entrances when every choice is visible or too close', () => {
    const spawns: ZombieSpawnPoint[] = [
      { x: 4, y: 0, z: 0, barrierId: 'bad-near' },
      { x: 20, y: 0, z: 0, barrierId: 'bad-visible' },
    ];
    const weights = spawnSelectionWeights(spawns, [observer(0, 0)], []);
    expect(weights.every(weight => weight > 0)).toBe(true);
    expect(weights[1]).toBeGreaterThan(weights[0]);
  });

  it('weights entrances rather than rewarding one for having more scatter points', () => {
    const spawns: ZombieSpawnPoint[] = [
      { x: -20, y: 0, z: 0, barrierId: 'one-point' },
      { x: 20, y: 0, z: -1, barrierId: 'three-points' },
      { x: 20, y: 0, z: 0, barrierId: 'three-points' },
      { x: 20, y: 0, z: 1, barrierId: 'three-points' },
    ];
    const weights = spawnSelectionWeights(spawns, [], []);
    expect(weights[0]).toBeCloseTo(weights[1] + weights[2] + weights[3]);
  });

  it('keeps weighted selection deterministic and never chooses a zero-weight point', () => {
    const config = { baseZombieCount: 1, additionalPerRound: 0, spawnIntervalTicks: 0, maxAlive: 4 };
    const points = [{ x: 0, y: 0, z: 0 }, { x: 20, y: 0, z: 0 }];
    const a = tickSpawnDirector(createSpawnDirector(1, config), 0, points, 777, config, [0, 1]);
    const b = tickSpawnDirector(createSpawnDirector(1, config), 0, points, 777, config, [0, 1]);
    expect(a).toEqual(b);
    expect(a?.spawnIndex).toBe(1);
  });

  it('keeps the safety distance explicit and stable', () => {
    expect(SPAWN_SAFETY.minimumDistance).toBe(10);
  });
});
