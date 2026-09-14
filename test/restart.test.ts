import { describe, expect, it } from 'vitest';
import {
  GameSimulation,
  createInputFrame,
  nextMatchSeed,
  runHeadlessTicks,
} from '../src/core/index.ts';

function makeSimulation(seed = 4242) {
  return new GameSimulation({
    seed,
    map: {
      collisionBoxes: [],
      walkSurfaces: [],
      zombieSpawns: [{ x: 0.8, y: 0, z: 0 }],
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
function restartFrame(sequence: number) {
  const frame = createInputFrame(sequence);
  frame.actions.restart = {
    held: true,
    pressed: true,
    released: false,
    value: 1,
  };
  return frame;
}

function reachGameOver(simulation: GameSimulation): void {
  runHeadlessTicks(simulation, 240);
  expect(simulation.state.round.phase).toBe('gameOver');
}

describe('game over restart', () => {
  it('restarts from game over with a deterministic next seed', () => {
    const simulation = makeSimulation();
    reachGameOver(simulation);
    const oldSeed = simulation.state.world.seed;
    const playerId = simulation.playerIds[0];
    expect(simulation.zombies().length).toBeGreaterThan(0);
    const events = simulation.tick({
      [playerId]: restartFrame(simulation.state.world.tick),
    });
    expect(events).toEqual([{
      type: 'matchRestarted',
      previousSeed: oldSeed,
      seed: nextMatchSeed(oldSeed),
    }]);
    expect(simulation.state.world.seed).toBe(nextMatchSeed(oldSeed));
    expect(simulation.state.world.tick).toBe(0);
    expect(simulation.state.round).toMatchObject({ round: 0, phase: 'waiting' });
    expect(simulation.zombies()).toEqual([]);

    const player = simulation.getPlayer(simulation.playerIds[0]);
    expect(player).toMatchObject({
      alive: true,
      health: 100,
      points: 500,
      weapon: { weaponId: 'starter-pistol', magazineAmmo: 8, reserveAmmo: 32 },
    });
  });

  it('supports an explicit restart seed for deterministic replay/debugging', () => {
    const simulation = makeSimulation(11);
    runHeadlessTicks(simulation, 30);
    const oldWorld = simulation.state.world;
    const event = simulation.restart(9001);

    expect(event).toEqual({
      type: 'matchRestarted',
      previousSeed: 11,
      seed: 9001,
    });
    expect(simulation.state.world).not.toBe(oldWorld);
    expect(simulation.state.world.seed).toBe(9001);
    expect(simulation.state.world.tick).toBe(0);
    expect(Object.values(simulation.state.world.entities)
      .some((entity) => entity.kind === 'zombie')).toBe(false);
  });

  it('defines stable next-seed progression including uint32 wraparound', () => {
    expect(nextMatchSeed(0)).toBe(0x9e3779b9);
    expect(nextMatchSeed(0xffffffff)).toBe(0x9e3779b8);
  });
});
