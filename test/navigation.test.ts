import { describe, expect, it } from 'vitest';
import {
  GameSimulation,
  ZOMBIE_MOVEMENT,
  createPlayerState,
  createZombieState,
  hasClearNavigationLine,
  navigationWaypoint,
  shortestNavigationPath,
  updateZombiePursuit,
  type NavigationGraph,
} from '../src/core/index.ts';
import {
  NACHT_NAVIGATION,
  greyboxCollisionBoxes,
} from '../src/maps/nacht.ts';

const branchGraph: NavigationGraph = {
  nodes: [
    { id: 'start', position: { x: 0, y: 0, z: 0 }, neighbors: ['b', 'a'] },
    { id: 'a', position: { x: 1, y: 0, z: -1 }, neighbors: ['goal'] },
    { id: 'b', position: { x: 1, y: 0, z: 1 }, neighbors: ['goal'] },
    { id: 'goal', position: { x: 2, y: 0, z: 0 }, neighbors: [] },
  ],
};

describe('navigation graph', () => {
  it('chooses deterministic shortest paths when branches tie', () => {
    expect(shortestNavigationPath(branchGraph, 'start', 'goal').map((node) => node.id))
      .toEqual(['start', 'a', 'goal']);
  });
  it('routes pursuit around blocking collision using waypoints', () => {
    const wall = [{ min: { x: 1, y: 0, z: -1 }, max: { x: 2, y: 2, z: 1 } }];
    const graph: NavigationGraph = {
      nodes: [
        { id: 'left', position: { x: 0, y: 0, z: 2 }, neighbors: ['right'] },
        { id: 'right', position: { x: 3, y: 0, z: 2 }, neighbors: ['left'] },
      ],
    };
    const first = navigationWaypoint(graph, { x: 0, y: 0, z: 0 }, { x: 3, y: 0, z: 0 }, wall, 0.32);
    expect(first).toEqual({ x: 0, y: 0, z: 2 });

    const zombie = createZombieState('e:2', { x: 0, y: 0, z: 0 }, 1);
    const player = createPlayerState('e:1', { x: 3, y: 0, z: 0 });
    for (let tick = 0; tick < 600; tick += 1) {
      updateZombiePursuit(zombie, [player], 1 / 60, wall, [], graph);
    }
    expect(zombie.position.x).toBeGreaterThan(2);
    expect(Math.hypot(zombie.position.x - 3, zombie.position.z)).toBeLessThan(1.5);
  });

  it('threads map navigation through GameSimulation pursuit', () => {
    const wall = [{ min: { x: 1, y: 0, z: -1 }, max: { x: 2, y: 2, z: 1 } }];
    const graph: NavigationGraph = { nodes: [
      { id: 'left', position: { x: 0, y: 0, z: 2 }, neighbors: ['right'] },
      { id: 'right', position: { x: 3, y: 0, z: 2 }, neighbors: ['left'] },
    ] };
    const simulation = new GameSimulation({
      seed: 1, map: { collisionBoxes: wall, walkSurfaces: [], zombieSpawns: [{ x: 0, y: 0, z: 0 }], navigationGraph: graph },
      playerSpawns: [{ x: 3, y: 0, z: 0 }], roundConfig: { initialWaitTicks: 1, intermissionTicks: 10 },
      spawnConfig: { baseZombieCount: 1, additionalPerRound: 0, spawnIntervalTicks: 0, maxAlive: 1 },
    });
    for (let tick = 0; tick < 360; tick += 1) simulation.tick();
    expect(simulation.zombies()[0]?.position.x).toBeGreaterThan(2);
  });

  it('keeps every Nacht navigation edge clear of static collision', () => {
    const boxes = greyboxCollisionBoxes();
    const nodes = new Map(NACHT_NAVIGATION.nodes.map((node) => [node.id, node]));
    for (const node of NACHT_NAVIGATION.nodes) {
      for (const neighborId of node.neighbors) {
        const neighbor = nodes.get(neighborId);
        expect(neighbor, `missing neighbor ${neighborId}`).toBeDefined();
        expect(hasClearNavigationLine(
          node.position,
          neighbor!.position,
          boxes,
          ZOMBIE_MOVEMENT.radius,
          ZOMBIE_MOVEMENT.height,
        ), `${node.id} -> ${neighborId}`).toBe(true);
      }
    }
  });
});
