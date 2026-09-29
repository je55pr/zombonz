import { describe, expect, it } from 'vitest';
import {
  ANY_FACING, CLOSE_RANGE, GameSimulation, PERKS, addEntity, createBarrier, createInputFrame, createInteractableState,
  createPlayerState, findInteractionCandidate, syncBarrierInteractables, type EntityId, type InteractableState,
} from '../src/core/index.ts';
import { ASYLUM_MAP } from '../src/maps/asylum.ts';
import { BUNKER_BARRIERS, BUNKER_PLAYER_SPAWN, BUNKER_SHOT_BLOCKERS, BUNKER_WALK_SURFACES, BUNKER_ZOMBIE_SPAWNS,
  BUNKER_DOORS, BUNKER_NAVIGATION, greyboxCollisionBoxes } from '../src/maps/bunker.ts';

/** A point that buys something, at chest height like most of the map's. */
function point(id: EntityId, x: number, y: number, z: number, options: { range?: number; facing?: number } = {}): InteractableState {
  return createInteractableState(id, { x, y, z }, { interactionType: 'purchase', actionId: `buy-${id}`, prompt: 'E  Buy',
    interactionRange: options.range, minFacingDot: options.facing });
}
/** The yaw that looks from one point toward another (yaw 0 looks toward -z). */
const faceToward = (from: { x: number; z: number }, to: { x: number; z: number }) => Math.atan2(from.x - to.x, from.z - to.z);
function playerAt(x: number, z: number, yaw = 0, pitch = 0) {
  const player = createPlayerState('e:1', { x, y: 0, z });
  player.yaw = yaw; player.pitch = pitch;
  return player;
}

describe('how squarely a player must face something', () => {
  it('goes by heading alone, so looking up or down at it makes no difference', () => {
    const chest = point('e:2', 0, 1.2, -1.6);
    for (const pitch of [-1.2, -0.6, 0, 0.6, 1.2]) {
      expect(findInteractionCandidate(playerAt(0, 0, 0, pitch), [chest])?.interactableId, `pitch ${pitch}`).toBe('e:2');
    }
  });

  it('takes anything about seventy degrees off by default, and nothing behind', () => {
    const item = point('e:2', 0, 0, -1.8);
    const at = (degrees: number) => findInteractionCandidate(playerAt(0, 0, degrees * Math.PI / 180), [item]);
    for (const degrees of [0, 30, -50, 65]) expect(at(degrees), `${degrees} degrees`).not.toBeNull();
    for (const degrees of [80, -100, 180]) expect(at(degrees), `${degrees} degrees`).toBeNull();
  });

  it('counts a player right beside something as facing it, wherever they look', () => {
    const item = point('e:2', 0, 1, 0.5);
    expect(CLOSE_RANGE).toBeGreaterThan(0.5);
    expect(findInteractionCandidate(playerAt(0, 0, 0), [item])).not.toBeNull();
    expect(findInteractionCandidate(playerAt(0, 0, Math.PI), [item])).not.toBeNull();
    // A little further out, the same point behind them is out of reach again.
    expect(findInteractionCandidate(playerAt(0, 0, 0), [point('e:3', 0, 1, 1.4)])).toBeNull();
  });

  it('needs no facing at all from a barrier-style point, but still needs range', () => {
    const near = point('e:2', 0, 1.2, 1.5, { facing: ANY_FACING }), far = point('e:3', 0, 1.2, 3.2, { facing: ANY_FACING });
    expect(findInteractionCandidate(playerAt(0, 0, 0), [near])?.interactableId).toBe('e:2');
    expect(findInteractionCandidate(playerAt(0, 0, 0), [far])).toBeNull();
  });
});

