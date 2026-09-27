import { describe, expect, it } from 'vitest';
import {
  GameSimulation, createInputFrame, createPlayerState, updatePlayerMovement,
  closedDoorBlockers, createDoorState, hasWalkableConnection, navigationWaypoint,
} from '../src/core/index.ts';
import { ASYLUM_MAP } from '../src/maps/asylum.ts';
import { MAPS, MAP_CATALOG } from '../src/maps/index.ts';

const map = ASYLUM_MAP;
const UP = map.upperHeight;
const simMap = { collisionBoxes: [...map.collisionBoxes], walkSurfaces: map.walkSurfaces, zombieSpawns: map.zombieSpawns,
  navigationGraph: map.navigation, doors: map.doors, mysteryBoxes: map.mysteryBoxes, shotBlockers: map.shotBlockers,
  barriers: map.barriers, wallWeapons: map.wallWeapons };
const node = (id: string) => map.navigation.nodes.find(candidate => candidate.id === id)!;
function interact(sim: GameSimulation) {
  const frame = createInputFrame(0);
  frame.actions.interact = { pressed: true, held: true, released: false, value: 1 };
  return sim.tick({ [sim.playerIds[0]]: frame });
}

describe('Verrückt-shaped Asylum', () => {
  it('is selectable and has a two-floor courtyard ring rather than a straight bar', () => {
    expect(MAP_CATALOG.map(entry => entry.id)).toEqual(['bunker', 'asylum']);
    expect(MAPS.asylum).toBe(map);
    expect(map.walkSurfaces.some(s => s.minX === -18 && s.maxX === 18 && s.minZ === 8 && s.maxZ === 18)).toBe(true);
    expect(map.walkSurfaces.some(s => s.minX === -18 && s.maxX === 18 && s.minZ === -18 && s.maxZ === -8)).toBe(true);
    expect(map.walkSurfaces.some(s => s.minX <= 0 && s.maxX >= 0 && s.minZ <= 0 && s.maxZ >= 0)).toBe(false);
    expect(map.walkSurfaces.some(s => s.startHeight === UP && s.endHeight === UP)).toBe(true);
  });

  it('has separated starts, both wing routes, two stairs, a far power room and courtyard entries', () => {
    expect(map.barriers).toHaveLength(21);
    expect(map.windows.filter(w => w.y === UP).length).toBeGreaterThan(10);
    expect(map.doors.map(d => d.id)).toEqual([
      'german-hall', 'american-hall', 'start-gate', 'west-wing', 'east-wing',
      'west-back', 'east-back', 'power-west', 'power-east', 'west-stairs', 'east-stairs',
    ]);
    expect(map.doors.find(d => d.id === 'start-gate')!.position).toMatchObject({ x: 0, z: 13 });
    expect(map.doors.find(d => d.id === 'power-west')!.position.z).toBe(-13);
    expect(map.barriers.some(b => b.id.startsWith('courtyard-'))).toBe(true);
    expect(map.wallWeapons).toHaveLength(10);
    expect(map.mysteryBoxes).toHaveLength(1);
    const ids = [...map.barriers, ...map.doors, ...map.wallWeapons].map(item => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const wall of map.wallWeapons) expect(map.wallWeaponFacing[wall.id], wall.id).toBeDefined();
    for (const door of map.doors) expect(map.doorStyles[door.id], door.id).toBeDefined();
  });

  it('spawns in the German side on a floor', () => {
    const sim = new GameSimulation({ seed: 1, map: simMap, playerSpawns: [map.playerSpawn],
      roundConfig: { initialWaitTicks: 9999, intermissionTicks: 1 } });
    sim.tick();
    expect(sim.getPlayer(sim.playerIds[0])!.position).toMatchObject({ x: -5, y: 0, z: 12 });
  });

  it('only sends zombies through the German starting-room windows while doors are shut', () => {
    const sim = new GameSimulation({ seed: 7, map: simMap, playerSpawns: [map.playerSpawn],
      roundConfig: { initialWaitTicks: 1, intermissionTicks: 10 },
      spawnConfig: { baseZombieCount: 12, additionalPerRound: 0, maxAlive: 12, spawnIntervalTicks: 0 } });
    for (let i = 0; i < 15; i++) sim.tick();
    expect(sim.zombies()).toHaveLength(12);
    const allowed = new Set(['german-south-a', 'german-south-b', 'german-west',
      'courtyard-south-a-0', 'courtyard-south-b-0']);
    for (const zombie of sim.zombies()) expect(allowed.has(zombie.entry!.barrierId)).toBe(true);
  });
});

