import { describe, expect, it } from 'vitest';
import {
  GameSimulation,
  createInputFrame,
  runHeadlessTicks,
} from '../src/core/index.ts';

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function smokeSimulation() {
  return new GameSimulation({
    seed: 0x51a7c0de,
    map: {
      collisionBoxes: [],
      walkSurfaces: [],
      zombieSpawns: [{ x: 0, y: 0, z: -5 }],
    },
    playerSpawns: [{ x: 0, y: 0, z: 0 }],
    roundConfig: { initialWaitTicks: 1, intermissionTicks: 9999 },
    spawnConfig: {
      baseZombieCount: 1,
      additionalPerRound: 0,
      spawnIntervalTicks: 0,
      maxAlive: 4,
    },
  });
}

function runSmokeScenario() {
  const simulation = smokeSimulation();
  const playerId = simulation.playerIds[0];
  simulation.getPlayer(playerId)!.pitch = -0.1;
  const fireTicks = new Set([2, 14, 26]);
  runHeadlessTicks(simulation, 40, (tick) => {
    const frame = createInputFrame(tick);
    if (fireTicks.has(tick)) {
      frame.actions.fire = {
        held: true,
        pressed: true,
        released: false,
        value: 1,
      };
    }
    return { [playerId]: frame };
  });
  return simulation.state;
}
describe('deterministic smoke scenario', () => {
  it('finishes at the checked state hash', () => {
    const state = runSmokeScenario();
    const player = Object.values(state.world.entities)
      .find((entity) => entity.kind === 'player');

    expect(player).toMatchObject({
      kind: 'player',
      alive: true,
      health: 100,
      points: 580,
      kills: 1,
      headshots: 0,
      weapon: { magazineAmmo: 5, reserveAmmo: 32 },
    });
    expect(state.round.phase).toBe('intermission');
    // Includes movement stance, survival timers/reward tracking and an aimed body-shot kill.
    expect(fnv1a(JSON.stringify(state))).toBe('9b188632');
  });
});
