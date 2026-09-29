import { describe, expect, it } from 'vitest';
import {
  GameSimulation,
  createPlayerState,
  createRoundState,
  createSpawnDirector,
  createZombieState,
  damagePlayer,
  remainingSpawns,
  runHeadlessTicks,
  tickSpawnDirector,
  updateRoundState,
  updateZombiePursuit,
} from '../src/core/index.ts';

describe('player health', () => {
  it('goes down deterministically on the second 50-damage hit', () => {
    const player = createPlayerState('e:1', { x: 0, y: 0, z: 0 });
    expect(damagePlayer(player, 50).map((event) => event.type)).toEqual(['playerDamaged']);
    const events = damagePlayer(player, 50);
    expect(events.map((event) => event.type)).toEqual(['playerDamaged', 'playerDowned']);
    expect(player.health).toBe(0);
    expect(player.downed).not.toBeNull(); // The simulation decides whether anyone can revive them.
  });
});

describe('round state', () => {
  it('emits deterministic phase transitions and increments rounds', () => {
    const state = createRoundState();
    const config = { initialWaitTicks: 2, intermissionTicks: 2 };
    const clear = { livingPlayers: 1, zombiesAlive: 0, spawnsRemaining: 0 };
    expect(updateRoundState(state, clear, config)).toEqual([]);
    expect(updateRoundState(state, clear, config)[0]).toMatchObject({ to: 'spawning', round: 1 });
    expect(updateRoundState(state, clear, config)[0]).toMatchObject({ to: 'active' });
    expect(updateRoundState(state, clear, config)[0]).toMatchObject({ to: 'intermission' });
    expect(updateRoundState(state, clear, config)).toEqual([]);
    expect(updateRoundState(state, clear, config)[0]).toMatchObject({ to: 'spawning', round: 2 });
  });
});

describe('spawn director', () => {
  it('uses configured counts, respects alive cap, and reports remaining spawns', () => {
    const config = { baseZombieCount: 3, additionalPerRound: 2, spawnIntervalTicks: 0, maxAlive: 1 };
    const director = createSpawnDirector(2, config);
    expect(director.total).toBe(5);
    const points = [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }];
    expect(tickSpawnDirector(director, 0, points, 123, config)).not.toBeNull();
    expect(remainingSpawns(director)).toBe(4);
    expect(tickSpawnDirector(director, 1, points, 123, config)).toBeNull();
  });

  it('chooses the same spawn for the same seed and state', () => {
    const config = { baseZombieCount: 1, additionalPerRound: 0, spawnIntervalTicks: 0, maxAlive: 4 };
    const points = [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }];
    const a = tickSpawnDirector(createSpawnDirector(1, config), 0, points, 777, config);
    const b = tickSpawnDirector(createSpawnDirector(1, config), 0, points, 777, config);
    expect(a).toEqual(b);
  });
});

describe('zombie pursuit', () => {
  it('does not pass through authoritative collision', () => {
    const zombie = createZombieState('e:2', { x: 0, y: 0, z: 0 }, 1);
    const player = createPlayerState('e:1', { x: 3, y: 0, z: 0 });
    const wall = [{ min: { x: 1, y: 0, z: -2 }, max: { x: 1.5, y: 2, z: 2 } }];
    for (let i = 0; i < 300; i += 1) updateZombiePursuit(zombie, [player], 1 / 60, wall);
    expect(zombie.position.x).toBeLessThanOrEqual(0.68 + 1e-6);
  });
});
describe('headless game simulation', () => {
  function makeSimulation() {
    return new GameSimulation({
      seed: 4242,
      map: {
        collisionBoxes: [],
        walkSurfaces: [],
        zombieSpawns: [{ x: 2.2, y: 0, z: 0 }],
      },
      playerSpawns: [{ x: 0, y: 0, z: 0 }],
      roundConfig: { initialWaitTicks: 1, intermissionTicks: 30 },
      spawnConfig: {
        baseZombieCount: 1,
        additionalPerRound: 0,
        spawnIntervalTicks: 0,
        maxAlive: 4,
      },
    });
  }

  it('advances without a renderer and reaches solo game over', () => {
    const simulation = makeSimulation();
    // A lone walker walks up, winds up, and lands two blows a swing apart: about four seconds in all.
    const state = runHeadlessTicks(simulation, 900);
    const player = simulation.getPlayer(simulation.playerIds[0]);
    expect(state.world.tick).toBeLessThan(900); // Game over freezes gameplay until restart.
    expect(state.world.tick).toBeGreaterThan(180);
    const endedAt = state.world.tick;
    simulation.tick();
    expect(state.world.tick).toBe(endedAt);
    expect(player?.alive).toBe(false);
    expect(state.round.phase).toBe('gameOver');
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });

  it('replays identically from the same seed', () => {
    const a = runHeadlessTicks(makeSimulation(), 240);
    const b = runHeadlessTicks(makeSimulation(), 240);
    expect(a).toEqual(b);
  });
});
