import { hasClearNavigationLine, sampleWalkHeight } from '../core/index.ts';
import { GameSimulation, type GameSimulationOptions, type SimulationMap } from '../core/simulation.ts';
import type { Vec3 } from '../core/types.ts';
import type { GameMap } from './gameMap.ts';

/** The simulation's view of a map: collision, navigation and everything players can use. */
export function simulationMap(map: GameMap): SimulationMap {
  return {
    collisionBoxes: [...map.collisionBoxes], shotBlockers: map.shotBlockers, walkSurfaces: map.walkSurfaces,
    zombieSpawns: map.zombieSpawns, barriers: map.barriers, navigationGraph: map.navigation, doors: map.doors,
    wallWeapons: map.wallWeapons, mysteryBoxes: map.mysteryBoxes, powerSwitch: map.powerSwitch,
    perkMachines: map.perkMachines, traps: map.traps, hazards: map.hazards, equipment: map.equipment,
    zombieLooks: map.zombieLooks,
  };
}

/** Start positions for `count` players: the map's spawn, then free floor beside it. */
export function playerSpawnPoints(map: GameMap, count: number): Vec3[] {
  const spawn = map.playerSpawn;
  const offsets = [[0, 0], [1.3, 0], [-1.3, 0], [0, 1.3], [0, -1.3], [1.3, 1.3], [-1.3, 1.3], [1.3, -1.3], [-1.3, -1.3],
    [2.6, 0], [-2.6, 0], [0, 2.6], [0, -2.6]];
  const points: Vec3[] = [];
  for (const [dx, dz] of offsets) {
    if (points.length === count) break;
    const point = { x: spawn.x + dx, y: spawn.y, z: spawn.z + dz };
    const floor = sampleWalkHeight(point.x, point.z, spawn.y, map.walkSurfaces);
    if (Math.abs(floor - spawn.y) > 0.01 || !map.walkSurfaces.some(surface => point.x >= surface.minX && point.x <= surface.maxX
      && point.z >= surface.minZ && point.z <= surface.maxZ)) continue;
    // Clear of walls, and able to walk straight back to the main spawn.
    if (!hasClearNavigationLine(point, point, map.collisionBoxes, 0.4) || !hasClearNavigationLine(point, spawn, map.collisionBoxes, 0.3)) continue;
    points.push(point);
  }
  while (points.length < count) points.push({ ...spawn });
  return points;
}

/** The round pacing of a normal match: the first wave straight away, 10 s between rounds. */
export const MATCH_ROUND_CONFIG = { initialWaitTicks: 1, intermissionTicks: 600 } as const;

/**
 * A normal match on `map` for `players` players. Solo, the host and every client build it this same
 * way, so a client's copy lines up with the host's entity for entity.
 */
export function createMatch(map: GameMap, players: number, seed: number,
  overrides: Partial<Omit<GameSimulationOptions, 'map' | 'seed'>> = {}): GameSimulation {
  return new GameSimulation({ seed, map: simulationMap(map), playerSpawns: playerSpawnPoints(map, players),
    roundConfig: MATCH_ROUND_CONFIG, ...overrides });
}
