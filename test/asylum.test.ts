import { describe, expect, it } from 'vitest';
import {
  GameSimulation, createInputFrame, createPlayerState, createZombieState, updatePlayerMovement, updateZombiePursuit,
  closedDoorBlockers, createDoorState, createNavigationQuery, hasWalkableConnection, navigationWaypoint, resolveHitscan,
  sampleWalkHeight,
} from '../src/core/index.ts';
import { ASYLUM_MAP, ASYLUM_STAIR_ROUTES, ASYLUM_UPPER_ENTRIES } from '../src/maps/asylum.ts';
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
/** The floor height at a point on the given storey, or undefined where there is no floor there. */
const floorAt = (x: number, z: number, y: number) => map.walkSurfaces
  .some(s => x > s.minX && x < s.maxX && z > s.minZ && z < s.maxZ && s.startHeight === y && s.endHeight === y)
  ? sampleWalkHeight(x, z, y, map.walkSurfaces) : undefined;
/** World collision plus every door that is not listed as open. */
const blockersWithOpen = (...open: string[]) => {
  const doors = map.doors.map((d, i) => createDoorState(d, `e:${i + 10}`));
  for (const door of doors) door.open = open.includes(door.id);
  return [...simMap.collisionBoxes, ...closedDoorBlockers(doors)];
};
const GERMAN_START = map.playerSpawn, AMERICAN_START = { x: 9, y: 0, z: 12 }, POWER_ROOM = { x: -9, y: UP, z: -26 };
const GERMAN_ROUTE = ['german-stairs', 'left-upstairs', 'power-west'];
const AMERICAN_ROUTE = ['american-hallway', 'american-stairs', 'right-upstairs', 'kitchen', 'power-east'];

