import { describe, expect, it } from 'vitest';
import { GameSimulation, createInputFrame, hasClearNavigationLine, type Vec3 } from '../src/core/index.ts';
import type { BarrierDefinition } from '../src/core/barrier.ts';
import { MAPS } from '../src/maps/index.ts';
import type { GameMap } from '../src/maps/gameMap.ts';

/** Zombies spread across three lanes, half a metre apart, on their way to a window. */
const LANES = [-0.5, 0, 0.5];
const inLane = (barrier: BarrierDefinition, point: Vec3, lane: number): Vec3 =>
  ({ x: point.x + barrier.outward.z * lane, y: point.y, z: point.z - barrier.outward.x * lane });
/** Horizontal distance from a point to a segment. */
function distanceToSegment(p: { x: number; z: number }, a: Vec3, b: Vec3): number {
  const dx = b.x - a.x, dz = b.z - a.z, length = dx * dx + dz * dz;
  const t = length ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / length)) : 0;
  return Math.hypot(p.x - (a.x + dx * t), p.z - (a.z + dz * t));
}
/** Every leg a zombie can walk on its way in: from each spawn spot onto the route, then along it, in every lane. */
function legs(map: GameMap): Array<{ barrier: BarrierDefinition; label: string; a: Vec3; b: Vec3 }> {
  return map.barriers.flatMap(barrier => LANES.flatMap(lane => {
    const path = barrier.approachPath.map(point => inLane(barrier, point, lane));
    return [
      ...map.zombieSpawns.filter(spawn => spawn.barrierId === barrier.id)
        .map((spawn, index) => ({ barrier, label: `${barrier.id} spawn ${index} lane ${lane}`, a: spawn, b: path[1] })),
      ...path.slice(1).map((b, index) => ({ barrier, label: `${barrier.id} leg ${index} lane ${lane}`, a: path[index], b })),
    ];
  }));
}

describe.each(Object.values(MAPS))('$name entry routes', map => {
  if (map.id === 'bunker') it.each(map.barriers.filter(barrier => barrier.position.y > 0)
    .map(barrier => ({ id: barrier.id })))('repairs upstairs barrier $id from its landing', ({ id }) => {
    const definition = map.barriers.find(barrier => barrier.id === id)!;
    const sim = new GameSimulation({ seed: 22,
      map: { collisionBoxes: map.collisionBoxes, walkSurfaces: map.walkSurfaces, zombieSpawns: [],
        barriers: map.barriers, doors: map.doors, navigationGraph: map.navigation, shotBlockers: map.shotBlockers },
      playerSpawns: [definition.insidePoint], roundConfig: { initialWaitTicks: 9999, intermissionTicks: 9999 } });
    const barrier = sim.state.barriers.find(barrier => barrier.id === id)!;
    barrier.boards = barrier.maxBoards - 1;
    const frame = createInputFrame(0);
    frame.actions.interact = { pressed: true, held: true, released: false, value: 1 };
    let repaired = false;
    for (let tick = 0; tick <= 60; tick++) {
      repaired ||= sim.tick({ [sim.playerIds[0]]: frame }).some(event => event.type === 'barrierBoardRepaired'
        && event.barrierId === id);
    }
    expect(repaired).toBe(true);
    expect(barrier.boards).toBe(barrier.maxBoards);
  });
  it('brings every entry\'s zombies from well out, three spots each, inside the grounds', () => {
    for (const barrier of map.barriers) {
      const spawns = map.zombieSpawns.filter(spawn => spawn.barrierId === barrier.id);
      expect(spawns, barrier.id).toHaveLength(3);
      const start = barrier.approachPath[0];
      // The collapsed tunnel behind Bunker's cave breach is only so long.
      expect(Math.hypot(start.x - barrier.position.x, start.z - barrier.position.z), barrier.id)
        .toBeGreaterThan(barrier.id === 'help-cave' ? 7 : 12);
      for (const spawn of spawns) {
        expect(spawn.x > map.grounds!.minX + 1 && spawn.x < map.grounds!.maxX - 1
          && spawn.z > map.grounds!.minZ + 1 && spawn.z < map.grounds!.maxZ - 1, `${barrier.id} ${spawn.x},${spawn.z}`).toBe(true);
      }
    }
  });

  it('keeps every lane of every route clear of walls, scenery and props, climbing only straight up', () => {
    for (const { label, a, b } of legs(map)) {
      if (Math.abs(a.y - b.y) > 1e-6) {
        expect(Math.hypot(a.x - b.x, a.z - b.z), label).toBeLessThan(1e-6);
        continue;
      }
      expect(hasClearNavigationLine(a, b, map.collisionBoxes, 0.33), label).toBe(true);
    }
  });

  it('plants no tree where zombies walk', () => {
    for (const tree of map.trees ?? []) for (const { label, a, b } of legs(map)) {
      expect(distanceToSegment(tree, a, b), `${tree.x},${tree.z} on ${label}`).toBeGreaterThan(1.2);
    }
  });

  it.each(map.barriers.map(barrier => ({ id: barrier.id })))('brings a zombie all the way in through $id', ({ id }) => {
    const sim = new GameSimulation({ seed: 21,
      map: { collisionBoxes: [...map.collisionBoxes], walkSurfaces: map.walkSurfaces, navigationGraph: map.navigation,
        zombieSpawns: map.zombieSpawns.filter(spawn => spawn.barrierId === id).slice(0, 1)
          .map(spawn => ({ ...spawn, minRound: 1 })), barriers: map.barriers,
        doors: map.doors, shotBlockers: map.shotBlockers },
      playerSpawns: [map.playerSpawn], roundConfig: { initialWaitTicks: 1, intermissionTicks: 9999 },
      spawnConfig: { baseZombieCount: 1, additionalPerRound: 0, spawnIntervalTicks: 1, maxAlive: 1 } });
    // Every room open, so every entry leads to the player.
    for (const door of sim.state.doors) door.open = true;
    sim.getPlayer(sim.playerIds[0])!.godMode = true;
    let entered = false;
    for (let tick = 0; tick < 60 * 60 && !entered; tick++) {
      entered = sim.tick().some(event => event.type === 'zombieEntered' && event.barrierId === id);
    }
    expect(entered).toBe(true);
  });
});