describe('Asylum traversal', () => {
  it.each(map.doors.flatMap(d => {
    const axis = ['german-hall', 'american-hall', 'west-wing', 'east-wing', 'west-back', 'east-back'].includes(d.id) ? 'x' : 'z';
    if (d.id.endsWith('stairs')) return [{ id: d.id, position: { x: d.position.x, y: 0, z: 3.4 } }];
    return [-1, 1].map(side => ({ id: d.id, position: {
      x: d.position.x + (axis === 'z' ? side * 1.4 : 0), y: 0,
      z: d.position.z + (axis === 'x' ? side * 1.4 : 0),
    } }));
  }))('can buy $id from a floor-side approach', approach => {
    const sim = new GameSimulation({ seed: 3, map: simMap, playerSpawns: [approach.position],
      economyConfig: { startingPoints: 2000, hitReward: 10, killBonus: 50 },
      roundConfig: { initialWaitTicks: 9999, intermissionTicks: 9999 } });
    const player = sim.getPlayer(sim.playerIds[0])!;
    player.yaw = Math.atan2(approach.position.x - map.doors.find(d => d.id === approach.id)!.position.x,
      approach.position.z - map.doors.find(d => d.id === approach.id)!.position.z);
    expect(interact(sim).filter(event => event.type === 'doorOpened')).toEqual([
      { type: 'doorOpened', doorId: approach.id, playerId: sim.playerIds[0] }]);
  });

  it.each([-1, 1])('walks the %i stair up and down', side => {
    const route = [`stair-${side}-foot`, ...Array.from({ length: 13 }, (_, i) => `stair-${side}-${i}`),
      `stair-${side}-head`].map(id => node(id).position);
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

  it('has one supported navigation graph and a node for every zombie landing', () => {
    const byId = new Map(map.navigation.nodes.map(n => [n.id, n]));
    for (const n of map.navigation.nodes) for (const id of n.neighbors) {
      expect(hasWalkableConnection(n.position, byId.get(id)!.position, map.walkSurfaces), `${n.id} -> ${id}`).toBe(true);
    }
    const seen = new Set([map.navigation.nodes[0].id]), stack = [map.navigation.nodes[0].id];
    while (stack.length) for (const id of byId.get(stack.pop()!)!.neighbors) if (!seen.has(id)) { seen.add(id); stack.push(id); }
    expect(seen.size).toBe(map.navigation.nodes.length);
    for (const barrier of map.barriers) expect(byId.has(barrier.id), barrier.id).toBe(true);
  });

  it('keeps the opposite spawn out of reach while the start gate and routes are shut', () => {
    const blockers = [...simMap.collisionBoxes, ...closedDoorBlockers(map.doors.map((d, i) => createDoorState(d, `e:${i + 10}`)))];
    expect(navigationWaypoint(map.navigation, map.playerSpawn, { x: 5, y: 0, z: 12 }, blockers, 0.32, map.walkSurfaces))
      .toBe(map.playerSpawn);
  });

  it('places the box against a wall in the power room', () => {
    const sim = new GameSimulation({ seed: 5, map: simMap,
      playerSpawns: [{ x: map.boxCenter.x, y: 0, z: map.boxCenter.z + 1.6 }],
      economyConfig: { startingPoints: 3000, hitReward: 10, killBonus: 50 },
      roundConfig: { initialWaitTicks: 9999, intermissionTicks: 9999 } });
    sim.getPlayer(sim.playerIds[0])!.yaw = 0;
    expect(interact(sim).some(event => event.type === 'mysteryBoxUsed')).toBe(true);
  });

  it('places every wall weapon within reach of real floor', () => {
    for (const wall of map.wallWeapons) {
      const facing = map.wallWeaponFacing[wall.id];
      const stand = { x: wall.position.x + Math.sin(facing) * 1.2,
        y: wall.position.y - 1, z: wall.position.z + Math.cos(facing) * 1.2 };
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
});
