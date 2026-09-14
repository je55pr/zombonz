import { describe, expect, it } from 'vitest';
import {
  GameSimulation,
  addEntity,
  createInputFrame,
  createInteractableState,
  createPlayerState,
  findInteractionCandidate,
} from '../src/core/index.ts';

function interaction(id: `e:${number}`, x: number, z: number) {
  return createInteractableState(id, { x, y: 0, z }, {
    interactionType: 'purchase',
    actionId: 'buy-test',
    prompt: 'Press E to buy',
  });
}

describe('generic interactions', () => {
  it('exposes renderer-friendly prompt and action metadata', () => {
    const state = interaction('e:2', 0, -1);
    expect(state).toMatchObject({
      interactionType: 'purchase', actionId: 'buy-test',
      prompt: 'Press E to buy', interactionRange: 2.25, enabled: true,
    });
  });
  it('requires both range and facing', () => {
    const player = createPlayerState('e:1', { x: 0, y: 0, z: 0 });
    expect(findInteractionCandidate(player, [interaction('e:2', 0, -1)])?.actionId)
      .toBe('buy-test');
    expect(findInteractionCandidate(player, [interaction('e:3', 0, 1)]))
      .toBeNull();
    expect(findInteractionCandidate(player, [interaction('e:4', 0, -3)]))
      .toBeNull();
  });

  it('chooses candidates deterministically and ignores disabled targets', () => {
    const player = createPlayerState('e:1', { x: 0, y: 0, z: 0 });
    const highId = interaction('e:3', 0, -1);
    const lowId = interaction('e:2', 0, -1);
    expect(findInteractionCandidate(player, [highId, lowId])?.interactableId).toBe('e:2');
    lowId.enabled = false;
    expect(findInteractionCandidate(player, [highId, lowId])?.interactableId).toBe('e:3');
  });
  it('exposes the current candidate through GameSimulation', () => {
    const simulation = new GameSimulation({
      seed: 1,
      map: { collisionBoxes: [], walkSurfaces: [], zombieSpawns: [] },
      playerSpawns: [{ x: 0, y: 0, z: 0 }],
      roundConfig: { initialWaitTicks: 9999, intermissionTicks: 9999 },
    });
    const playerId = simulation.playerIds[0];
    addEntity(simulation.state.world, interaction('e:99', 0, -1));
    expect(simulation.interactionCandidate(playerId)).toMatchObject({
      interactableId: 'e:99', actionId: 'buy-test', prompt: 'Press E to buy',
    });
  });

  it('emits exactly one interaction for one interact press', () => {
    const simulation = new GameSimulation({
      seed: 2,
      map: { collisionBoxes: [], walkSurfaces: [], zombieSpawns: [] },
      playerSpawns: [{ x: 0, y: 0, z: 0 }],
      roundConfig: { initialWaitTicks: 9999, intermissionTicks: 9999 },
    });
    const playerId = simulation.playerIds[0];
    addEntity(simulation.state.world, interaction('e:99', 0, -1));
    const pressed = createInputFrame(0);
    pressed.actions.interact = { held: true, pressed: true, released: false, value: 1 };
    const firstEvents = simulation.tick({ [playerId]: pressed });
    expect(firstEvents.filter((event) => event.type === 'interactionTriggered')).toEqual([
      expect.objectContaining({ playerId, interactableId: 'e:99', actionId: 'buy-test' }),
    ]);

    const held = createInputFrame(1);
    held.actions.interact = { held: true, pressed: false, released: false, value: 1 };
    const secondEvents = simulation.tick({ [playerId]: held });
    expect(secondEvents.filter((event) => event.type === 'interactionTriggered')).toHaveLength(0);
  });
});