describe('Asylum follows Verrückt', () => {
  it('is selectable beside Bunker', () => {
    expect(MAP_CATALOG.map(entry => entry.id)).toEqual(['bunker', 'asylum']);
    expect(MAPS.asylum).toBe(map);
  });

  it('wraps two storeys around an open courtyard at the original scale', () => {
    for (const [x, z] of [[-1.5, -11.5], [-15, -17], [12, -5]]) {
      expect(floorAt(x, z, 0), `${x},${z}`).toBeUndefined();
      expect(floorAt(x, z, UP), `${x},${z}`).toBeUndefined();
    }
    // Starts to the south, the German balcony west, the hallway with its balcony above to the east,
    // and the power room and kitchen upstairs along the north.
    expect(floorAt(-18, 9, 0)).toBe(0);
    expect(floorAt(-24, -8, UP)).toBe(UP);
    expect(floorAt(18, -12, 0)).toBe(0);
    expect(floorAt(18, -12, UP)).toBe(UP);
    expect(floorAt(-9, -26, UP)).toBe(UP);
    expect(floorAt(8, -26, UP)).toBe(UP);
    // About 60 x 51 m overall, as measured from the original's effect placements.
    const xs = map.walkSurfaces.flatMap(s => [s.minX, s.maxX]), zs = map.walkSurfaces.flatMap(s => [s.minZ, s.maxZ]);
    expect(Math.max(...xs) - Math.min(...xs)).toBe(60);
    expect(Math.max(...zs) - Math.min(...zs)).toBe(51);
  });

  it('keeps the power room and box upstairs at the far end', () => {
    expect(floorAt(-9, -26, 0)).toBeUndefined();
    expect(map.boxCenter.y).toBeCloseTo(UP + 0.52);
    expect(map.boxCenter.z).toBeLessThan(-30);
    expect(map.doors.filter(d => d.id.startsWith('power-')).map(d => d.position.y)).toEqual([UP, UP]);
  });

  it('has the original entries, unlocks and wall buys', () => {
    const ground = map.barriers.filter(b => b.position.y === 0).map(b => b.id);
    expect(ground.filter(id => id.startsWith('german-'))).toHaveLength(4);
    expect(ground.filter(id => id.startsWith('american-'))).toHaveLength(3);
    expect(ground.filter(id => id.startsWith('hallway-'))).toHaveLength(2);
    expect(ground).toHaveLength(9);
    // Upstairs: one on the German balcony, two in Left Upstairs, two on the right balcony, one each
    // in the Speed Cola room, kitchen and power room.
    expect(new Set(map.barriers.filter(b => b.position.y === UP && b.maxBoards > 0).map(b => b.id))).toEqual(new Set(ASYLUM_UPPER_ENTRIES));
    // Plus the German balcony's open climb over the railing.
    expect(map.barriers.filter(b => b.maxBoards === 0).map(b => b.id)).toEqual(['german-balcony-railing']);
    for (const id of ASYLUM_UPPER_ENTRIES) {
      const inside = map.barriers.find(b => b.id === id)!.insidePoint;
      expect(floorAt(inside.x, inside.z, UP), id).toBe(UP);
    }
    expect(Object.fromEntries(map.doors.map(d => [d.id, d.cost]))).toEqual({
      'start-gate': 0, 'german-stairs': 1000, 'left-upstairs': 750, 'power-west': 1000,
      'american-hallway': 750, 'bar-room': 750, 'american-stairs': 1000, 'right-upstairs': 750, kitchen: 1000, 'power-east': 750,
    });
    expect(Object.fromEntries(map.wallWeapons.map(w => [w.id, `${w.weaponId}:${w.weaponCost}`]))).toMatchObject({
      'german-kar98k': 'kar98k:200', 'german-gewehr': 'm1-garand:600', 'american-garand': 'm1-garand:600',
      'american-springfield': 'springfield:200', 'hallway-thompson': 'thompson:1200', 'back-room-bar': 'bar:2500',
      'german-balcony-mp40': 'mp40:1000', 'left-upstairs-stg44': 'stg44:1200', 'left-upstairs-trench-gun': 'trench-gun:1500',
      'speed-cola-sawed-off': 'double-barrel:1200',
    });
    expect(map.wallWeapons).toHaveLength(14);
    expect(map.mysteryBoxes).toHaveLength(1);
    const ids = [...map.barriers, ...map.doors, ...map.wallWeapons].map(item => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const wall of map.wallWeapons) expect(map.wallWeaponFacing[wall.id], wall.id).toBeDefined();
    for (const door of map.doors) expect(map.doorStyles[door.id], door.id).toBeDefined();
  });

  it('starts solo in the German room and only brings zombies through its four windows at first', () => {
    const sim = new GameSimulation({ seed: 7, map: simMap, playerSpawns: [map.playerSpawn],
      roundConfig: { initialWaitTicks: 1, intermissionTicks: 10 },
      spawnConfig: { baseZombieCount: 16, additionalPerRound: 0, maxAlive: 16, spawnIntervalTicks: 0 } });
    for (let i = 0; i < 20; i++) sim.tick();
    expect(sim.getPlayer(sim.playerIds[0])!.position.y).toBe(0);
    expect(sim.zombies()).toHaveLength(16);
    expect(new Set(sim.zombies().map(zombie => zombie.entry!.barrierId))).toEqual(
      new Set(['german-west', 'german-south', 'german-alcove', 'german-courtyard']));
  });
  it('brings zombies in through the upstairs windows of the rooms players reach', () => {
    const sim = new GameSimulation({ seed: 11, map: simMap, playerSpawns: [{ x: -24, y: UP, z: -26 }],
      roundConfig: { initialWaitTicks: 1, intermissionTicks: 10 },
      spawnConfig: { baseZombieCount: 6, additionalPerRound: 0, maxAlive: 6, spawnIntervalTicks: 0 } });
    const player = sim.getPlayer(sim.playerIds[0])!;
    const entered: string[] = [];
    for (let i = 0; i < 60 * 40 && entered.length === 0; i++) {
      player.godMode = true;
      for (const event of sim.tick()) if (event.type === 'zombieEntered') entered.push(event.zombieId);
    }
    expect(new Set(sim.zombies().map(zombie => zombie.entry?.barrierId).filter(Boolean)))
      .toEqual(new Set(['left-upstairs-west', 'left-upstairs-north']));
    expect(entered.length).toBeGreaterThan(0);
    expect(sim.zombies().find(zombie => zombie.id === entered[0])!.position.y).toBeCloseTo(UP);
  });
  it('brings zombies up the courtyard wall and over the German balcony railing', () => {
    const sim = new GameSimulation({ seed: 3, map: simMap, playerSpawns: [{ x: -24, y: UP, z: -16 }],
      roundConfig: { initialWaitTicks: 1, intermissionTicks: 10 },
      spawnConfig: { baseZombieCount: 8, additionalPerRound: 0, maxAlive: 8, spawnIntervalTicks: 0 } });
    const player = sim.getPlayer(sim.playerIds[0])!;
    player.godMode = true;
    let climbed: `e:${number}` | undefined;
    for (let i = 0; i < 60 * 40 && !climbed; i++) {
      for (const event of sim.tick()) if (event.type === 'zombieEntered' && event.barrierId === 'german-balcony-railing') climbed = event.zombieId;
    }
    expect(climbed).toBeDefined();
    const zombie = sim.state.world.entities[climbed!];
    expect(zombie.position.y).toBeCloseTo(UP);
    expect(zombie.position.x).toBeLessThan(map.barriers.find(b => b.id === 'german-balcony-railing')!.position.x);
  });
});

