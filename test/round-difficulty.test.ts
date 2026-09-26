import { describe, expect, it } from 'vitest';
import {
  CLASSIC_SPAWN_CONFIG, GameSimulation, SeededRng, ZOMBIE_GAIT_SPEEDS, PLAYER_MOVEMENT,
  createSpawnDirector, spawnIntervalForRound, zombieCountForRound, zombieGaitForRound,
  type ZombieGait, type ZombieState,
} from '../src/core/index.ts';

function gaitShare(round: number, samples = 2000): Record<ZombieGait, number> {
  const counts = { walk: 0, run: 0, sprint: 0 };
  for (let i = 0; i < samples; i += 1) counts[zombieGaitForRound(round, new SeededRng(i * 7919 + 1))] += 1;
  return { walk: counts.walk / samples, run: counts.run / samples, sprint: counts.sprint / samples };
}

describe('classic round sizes', () => {
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
  it('walks in round one, mixes in runners, then turns into sprinters', () => {
    expect(gaitShare(1)).toEqual({ walk: 1, run: 0, sprint: 0 });
    const round2 = gaitShare(2);
    expect(round2.run).toBeGreaterThan(0.3);
    expect(round2.sprint).toBe(0);
    expect(gaitShare(5).walk).toBe(0);
    expect(gaitShare(5).sprint).toBeGreaterThan(0);
    expect(gaitShare(9)).toEqual({ walk: 0, run: 0, sprint: 1 });
  });

  it('lets sprinters nearly match a walking player but not a sprinting one', () => {
    expect(ZOMBIE_GAIT_SPEEDS.sprint).toBeGreaterThan(PLAYER_MOVEMENT.maxSpeed * 0.9);
    expect(ZOMBIE_GAIT_SPEEDS.sprint).toBeLessThan(PLAYER_MOVEMENT.maxSpeed);
  });

  it('assigns spawned gaits deterministically from the match seed', () => {
    function spawnedGaits(seed: number): ZombieGait[] {
      const sim = new GameSimulation({
        seed, map: { collisionBoxes: [], walkSurfaces: [], zombieSpawns: [{ x: 0, y: 0, z: -30 }] },
        playerSpawns: [{ x: 0, y: 0, z: 0 }],
        roundConfig: { initialWaitTicks: 1, intermissionTicks: 1 },
        spawnConfig: { baseZombieCount: 12, additionalPerRound: 0, spawnIntervalTicks: 0, maxAlive: 24 },
      });
      sim.state.round.round = 5; sim.state.round.phase = 'intermission';
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