describe('choosing between several things in reach', () => {
  it('prefers the nearer of two well-centred objects, and the lower id on a tie', () => {
    const player = playerAt(0, 0);
    expect(findInteractionCandidate(player, [point('e:2', 0, 0, -2), point('e:3', 0, 0, -1)])?.interactableId).toBe('e:3');
    expect(findInteractionCandidate(player, [point('e:5', 0, 0, -1.5), point('e:4', 0, 0, -1.5)])?.interactableId).toBe('e:4');
  });

  it('lets where the player looks settle a close call', () => {
    const ahead = point('e:2', 0, 0, -1.6), behind = point('e:3', 0, 0, 1.6, { facing: ANY_FACING });
    expect(findInteractionCandidate(playerAt(0, 0, 0), [ahead, behind])?.interactableId).toBe('e:2');
    expect(findInteractionCandidate(playerAt(0, 0, Math.PI), [ahead, behind])?.interactableId).toBe('e:3');
  });

  it('does not flicker as the player turns: two objects swap once each way in a full turn', () => {
    const west = point('e:2', -1.5, 0, 0, { facing: ANY_FACING }), east = point('e:3', 1.5, 0, 0, { facing: ANY_FACING });
    const picks: string[] = [];
    for (let degrees = 0; degrees <= 360; degrees++) {
      picks.push(findInteractionCandidate(playerAt(0, 0, degrees * Math.PI / 180), [west, east])!.interactableId);
    }
    const swaps = picks.filter((pick, index) => index > 0 && pick !== picks[index - 1]).length;
    expect(swaps).toBe(2);
  });
});

describe('perk machines, up close', () => {
  const map = ASYLUM_MAP;
  const simMap = { collisionBoxes: [...map.collisionBoxes], walkSurfaces: map.walkSurfaces, zombieSpawns: map.zombieSpawns,
    navigationGraph: map.navigation, doors: map.doors, mysteryBoxes: map.mysteryBoxes, shotBlockers: map.shotBlockers,
    barriers: map.barriers, wallWeapons: map.wallWeapons, powerSwitch: map.powerSwitch, perkMachines: map.perkMachines,
    traps: map.traps };
  function simAt(position: { x: number; y: number; z: number }, yaw: number) {
    const sim = new GameSimulation({ seed: 5, map: simMap, playerSpawns: [position],
      roundConfig: { initialWaitTicks: 9999, intermissionTicks: 9999 },
      economyConfig: { startingPoints: 10000, hitReward: 10, killBonus: 50 } });
    sim.state.power.on = true; sim.tick();
    const player = sim.getPlayer(sim.playerIds[0])!;
    player.yaw = yaw;
    return { sim, player };
  }
  function press(sim: GameSimulation) {
    const frame = createInputFrame(0);
    frame.actions.interact = { pressed: true, held: true, released: false, value: 1 };
    return sim.tick({ [sim.playerIds[0]]: frame });
  }
  /** The machine's body centre: its buy point is a metre in front of it (see asylum.ts). */
  const bodyCentre = (position: { x: number; z: number }, facing: number) =>
    ({ x: position.x - Math.sin(facing), z: position.z - Math.cos(facing) });

  it.each(map.perkMachines!.map(machine => machine.id))('sells %s to a player standing against its front, facing it', id => {
    const machine = map.perkMachines!.find(candidate => candidate.id === id)!;
    const facing = map.perkMachineFacing![id], centre = bodyCentre(machine.position, facing);
    // Half the body's depth plus the player's radius: as close as the collision lets them stand.
    const stand = { x: centre.x + Math.sin(facing) * 0.78, y: machine.position.y - 1, z: centre.z + Math.cos(facing) * 0.78 };
    const { sim, player } = simAt(stand, faceToward(stand, centre));
    expect(Math.hypot(player.position.x - stand.x, player.position.z - stand.z), 'not pushed out').toBeLessThan(0.05);
    // The buy point is now almost under them, and on the far side of them from the machine.
    expect(Math.hypot(machine.position.x - stand.x, machine.position.z - stand.z)).toBeLessThan(CLOSE_RANGE);
    expect(sim.interactionCandidate(player.id)?.interactionType).toBe('perk');
    expect(press(sim)).toContainEqual({ type: 'perkBought', playerId: player.id, perk: machine.perk });
    expect(player.points).toBe(10000 - PERKS[machine.perk].cost);
  });

  it.each(map.perkMachines!.map(machine => machine.id))('sells %s from a natural distance without exact aim', id => {
    const machine = map.perkMachines!.find(candidate => candidate.id === id)!;
    const facing = map.perkMachineFacing![id], centre = bodyCentre(machine.position, facing);
    const stand = { x: centre.x + Math.sin(facing) * 1.9, y: machine.position.y - 1, z: centre.z + Math.cos(facing) * 1.9 };
    for (const off of [-1, -0.6, 0, 0.6, 1]) {
      const { sim, player } = simAt(stand, faceToward(stand, centre) + off);
      expect(sim.interactionCandidate(player.id)?.interactionType, `${off} rad off the machine`).toBe('perk');
    }
  });
});