describe('Asylum routes', () => {
  it.each(map.doors.filter(d => !d.requiresPower).flatMap(d => {
    if (d.id.endsWith('-stairs')) {
      // Stair debris is cleared from the foot of its stair.
      const route = d.id === 'german-stairs' ? ASYLUM_STAIR_ROUTES.german : ASYLUM_STAIR_ROUTES.american;
      return [{ id: d.id, position: route[0].position }];
    }
    const alongZ = d.blocker.max.x - d.blocker.min.x < 1;
    return [-1, 1].map(side => ({ id: d.id, position: {
      x: d.position.x + (alongZ ? side * 1.4 : 0), y: d.position.y, z: d.position.z + (alongZ ? 0 : side * 1.4) } }));
  }))('buys $id from an accessible side', approach => {
    const door = map.doors.find(d => d.id === approach.id)!;
    const sim = new GameSimulation({ seed: 3, map: simMap, playerSpawns: [approach.position],
      economyConfig: { startingPoints: 2000, hitReward: 10, killBonus: 50 },
      roundConfig: { initialWaitTicks: 9999, intermissionTicks: 9999 } });
    const player = sim.getPlayer(sim.playerIds[0])!;
    player.yaw = Math.atan2(approach.position.x - door.position.x, approach.position.z - door.position.z);
    expect(interact(sim).filter(event => event.type === 'doorOpened')).toEqual([
      { type: 'doorOpened', doorId: approach.id, playerId: sim.playerIds[0] }]);
  });

  it.each(['german', 'american'] as const)('walks the %s stair up to its balcony and back down', side => {
    const route = ASYLUM_STAIR_ROUTES[side].map(point => point.position);
    const forward = createInputFrame(0);
    forward.actions.moveForward = { pressed: true, held: true, released: false, value: 1 };
    const player = createPlayerState('e:1', route[0]);
    const walk = (points: readonly typeof route[number][]) => {
      for (const point of points) {
        let ticks = 0;
        while (Math.hypot(player.position.x - point.x, player.position.z - point.z) > 0.08 && ticks++ < 240) {
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

  it('has one supported navigation graph with a node at every zombie landing', () => {
    const byId = new Map(map.navigation.nodes.map(n => [n.id, n]));
    for (const n of map.navigation.nodes) for (const id of n.neighbors) {
      expect(hasWalkableConnection(n.position, byId.get(id)!.position, map.walkSurfaces), `${n.id} -> ${id}`).toBe(true);
    }
    const seen = new Set([map.navigation.nodes[0].id]), stack = [map.navigation.nodes[0].id];
    while (stack.length) for (const id of byId.get(stack.pop()!)!.neighbors) if (!seen.has(id)) { seen.add(id); stack.push(id); }
    expect(seen.size).toBe(map.navigation.nodes.length);
    for (const barrier of map.barriers) expect(byId.has(barrier.id), barrier.id).toBe(true);
  });

  it('keeps the starts apart until the power door opens', () => {
    expect(navigationWaypoint(map.navigation, GERMAN_START, AMERICAN_START, blockersWithOpen(), 0.32, map.walkSurfaces))
      .toBe(GERMAN_START);
  });

  it('reaches the power room from each start by its own route, and neither route joins the starts', () => {
    const german = blockersWithOpen(...GERMAN_ROUTE), american = blockersWithOpen(...AMERICAN_ROUTE);
    expect(navigationWaypoint(map.navigation, GERMAN_START, POWER_ROOM, german, 0.32, map.walkSurfaces)).not.toBe(GERMAN_START);
    expect(navigationWaypoint(map.navigation, AMERICAN_START, POWER_ROOM, american, 0.32, map.walkSurfaces)).not.toBe(AMERICAN_START);
    expect(navigationWaypoint(map.navigation, GERMAN_START, AMERICAN_START, german, 0.32, map.walkSurfaces)).toBe(GERMAN_START);
    expect(navigationWaypoint(map.navigation, AMERICAN_START, GERMAN_START, american, 0.32, map.walkSurfaces)).toBe(AMERICAN_START);
  });

  it.each([['German', GERMAN_ROUTE, GERMAN_START], ['American', AMERICAN_ROUTE, AMERICAN_START]] as const)(
    'lets a runner chase from the power room down to the %s start', (_, route, start) => {
      const blockers = blockersWithOpen(...route);
      const zombie = createZombieState('e:2', POWER_ROOM, 1, 'run');
      const player = createPlayerState('e:1', start);
      const query = createNavigationQuery(map.navigation, blockers, 0.32, map.walkSurfaces);
      const gap = () => Math.hypot(zombie.position.x - player.position.x, zombie.position.z - player.position.z);
      for (let i = 0; i < 60 * 90 && gap() >= 1.5; i++) {
        updateZombiePursuit(zombie, [player], 1 / 60, blockers, map.walkSurfaces, map.navigation, query);
      }
      expect(zombie.position.y).toBeCloseTo(0);
      expect(gap()).toBeLessThan(1.5);
    }, 30_000);

  it('buys from the box upstairs in the power room', () => {
    const sim = new GameSimulation({ seed: 5, map: simMap,
      playerSpawns: [{ x: map.boxCenter.x, y: UP, z: map.boxCenter.z + 1.6 }],
      economyConfig: { startingPoints: 3000, hitReward: 10, killBonus: 50 },
      roundConfig: { initialWaitTicks: 9999, intermissionTicks: 9999 } });
    sim.getPlayer(sim.playerIds[0])!.yaw = 0;
    expect(interact(sim).some(event => event.type === 'mysteryBoxUsed')).toBe(true);
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

  it('stops bullets fired up through the right balcony from the hallway', () => {
    const target = createZombieState('e:3', { x: 18, y: UP, z: 0 }, 1);
    expect(resolveHitscan({ origin: { x: 18, y: 1.6, z: 0 }, direction: { x: 0, y: 1, z: 0 } },
      [target], map.shotBlockers, 60).kind).toBe('world');
  });
});

describe('Asylum box locator', () => {
  it('moves the box between spots with nothing marking where it went', () => {
    expect(map.mysteryBoxes[0].locations?.length).toBeGreaterThan(1);
    expect(map.boxLocatorBeam).toBeFalsy();
  });
});
