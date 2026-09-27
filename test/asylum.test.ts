import { describe, expect, it } from 'vitest';
import {
  GameSimulation, createInputFrame, createPlayerState, createZombieState, updatePlayerMovement, updateZombiePursuit,
  closedDoorBlockers, createDoorState, hasWalkableConnection, resolveHitscan, createNavigationQuery, navigationWaypoint,
} from '../src/core/index.ts';
import { ASYLUM_MAP } from '../src/maps/asylum.ts';
import { MAPS, MAP_CATALOG } from '../src/maps/index.ts';

const map = ASYLUM_MAP;
const UP = map.upperHeight;
const simMap = { collisionBoxes: [...map.collisionBoxes], walkSurfaces: map.walkSurfaces, zombieSpawns: map.zombieSpawns,
  navigationGraph: map.navigation, doors: map.doors, mysteryBoxes: map.mysteryBoxes, shotBlockers: map.shotBlockers,
  barriers: map.barriers, wallWeapons: map.wallWeapons };
function interact(sim: GameSimulation) {
  const frame = createInputFrame(0);
  frame.actions.interact = { pressed: true, held: true, released: false, value: 1 };
  return sim.tick({ [sim.playerIds[0]]: frame });
}
const node = (id: string) => map.navigation.nodes.find(candidate => candidate.id === id)!;

describe('Asylum map contract', () => {
  it('is registered for the menu beside Bunker', () => {
    expect(MAP_CATALOG.map(entry => entry.id)).toEqual(['bunker', 'asylum']);
    expect(MAPS.asylum).toBe(ASYLUM_MAP);
    expect(MAPS.asylum.name).toBe('Asylum');
  });

  it('has twelve ground entries, three decorative upper windows, six unlocks, ten wall buys and one box', () => {
    expect(map.barriers).toHaveLength(12);
    expect(map.windows.filter(w => w.y === UP)).toHaveLength(3);
    expect(map.doors).toHaveLength(6);
    expect(map.wallWeapons).toHaveLength(10);
    expect(map.mysteryBoxes).toHaveLength(1);
    const ids = [...map.barriers, ...map.doors, ...map.wallWeapons].map(item => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const wall of map.wallWeapons) expect(map.wallWeaponFacing[wall.id], wall.id).toBeDefined();
    for (const door of map.doors) expect(map.doorStyles[door.id], door.id).toBeDefined();
  });

  it('starts the player in the dining hall, on real floor', () => {
    const sim = new GameSimulation({ seed: 1, map: simMap, playerSpawns: [map.playerSpawn],
      roundConfig: { initialWaitTicks: 9999, intermissionTicks: 1 } });
    sim.tick();
    expect(sim.getPlayer(sim.playerIds[0])!.position).toMatchObject({ x: map.playerSpawn.x, y: 0 });
  });

  it('only spawns zombies at the dining hall\'s entries while every door is shut', () => {
    const sim = new GameSimulation({ seed: 7, map: simMap, playerSpawns: [map.playerSpawn],
      roundConfig: { initialWaitTicks: 1, intermissionTicks: 10 },
      spawnConfig: { baseZombieCount: 12, additionalPerRound: 0, maxAlive: 12, spawnIntervalTicks: 0 } });
    for (let i = 0; i < 15; i++) sim.tick();
    expect(sim.zombies()).toHaveLength(12);
    expect(new Set(sim.zombies().map(zombie => zombie.entry?.barrierId))).toEqual(
      new Set(['dining-north', 'dining-west-a', 'dining-west-b']));
  });
});

