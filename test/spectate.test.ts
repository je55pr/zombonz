import { describe, expect, it } from 'vitest';
import { GameSimulation } from '../src/core/simulation.ts';
import { selectSpectateTarget, spectateTargets } from '../src/client/spectate.ts';

const flat = {
  collisionBoxes: [],
  walkSurfaces: [{ minX: -10, maxX: 10, minZ: -10, maxZ: 10, startHeight: 0, endHeight: 0 }],
  zombieSpawns: [],
};

function match() {
  const sim = new GameSimulation({
    seed: 1,
    map: flat,
    playerSpawns: [{ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }],
  });
  return sim;
}

describe('spectating after bleedout', () => {
  it('uses stable player-slot order and cycles in both directions', () => {
    const sim = match();
    const [viewer, first, second] = sim.playerIds;
    expect(spectateTargets(sim, viewer)).toEqual([first, second]);
    expect(selectSpectateTarget(sim, viewer, null)).toBe(first);
    expect(selectSpectateTarget(sim, viewer, first, 1)).toBe(second);
    expect(selectSpectateTarget(sim, viewer, second, 1)).toBe(first);
    expect(selectSpectateTarget(sim, viewer, first, -1)).toBe(second);
  });

  it('repairs an invalid target when a teammate goes down, dies, or leaves', () => {
    const sim = match();
    const [viewer, first, second] = sim.playerIds;
    const firstPlayer = sim.getPlayer(first)!;

    firstPlayer.downed = { bleedoutTicks: 100, reviveTicks: 0, reviverId: null, selfRevive: false,
      lostPerks: [], stashed: { weapon: firstPlayer.weapon, holstered: firstPlayer.holsteredWeapon } };
    expect(selectSpectateTarget(sim, viewer, first)).toBe(second);

    firstPlayer.downed = null;
    firstPlayer.alive = false;
    expect(selectSpectateTarget(sim, viewer, first)).toBe(second);

    firstPlayer.alive = true;
    sim.state.leftPlayers.push(first);
    expect(selectSpectateTarget(sim, viewer, first)).toBe(second);
  });

  it('never spectates the viewer, a downed player, or nobody at all', () => {
    const sim = match();
    const [viewer, first, second] = sim.playerIds;
    sim.getPlayer(first)!.alive = false;
    sim.getPlayer(second)!.alive = false;
    expect(spectateTargets(sim, viewer)).toEqual([]);
    expect(selectSpectateTarget(sim, viewer, viewer)).toBeNull();
  });
});
