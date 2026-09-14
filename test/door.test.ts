import { describe, expect, it } from 'vitest';
import {
  GameSimulation,
  createInputFrame,
  type DoorDefinition,
} from '../src/core/index.ts';

const testDoor: DoorDefinition = {
  id: 'test-door',
  position: { x: 0, y: 0, z: -1 },
  cost: 1000,
  prompt: 'Press E to open [1000]',
  blocker: {
    min: { x: -0.5, y: 0, z: -1.1 },
    max: { x: 0.5, y: 2.5, z: -0.9 },
  },
};

function simulation(startingPoints = 500) {
  return new GameSimulation({
    seed: 1,
    map: { collisionBoxes: [], walkSurfaces: [], zombieSpawns: [], doors: [testDoor] },
    playerSpawns: [{ x: 0, y: 0, z: 0 }],
    economyConfig: { startingPoints, hitReward: 10, killBonus: 50 },
    roundConfig: { initialWaitTicks: 9999, intermissionTicks: 9999 },
  });
}
function interactFrame(sequence = 0) {
  const frame = createInputFrame(sequence);
  frame.actions.interact = { held: true, pressed: true, released: false, value: 1 };
  return frame;
}

function forwardFrame(sequence = 0) {
  const frame = createInputFrame(sequence);
  frame.actions.moveForward = { held: true, pressed: sequence === 0, released: false, value: 1 };
  return frame;
}

describe('purchasable doors', () => {
  it('exposes cost prompt and closed collision before purchase', () => {
    const sim = simulation(500);
    const playerId = sim.playerIds[0];
    expect(sim.interactionCandidate(playerId)?.prompt).toBe('Press E to open [1000]');
    expect(sim.state.doors[0]).toMatchObject({ id: 'test-door', cost: 1000, open: false });
    expect(sim.collisionBoxes()).toHaveLength(1);
  });
  it('rejects purchase when points are insufficient', () => {
    const sim = simulation(500);
    const playerId = sim.playerIds[0];
    const events = sim.tick({ [playerId]: interactFrame() });
    expect(events.some((event) => event.type === 'pointsSpendRejected')).toBe(true);
    expect(sim.getPlayer(playerId)?.points).toBe(500);
    expect(sim.state.doors[0].open).toBe(false);
    expect(sim.collisionBoxes()).toHaveLength(1);
  });

  it('deducts once, opens permanently, and disables repeat interaction', () => {
    const sim = simulation(1500);
    const playerId = sim.playerIds[0];
    const first = sim.tick({ [playerId]: interactFrame() });
    expect(first.some((event) => event.type === 'doorOpened')).toBe(true);
    expect(first.some((event) => event.type === 'pointsSpent')).toBe(true);
    expect(sim.getPlayer(playerId)?.points).toBe(500);
    expect(sim.state.doors[0].open).toBe(true);
    expect(sim.collisionBoxes()).toHaveLength(0);
    expect(sim.interactionCandidate(playerId)).toBeNull();

    const second = sim.tick({ [playerId]: interactFrame(1) });
    expect(second.some((event) => event.type === 'doorOpened')).toBe(false);
    expect(sim.getPlayer(playerId)?.points).toBe(500);
  });

  it('physically blocks movement until opened, then allows passage', () => {
    const sim = simulation(1500);
    const playerId = sim.playerIds[0];
    for (let tick = 0; tick < 60; tick += 1) {
      sim.tick({ [playerId]: forwardFrame(tick) });
    }
    const blockedZ = sim.getPlayer(playerId)!.position.z;
    expect(blockedZ).toBeGreaterThan(-0.7);

    sim.tick({ [playerId]: interactFrame(61) });
    expect(sim.state.doors[0].open).toBe(true);
    for (let tick = 62; tick < 122; tick += 1) {
      sim.tick({ [playerId]: forwardFrame(tick) });
    }
    expect(sim.getPlayer(playerId)!.position.z).toBeLessThan(-1.5);
  });
});