describe('Asylum routes', () => {
  it.each(map.doors.flatMap(door => {
    const style = map.doorStyles[door.id];
    // Doorways are bought from either room; stair debris from the foot of the stair.
    return style.kind === 'planks'
      ? [{ id: door.id, position: { x: door.position.x - 1.4, y: 0, z: door.position.z }, yaw: -Math.PI / 2 },
        { id: door.id, position: { x: door.position.x + 1.4, y: 0, z: door.position.z }, yaw: Math.PI / 2 }]
      : [{ id: door.id, position: { x: door.position.x + Math.sign(door.position.x) * 1.4, y: 0, z: door.position.z },
        yaw: Math.sign(door.position.x) * Math.PI / 2 }];
  }))('buys $id from an accessible approach', approach => {
    const sim = new GameSimulation({ seed: 3, map: simMap, playerSpawns: [approach.position],
      economyConfig: { startingPoints: 2000, hitReward: 10, killBonus: 50 },
      roundConfig: { initialWaitTicks: 9999, intermissionTicks: 9999 } });
    sim.getPlayer(sim.playerIds[0])!.yaw = approach.yaw;
    expect(interact(sim).filter(event => event.type === 'doorOpened')).toEqual([
      { type: 'doorOpened', doorId: approach.id, playerId: sim.playerIds[0] }]);
  });

  it.each([-1, 1])('walks up and down the %i hall stair to the balcony and back', side => {
    const route = [`stair-${side}-foot`, ...Array.from({ length: 11 }, (_, i) => `stair-${side}-${i}`), `stair-${side}-head`,
      `mezzanine-${side}`, `balcony-${side}-in`, `balcony-${side}-out`].map(id => node(id).position);
    const forward = createInputFrame(0);
    forward.actions.moveForward = { pressed: true, held: true, released: false, value: 1 };
    const player = createPlayerState('e:1', route[0]);
    const walk = (points: readonly typeof route[number][]) => {
      for (const point of points) {
        let ticks = 0;
        while (Math.hypot(player.position.x - point.x, player.position.z - point.z) > 0.06 && ticks++ < 240) {
          player.yaw = Math.atan2(player.position.x - point.x, player.position.z - point.z);
          updatePlayerMovement(player, forward, 1 / 60, simMap.collisionBoxes, map.walkSurfaces);
        }
        expect(ticks, `${JSON.stringify(point)} from ${JSON.stringify(player.position)}`).toBeLessThan(240);
      }
    };
    walk(route);
    expect(player.position.y).toBeCloseTo(UP);
    walk([...route].reverse());
    expect(player.position.y).toBeCloseTo(0);
  });

  it('links every navigation node into one supported graph', () => {
    const byId = new Map(map.navigation.nodes.map(n => [n.id, n]));
    for (const n of map.navigation.nodes) for (const id of n.neighbors) {
      expect(hasWalkableConnection(n.position, byId.get(id)!.position, map.walkSurfaces), `${n.id} -> ${id}`).toBe(true);
    }
    const seen = new Set([map.navigation.nodes[0].id]), stack = [map.navigation.nodes[0].id];
    while (stack.length) for (const id of byId.get(stack.pop()!)!.neighbors) if (!seen.has(id)) { seen.add(id); stack.push(id); }
    expect(seen.size).toBe(map.navigation.nodes.length);
    for (const barrier of map.barriers) expect(byId.has(barrier.id), barrier.id).toBe(true);
  });

  it('keeps the corridor shut until its doors are bought', () => {
    const blockers = [...simMap.collisionBoxes, ...closedDoorBlockers(map.doors.map((d, i) => createDoorState(d, `e:${i + 10}`)))];
    expect(navigationWaypoint(map.navigation, map.playerSpawn, { x: 1, y: 0, z: -5 }, blockers, 0.32, map.walkSurfaces))
      .toBe(map.playerSpawn);
  });

  it('lets a runner go the long way round, over the balcony, while the corridor doors stay shut', () => {
    const doors = map.doors.map((d, i) => createDoorState(d, `e:${i + 10}`));
    doors.filter(d => d.id.endsWith('stairs')).forEach(d => { d.open = true; });
    const blockers = [...simMap.collisionBoxes, ...closedDoorBlockers(doors)];
    const zombie = createZombieState('e:2', { x: 21, y: 0, z: -4 }, 1, 'run');
    const player = createPlayerState('e:1', map.playerSpawn);
    const query = createNavigationQuery(map.navigation, blockers, 0.32, map.walkSurfaces);
    for (let i = 0; i < 60 * 60; i++) updateZombiePursuit(zombie, [player], 1 / 60, blockers, map.walkSurfaces, map.navigation, query);
    expect(Math.hypot(zombie.position.x - player.position.x, zombie.position.y, zombie.position.z - player.position.z)).toBeLessThan(1.1);
  });

  it('can buy every wall weapon from real floor in front of it', () => {
    for (const wall of map.wallWeapons) {
      const facing = map.wallWeaponFacing[wall.id];
      const stand = { x: wall.position.x + Math.sin(facing) * 1.2, y: wall.position.y - 1, z: wall.position.z + Math.cos(facing) * 1.2 };
      const sim = new GameSimulation({ seed: 1, playerSpawns: [stand],
        map: { ...simMap, zombieSpawns: [], wallWeapons: [wall], doors: [], barriers: [] },
        roundConfig: { initialWaitTicks: 9999, intermissionTicks: 1 },
        economyConfig: { startingPoints: 5000, hitReward: 10, killBonus: 50 } });
      const player = sim.getPlayer(sim.playerIds[0])!;
      player.yaw = facing;
      sim.tick();
      expect(player.position.y, wall.id).toBeCloseTo(stand.y);
      expect(sim.interactionCandidate(player.id)?.prompt, wall.id).toContain(`[${wall.weaponCost}]`);
    }
  });

  it('buys from the box in the main hall', () => {
    const sim = new GameSimulation({ seed: 5, map: simMap,
      playerSpawns: [{ x: map.boxCenter.x, y: 0, z: map.boxCenter.z + 1.6 }],
      economyConfig: { startingPoints: 3000, hitReward: 10, killBonus: 50 },
      roundConfig: { initialWaitTicks: 9999, intermissionTicks: 9999 } });
    sim.getPlayer(sim.playerIds[0])!.yaw = 0; // Facing north (-z), toward the box.
    expect(interact(sim).some(event => event.type === 'mysteryBoxUsed')).toBe(true);
  });

  it('stops bullets fired up through the balcony', () => {
    const target = createZombieState('e:3', { x: 0, y: UP, z: 1.5 }, 1);
    expect(resolveHitscan({ origin: { x: 0, y: 1.6, z: 1.5 }, direction: { x: 0, y: 1, z: 0 } },
      [target], map.shotBlockers, 60).kind).toBe('world');
  });
});