describe('barriers, up close', () => {
  const map = { collisionBoxes: greyboxCollisionBoxes(), walkSurfaces: BUNKER_WALK_SURFACES, shotBlockers: BUNKER_SHOT_BLOCKERS,
    zombieSpawns: BUNKER_ZOMBIE_SPAWNS, barriers: BUNKER_BARRIERS, doors: BUNKER_DOORS, navigationGraph: BUNKER_NAVIGATION };
  function windowSim(yawOffset: number) {
    const barrier = BUNKER_BARRIERS[0];
    const sim = new GameSimulation({ seed: 3, map, playerSpawns: [BUNKER_PLAYER_SPAWN],
      roundConfig: { initialWaitTicks: 9999, intermissionTicks: 9999 } });
    const player = sim.getPlayer(sim.playerIds[0])!;
    // Just inside the window, as a repairer stands.
    player.position = { x: barrier.insidePoint.x, y: barrier.insidePoint.y, z: barrier.insidePoint.z };
    player.yaw = faceToward(player.position, barrier.position) + yawOffset;
    const state = sim.state.barriers[0];
    state.boards = 0; state.mask = 0;
    syncBarrierInteractables(sim.state.barriers, sim.interactables());
    return { sim, player, state };
  }
  function hold(sim: GameSimulation, ticks: number) {
    for (let i = 0; i < ticks; i++) {
      const frame = createInputFrame(i);
      frame.actions.interact = { pressed: i === 0, held: true, released: false, value: 1 };
      sim.tick({ [sim.playerIds[0]]: frame });
    }
  }

  it.each([0, Math.PI / 2, Math.PI, -Math.PI / 2])('can be rebuilt from beside it, however the player is turned (%f rad off)', yawOffset => {
    const { sim, player, state } = windowSim(yawOffset);
    expect(sim.interactionCandidate(player.id)?.interactionType).toBe('barrier');
    hold(sim, 130);
    expect(state.boards).toBeGreaterThanOrEqual(2);
  });

  it('cannot be reached through a wall, or from far away', () => {
    const wall = { min: { x: -0.2, y: 0, z: -3 }, max: { x: 0.2, y: 4, z: 3 } };
    const sim = new GameSimulation({ seed: 1, map: { collisionBoxes: [wall], walkSurfaces: [], zombieSpawns: [] },
      playerSpawns: [{ x: 1, y: 0, z: 0 }], roundConfig: { initialWaitTicks: 9999, intermissionTicks: 9999 } });
    addEntity(sim.state.world, point('e:99', -1, 1.2, 0, { facing: ANY_FACING }));
    expect(sim.interactionCandidate(sim.playerIds[0])).toBeNull();
    const open = new GameSimulation({ seed: 1, map: { collisionBoxes: [], walkSurfaces: [], zombieSpawns: [] },
      playerSpawns: [{ x: 5, y: 0, z: 0 }], roundConfig: { initialWaitTicks: 9999, intermissionTicks: 9999 } });
    addEntity(open.state.world, point('e:99', 0, 1.2, 0, { facing: ANY_FACING }));
    expect(open.interactionCandidate(open.playerIds[0])).toBeNull();
  });

  it('is proximity-only by definition, and only while it has boards to rebuild', () => {
    const { interactable, state } = createBarrier(BUNKER_BARRIERS[0], 'e:10');
    expect(interactable.minFacingDot).toBe(ANY_FACING);
    state.boards = state.maxBoards;
    syncBarrierInteractables([state], [interactable]);
    expect(interactable.enabled).toBe(false);
    expect(findInteractionCandidate(playerAt(interactable.position.x, interactable.position.z + 1), [interactable])).toBeNull();
  });
});
