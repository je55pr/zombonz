import { describe, expect, it } from 'vitest';
import {
  CLASSIC_SPAWN_CONFIG, DEFAULT_ROUND_CONFIG, GameSimulation, SeededRng, ZOMBIE_GAIT_SPEEDS, ZOMBIE_PACE_SPREAD, PLAYER_MOVEMENT,
  createSpawnDirector, createZombieState, spawnIntervalForRound, zombieCountForRound, zombieGaitForRound, zombiePaceFactor,
  type ZombieGait, type ZombieState,
} from '../src/core/index.ts';

function gaitShare(round: number, samples = 2000): Record<ZombieGait, number> {
  const counts = { walk: 0, run: 0, sprint: 0 };
  for (let i = 0; i < samples; i += 1) counts[zombieGaitForRound(round, new SeededRng(i * 7919 + 1))] += 1;
  return { walk: counts.walk / samples, run: counts.run / samples, sprint: counts.sprint / samples };
}

describe('classic round sizes', () => {
  it('waits ten seconds between rounds', () => {
    expect(DEFAULT_ROUND_CONFIG.intermissionTicks).toBe(600);
  });

  it('matches the WaW/BO1 solo sequence', () => {
    const solo = Array.from({ length: 13 }, (_, i) => zombieCountForRound(i + 1, CLASSIC_SPAWN_CONFIG, 1));
    expect(solo).toEqual([6, 8, 13, 18, 24, 27, 28, 28, 29, 33, 34, 36, 39]);
  });

  it('adds a full share per extra co-op player without a fixed lobby size', () => {
    expect(zombieCountForRound(1, CLASSIC_SPAWN_CONFIG, 2)).toBe(7);
    expect(zombieCountForRound(1, CLASSIC_SPAWN_CONFIG, 4)).toBe(10);
    expect(zombieCountForRound(20, CLASSIC_SPAWN_CONFIG, 8))
      .toBeGreaterThan(zombieCountForRound(20, CLASSIC_SPAWN_CONFIG, 4));
  });

  it('keeps extreme rounds bounded', () => {
    expect(zombieCountForRound(1_000_000, CLASSIC_SPAWN_CONFIG, 64)).toBe(CLASSIC_SPAWN_CONFIG.maxRoundSize);
  });

  it('shortens spawn cadence each round down to a floor', () => {
    expect(spawnIntervalForRound(1)).toBe(120);
    expect(spawnIntervalForRound(2)).toBe(114);
    expect(spawnIntervalForRound(10)).toBeLessThan(spawnIntervalForRound(5));
    expect(spawnIntervalForRound(200)).toBe(CLASSIC_SPAWN_CONFIG.minSpawnIntervalTicks);
    expect(createSpawnDirector(3, CLASSIC_SPAWN_CONFIG, 1)).toMatchObject({ total: 13, intervalTicks: 108 });
  });
});

describe('zombie gaits', () => {
  it('walks in round one, then speeds up as slowly as WaW/BO1', () => {
    expect(gaitShare(1)).toEqual({ walk: 1, run: 0, sprint: 0 });
    // Round N rolls from (N - 1) x 8: round 2 is about one runner in five (7 of 35 rolls).
    const round2 = gaitShare(2);
    expect(round2.run).toBeGreaterThan(0.15);
    expect(round2.run).toBeLessThan(0.25);
    expect(round2.sprint).toBe(0);
    expect(gaitShare(3).walk).toBeGreaterThan(0.5);
    expect(gaitShare(5).walk).toBeGreaterThan(0);
    // Walkers are gone by round 6, where the first sprinters appear.
    expect(gaitShare(6).walk).toBe(0);
    expect(gaitShare(6).sprint).toBeLessThan(0.2);
    expect(gaitShare(7).sprint).toBeGreaterThan(0.25);
    expect(gaitShare(10)).toEqual({ walk: 0, run: 0, sprint: 1 });
  });

  it('keeps sprinters close behind a walking player without ever holding them', () => {
    // Issue #210: at 98% of a walking player's speed a sprinter never let go; now even the fastest zombie a horde can
    // hold (its gait's speed and the most its pace may be over) is left behind by walking, and sprinting leaves it far behind.
    const fastest = ZOMBIE_GAIT_SPEEDS.sprint * (1 + ZOMBIE_PACE_SPREAD);
    expect(fastest).toBeLessThan(PLAYER_MOVEMENT.maxSpeed * 0.95);
    expect(ZOMBIE_GAIT_SPEEDS.sprint).toBeGreaterThan(PLAYER_MOVEMENT.maxSpeed * 0.8);
    expect(fastest).toBeLessThan(PLAYER_MOVEMENT.maxSpeed * PLAYER_MOVEMENT.sprintMultiplier * 0.7);
    // Round-one walkers are a slow shamble and runners a jog: a walking player leaves both behind.
    expect(ZOMBIE_GAIT_SPEEDS.walk).toBeLessThanOrEqual(PLAYER_MOVEMENT.maxSpeed * 0.2);
    expect(ZOMBIE_GAIT_SPEEDS.run).toBeLessThan(PLAYER_MOVEMENT.maxSpeed * 0.6);
  });

  it('gives every zombie its own pace within the spread, the same for the same id', () => {
    const paces = Array.from({ length: 500 }, (_, i) => zombiePaceFactor(`e:${i}`));
    expect(Math.min(...paces)).toBeGreaterThanOrEqual(1 - ZOMBIE_PACE_SPREAD);
    expect(Math.max(...paces)).toBeLessThanOrEqual(1 + ZOMBIE_PACE_SPREAD);
    // Spread across the range, not bunched at one end.
    expect(Math.min(...paces)).toBeLessThan(1 - ZOMBIE_PACE_SPREAD * 0.9);
    expect(Math.max(...paces)).toBeGreaterThan(1 + ZOMBIE_PACE_SPREAD * 0.9);
    expect(zombiePaceFactor('e:7')).toBe(zombiePaceFactor('e:7'));
    for (const gait of ['walk', 'run', 'sprint'] as const) {
      const zombie = createZombieState('e:7', { x: 0, y: 0, z: 0 }, 1, gait);
      expect(zombie.moveSpeed).toBeCloseTo(ZOMBIE_GAIT_SPEEDS[gait] * zombiePaceFactor('e:7'), 3);
    }
  });

  it('assigns spawned gaits deterministically from the match seed', () => {
    function spawnedGaits(seed: number): ZombieGait[] {
      const sim = new GameSimulation({
        seed, map: { collisionBoxes: [], walkSurfaces: [], zombieSpawns: [{ x: 0, y: 0, z: -30 }] },
        playerSpawns: [{ x: 0, y: 0, z: 0 }],
        roundConfig: { initialWaitTicks: 1, intermissionTicks: 1 },
        spawnConfig: { baseZombieCount: 12, additionalPerRound: 0, spawnIntervalTicks: 0, maxAlive: 24 },
      });
      sim.state.round.round = 7; sim.state.round.phase = 'intermission';
      for (let i = 0; i < 20; i += 1) sim.tick();
      return Object.values(sim.state.world.entities)
        .filter((entity): entity is ZombieState => entity.kind === 'zombie')
        .map(zombie => zombie.gait);
    }
    const gaits = spawnedGaits(99);
    expect(gaits).toHaveLength(12);
    expect(new Set(gaits)).toContain('sprint');
    expect(gaits).toEqual(spawnedGaits(99));
  });
});
