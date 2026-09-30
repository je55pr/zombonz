import { describe, expect, it } from 'vitest';
import {
  CONTACT, GameSimulation, STALL, ZOMBIE_MELEE, ZOMBIE_MOVEMENT, addEntity, allocateEntityId, createNavigationQuery, createPlayerState,
  createZombieEntry, createZombieState, freeSpotNear, hasClearNavigationLine, moveWithCollision, pushOutOfBoxes, separateZombies, trackZombieProgress,
  updateZombiePursuit, resetWork, work, type CollisionBox, type NavigationGraph, type PlayerState, type Vec3, type WalkSurface, type ZombieState,
} from '../src/core/index.ts';
import { STUCK_SECONDS, runAsylumTraining, runBunkerRoute } from '../src/bench/scenarios.ts';
import { BUNKER_MAP } from '../src/maps/bunker.ts';
import { ASYLUM_MAP } from '../src/maps/asylum.ts';
import { compileNavigation } from '../src/maps/mapBuild.ts';
import { simulationMap } from '../src/maps/match.ts';

const R = ZOMBIE_MOVEMENT.radius;
const box = (x0: number, x1: number, z0: number, z1: number, y1 = 3): CollisionBox => ({ min: { x: x0, y: 0, z: z0 }, max: { x: x1, y: y1, z: z1 } });

/** A 24 x 16 m floor with a wall down the middle from the north edge to z = 10, leaving a gap at the south to go round by. */
function arena() {
  const wall = box(11.8, 12.2, 0, 10);
  const surfaces: WalkSurface[] = [{ minX: 0, maxX: 24, minZ: 0, maxZ: 16, startHeight: 0, endHeight: 0 }];
  const boxes = [wall];
  const graph: NavigationGraph = compileNavigation(surfaces, boxes, { minX: 0.5, maxX: 23.5, minZ: 0.5, maxZ: 15.5 }, [0], []);
  return { wall, surfaces, boxes, graph, query: createNavigationQuery(graph, boxes, R, surfaces) };
}

/** Runs one zombie's pursuit, and the player where they stand, for up to `seconds`; the seconds it took to get within reach, or null. */
function chase(zombie: ZombieState, player: PlayerState, boxes: readonly CollisionBox[], surfaces: readonly WalkSurface[],
  graph: NavigationGraph, seconds: number): number | null {
  const query = createNavigationQuery(graph, boxes, R, surfaces);
  for (let tick = 0; tick < seconds * 60; tick++) {
    updateZombiePursuit(zombie, [player], 1 / 60, boxes, surfaces, graph, query);
    if (Math.hypot(player.position.x - zombie.position.x, player.position.z - zombie.position.z) < ZOMBIE_MELEE.reach.startRange) return (tick + 1) / 60;
  }
  return null;
}

describe('a zombie against a wall', () => {
  const { wall, boxes } = arena();
  // Exactly where moveWithCollision leaves a zombie that has walked into the wall from the west.
  const touching = () => moveWithCollision({ x: 5, y: 0, z: 5 }, { x: 20, y: 0, z: 0 }, R, 1.72, boxes);

  it('is left on the edge of the wall\'s margin, and not inside it', () => {
    const at = touching();
    expect(at.x).toBe(wall.min.x - R);
    expect(pushOutOfBoxes(at, R, 1.72, boxes)).toBeNull();
  });

  it('has a clear line straight away from the wall, along it and diagonally off it, but not into it', () => {
    const at = touching();
    expect(hasClearNavigationLine(at, { x: at.x - 3, y: 0, z: at.z }, boxes, R)).toBe(true);
    expect(hasClearNavigationLine(at, { x: at.x, y: 0, z: at.z + 3 }, boxes, R)).toBe(true);
    expect(hasClearNavigationLine(at, { x: at.x, y: 0, z: at.z - 3 }, boxes, R)).toBe(true);
    expect(hasClearNavigationLine(at, { x: at.x - 2, y: 0, z: at.z + 2 }, boxes, R)).toBe(true);
    expect(hasClearNavigationLine(at, { x: at.x + 3, y: 0, z: at.z }, boxes, R)).toBe(false);
    expect(hasClearNavigationLine(at, { x: at.x + 2, y: 0, z: at.z + 2 }, boxes, R)).toBe(false);
  });

  it('still cannot walk through the wall, or slip past its end by a hair', () => {
    expect(hasClearNavigationLine({ x: 5, y: 0, z: 5 }, { x: 20, y: 0, z: 5 }, boxes, R)).toBe(false);
    // Along the wall's end, closer than the body allows, is blocked; farther is clear.
    expect(hasClearNavigationLine({ x: 11.8, y: 0, z: 10 + R - 0.01 }, { x: 12.2, y: 0, z: 10 + R - 0.01 }, boxes, R)).toBe(false);
    expect(hasClearNavigationLine({ x: 11.8, y: 0, z: 10 + R + 0.01 }, { x: 12.2, y: 0, z: 10 + R + 0.01 }, boxes, R)).toBe(true);
  });

  it('walks off the wall and round its end to the player on the other side', () => {
    const { surfaces, graph } = arena();
    const zombie = createZombieState('e:2', touching(), 15, 'sprint');
    const player = createPlayerState('e:1', { x: 16, y: 0, z: 5 });
    const seconds = chase(zombie, player, boxes, surfaces, graph, 30);
    expect(seconds).not.toBeNull();
    expect(seconds!).toBeLessThan(15);
    expect(zombie.stall).toBeLessThan(10);
  });

  it('every wall in Asylum can be walked away from, along and off diagonally, from where a zombie is left against it', () => {
    const asylum = ASYLUM_MAP.collisionBoxes;
    let checked = 0;
    for (const w of asylum) {
      if (w.max.y - w.min.y < 2 || w.min.y > 0.5) continue;
      const midX = (w.min.x + w.max.x) / 2, midZ = (w.min.z + w.max.z) / 2;
      const faces: Array<[Vec3, Vec3, Vec3]> = [
        [{ x: w.min.x - R, y: 0, z: midZ }, { x: -1, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }],
        [{ x: w.max.x + R, y: 0, z: midZ }, { x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }],
        [{ x: midX, y: 0, z: w.min.z - R }, { x: 0, y: 0, z: -1 }, { x: 1, y: 0, z: 0 }],
        [{ x: midX, y: 0, z: w.max.z + R }, { x: 0, y: 0, z: 1 }, { x: 1, y: 0, z: 0 }],
      ];
      for (const [at, out, along] of faces) {
        const away = { x: at.x + out.x, y: 0, z: at.z + out.z }, beside = { x: at.x + along.x * 0.8, y: 0, z: at.z + along.z * 0.8 };
        // Only where the spot is genuinely free of every other wall and the room to move is too.
        const others = asylum.filter(b => b !== w);
        if ([at, away, beside].some(p => pushOutOfBoxes(p, R + 0.05, 1.72, others))
          || !hasClearNavigationLine(at, away, others, R - 0.05) || !hasClearNavigationLine(at, beside, others, R - 0.05)) continue;
        checked++;
        expect(hasClearNavigationLine(at, away, asylum, R), JSON.stringify(at)).toBe(true);
        expect(hasClearNavigationLine(at, beside, asylum, R), JSON.stringify(at)).toBe(true);
      }
    }
    // A meaningful number of real wall faces, or the loop above proved nothing.
    expect(checked).toBeGreaterThan(100);
  });
});

describe('a zombie inside a wall\'s margin', () => {
  const { wall, surfaces, graph, boxes } = arena();

  it('is put back on the nearest edge, never carried through the wall', () => {
    const west = pushOutOfBoxes({ x: wall.min.x - R + 0.15, y: 0, z: 5 }, R, 1.72, boxes)!;
    expect(west.x).toBe(wall.min.x - R);
    expect(west.z).toBe(5);
    const east = pushOutOfBoxes({ x: wall.max.x + R - 0.15, y: 0, z: 5 }, R, 1.72, boxes)!;
    expect(east.x).toBe(wall.max.x + R);
    // Near the end of the wall it is pushed out of the end.
    const end = pushOutOfBoxes({ x: 12, y: 0, z: 10 + R - 0.1 }, R, 1.72, boxes)!;
    expect(end.z).toBe(10 + R);
    // Not inside any: nothing to do; a wall on another floor is no matter.
    expect(pushOutOfBoxes({ x: 5, y: 0, z: 5 }, R, 1.72, boxes)).toBeNull();
    expect(pushOutOfBoxes({ x: 12, y: 3.5, z: 5 }, R, 1.72, boxes)).toBeNull();
    expect(pushOutOfBoxes({ x: wall.min.x - R + CONTACT / 2, y: 0, z: 5 }, R, 1.72, boxes)).toBeNull();
  });

  it('goes round a corner: pushed out of one wall it does not stay in the next', () => {
    const corner = [box(0, 5, 0, 0.4), box(0, 0.4, 0, 5)];
    const out = pushOutOfBoxes({ x: 0.5, y: 0, z: 0.5 }, R, 1.72, corner)!;
    expect(pushOutOfBoxes(out, R, 1.72, corner)).toBeNull();
  });

  it('gets out and on to the player', () => {
    const zombie = createZombieState('e:2', { x: wall.min.x - R + 0.15, y: 0, z: 5 }, 15, 'sprint');
    const player = createPlayerState('e:1', { x: 16, y: 0, z: 5 });
    const query = createNavigationQuery(graph, boxes, R, surfaces);
    updateZombiePursuit(zombie, [player], 1 / 60, boxes, surfaces, graph, query);
    expect(zombie.position.x).toBeLessThanOrEqual(wall.min.x - R + 1e-9);
    expect(chase(zombie, player, boxes, surfaces, graph, 30)).not.toBeNull();
  });

  it('is freed when the box (or anything else) is put down on top of it', () => {
    const arrived = { min: { x: 4.5, y: 0, z: 4.5 }, max: { x: 5.5, y: 1, z: 5.5 } };
    const zombie = createZombieState('e:2', { x: 5, y: 0, z: 5 }, 15, 'run');
    const player = createPlayerState('e:1', { x: 3, y: 0, z: 9 });
    updateZombiePursuit(zombie, [player], 1 / 60, [...boxes, arrived], surfaces, graph);
    expect(pushOutOfBoxes(zombie.position, R, 1.72, [arrived])).toBeNull();
    expect(Math.hypot(zombie.position.x - 5, zombie.position.z - 5)).toBeLessThan(1.2);
  });
});

describe('a crowd pressed against a wall', () => {
  const { wall, surfaces, graph, boxes } = arena();

  it('gives way to the wall: a shove the wall stops is passed on to the other zombie', () => {
    const face = wall.min.x - R;
    const a = createZombieState('e:2', { x: face, y: 0, z: 5 }, 1), b = createZombieState('e:3', { x: face - 0.2, y: 0, z: 5 }, 1);
    // b is on the open side (west) of a, which is against the wall: a cannot go east, so b must go further west.
    separateZombies([a, b], [], boxes, surfaces);
    expect(a.position.x).toBe(face);
    expect(Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z)).toBeGreaterThanOrEqual(R * 2 * 0.9 - 1e-9);
  });

  it('still pushes two free zombies apart half each', () => {
    const a = createZombieState('e:2', { x: 5, y: 0, z: 5 }, 1), b = createZombieState('e:3', { x: 5.2, y: 0, z: 5 }, 1);
    separateZombies([a, b], [], boxes, surfaces);
    expect(a.position.x).toBeCloseTo(5 - (R * 1.8 - 0.2) / 2);
    expect(b.position.x).toBeCloseTo(5.2 + (R * 1.8 - 0.2) / 2);
  });

  it('all get past the wall to the player, none left standing against it', () => {
    const player = createPlayerState('e:1', { x: 18, y: 0, z: 5 });
    const zombies = Array.from({ length: 12 }, (_, i) => createZombieState(`e:${i + 2}`,
      { x: wall.min.x - R - (i % 3) * 0.35, y: 0, z: 2 + Math.floor(i / 3) * 0.7 }, 15, i % 2 ? 'sprint' : 'run'));
    const query = createNavigationQuery(graph, boxes, R, surfaces);
    const got = new Set<string>();
    for (let tick = 0; tick < 60 * 40 && got.size < zombies.length; tick++) {
      for (const zombie of zombies) updateZombiePursuit(zombie, [player], 1 / 60, boxes, surfaces, graph, query);
      separateZombies(zombies, [player], boxes, surfaces);
      for (const zombie of zombies) if (Math.hypot(player.position.x - zombie.position.x, player.position.z - zombie.position.z) < 3) got.add(zombie.id);
    }
    expect(got.size).toBe(zombies.length);
  });
});

describe('a zombie that cannot get anywhere', () => {
  const stand = (x: number, z: number) => createZombieState('e:2', { x, y: 0, z }, 1, 'run');

  it('counts the ticks it meant to move and stayed put, and starts again when it gets on', () => {
    const zombie = stand(0, 0);
    for (let i = 0; i < 10; i++) trackZombieProgress(zombie, true);
    expect(zombie.stall).toBe(10);
    // Shuffling about within a fifth of a metre is still staying put.
    zombie.position = { x: 0.1, y: 0, z: -0.1 };
    trackZombieProgress(zombie, true);
    expect(zombie.stall).toBe(11);
    zombie.position = { x: 0.5, y: 0, z: 0 };
    trackZombieProgress(zombie, true);
    expect(zombie.stall).toBe(0);
    // ...and it is counted from where it now is.
    trackZombieProgress(zombie, true);
    expect(zombie.stall).toBe(1);
    expect([zombie.anchorX, zombie.anchorZ]).toEqual([0.5, 0]);
  });

  it('does not count a zombie that has nowhere to go or is swinging', () => {
    const zombie = stand(0, 0);
    zombie.stall = 30;
    trackZombieProgress(zombie, false);
    expect(zombie.stall).toBe(0);
    // A zombie with nobody to hunt, or standing to swing, is not stalled either.
    const player = createPlayerState('e:1', { x: 0.5, y: 0, z: 0 });
    zombie.stall = 30;
    updateZombiePursuit(zombie, [player], 1 / 60, [], []);
    expect(zombie.stall).toBe(0);
    updateZombiePursuit(zombie, [], 1 / 60, [], []);
    expect(zombie.stall).toBe(0);
  });

  it('is not counted as stalled while it is on its way', () => {
    const { surfaces, graph, boxes } = arena();
    const zombie = createZombieState('e:2', { x: 3, y: 0, z: 3 }, 15, 'run');
    const player = createPlayerState('e:1', { x: 8, y: 0, z: 3 });
    const query = createNavigationQuery(graph, boxes, R, surfaces);
    let most = 0;
    for (let i = 0; i < 120; i++) { updateZombiePursuit(zombie, [player], 1 / 60, boxes, surfaces, graph, query); most = Math.max(most, zombie.stall); }
    expect(most).toBeLessThan(10);
  });

  it('finds a free spot near it for one that is stuck, never across a wall', () => {
    // An alcove open to the east, three metres deep; a zombie in the back with the wall behind it.
    const alcove = [box(0, 0.4, 0, 3), box(0, 3.4, -0.4, 0), box(0, 3.4, 3, 3.4)];
    const surfaces: WalkSurface[] = [{ minX: -2, maxX: 8, minZ: -2, maxZ: 6, startHeight: 0, endHeight: 0 }];
    const zombie = createZombieState('e:2', { x: 0.4 + R, y: 0, z: 1.5 }, 1, 'run');
    const spot = freeSpotNear(zombie, { x: 8, y: 0, z: 1.5 }, alcove, surfaces, 1.72)!;
    expect(spot).not.toBeNull();
    expect(Math.hypot(spot.x - zombie.position.x, spot.z - zombie.position.z)).toBeLessThanOrEqual(2.01);
    expect(pushOutOfBoxes(spot, R, 1.72, alcove)).toBeNull();
    expect(hasClearNavigationLine(zombie.position, spot, alcove, 0, 1.72)).toBe(true);
    // Nearest the way it was heading: east, out of the alcove.
    expect(spot.x).toBeGreaterThan(zombie.position.x);
  });

  it('is relocated after three seconds stalled, to a spot on its own side of a wall', () => {
    const { wall, surfaces, graph, boxes } = arena();
    const zombie = createZombieState('e:2', { x: wall.min.x - R, y: 0, z: 5 }, 15, 'sprint');
    const player = createPlayerState('e:1', { x: 16, y: 0, z: 5 });
    const query = createNavigationQuery(graph, boxes, R, surfaces);
    zombie.stall = STALL.relocateTicks;
    resetWork();
    const before = { ...zombie.position };
    updateZombiePursuit(zombie, [player], 1 / 60, boxes, surfaces, graph, query);
    const moved = Math.hypot(zombie.position.x - before.x, zombie.position.z - before.z);
    expect(moved).toBeGreaterThanOrEqual(0.5 - 1e-9);
    expect(moved).toBeLessThanOrEqual(2 + 1e-9);
    expect(zombie.position.x).toBeLessThanOrEqual(wall.min.x - R + 1e-9);
    expect(hasClearNavigationLine(before, zombie.position, boxes, 0, 1.72)).toBe(true);
    expect(zombie.stall).toBe(0);
    expect(work.stuckRecoveries).toBe(1);
  });

  it('finds nowhere for one that is walled in, and stays where it is', () => {
    const pen = [box(-0.7, 0.7, -0.7, -0.5), box(-0.7, 0.7, 0.5, 0.7), box(-0.7, -0.5, -0.7, 0.7), box(0.5, 0.7, -0.7, 0.7)];
    const surfaces: WalkSurface[] = [{ minX: -20, maxX: 20, minZ: -20, maxZ: 20, startHeight: 0, endHeight: 0 }];
    const zombie = createZombieState('e:2', { x: 0, y: 0, z: 0 }, 1, 'run');
    expect(freeSpotNear(zombie, { x: 9, y: 0, z: 0 }, pen, surfaces, 1.72)).toBeNull();

    // In a match: the zombie tries for minutes and neither crosses a wall nor makes a fuss.
    const graph: NavigationGraph = { nodes: [
      { id: 'a', position: { x: 5, y: 0, z: 0 }, neighbors: ['b'] }, { id: 'b', position: { x: 9, y: 0, z: 0 }, neighbors: ['a'] }] };
    const sim = new GameSimulation({ seed: 1, map: { collisionBoxes: pen, walkSurfaces: surfaces, zombieSpawns: [], navigationGraph: graph },
      playerSpawns: [{ x: 9, y: 0, z: 0 }], roundConfig: { initialWaitTicks: 9_999_999, intermissionTicks: 1 } });
    sim.getPlayer(sim.playerIds[0])!.godMode = true;
    addEntity(sim.state.world, createZombieState(allocateEntityId(sim.state.world), { x: 0, y: 0, z: 0 }, 1, 'sprint'));
    let stalled = 0;
    for (let tick = 0; tick < 60 * 30; tick++) {
      sim.tick();
      const zombie = sim.zombies()[0];
      expect(Math.abs(zombie.position.x) <= 0.5 && Math.abs(zombie.position.z) <= 0.5, `tick ${tick}: ${JSON.stringify(zombie.position)}`).toBe(true);
      stalled = Math.max(stalled, zombie.stall);
    }
    // It noticed, and (having nowhere to go) kept trying at a measured pace rather than every tick.
    expect(stalled).toBeGreaterThanOrEqual(STALL.relocateTicks - STALL.retryTicks);
  });
});

describe('a zombie on the Bunker\'s HELP stairs', () => {
  it('no longer dithers between two waypoints where the far one is only just in sight', () => {
    // Found by the benchmark: at this spot the far node was in sight, a centimetre further it was not, so the zombie
    // stepped toward it, then back to the nearer one, and stood there dithering for good.
    const map = BUNKER_MAP;
    const sim = new GameSimulation({ seed: 1, map: { ...simulationMap(map), zombieSpawns: [] }, playerSpawns: [{ x: 5.2, y: 0, z: 4.2 }],
      roundConfig: { initialWaitTicks: 999_999, intermissionTicks: 999_999 } });
    sim.getPlayer(sim.playerIds[0])!.godMode = true;
    for (const door of sim.state.doors) if (door.id !== 'help-room') door.open = true;
    const zombie = createZombieState(allocateEntityId(sim.state.world), { x: -9.535, y: 2.549382276049935, z: 7.778504281755681 }, 1, 'walk');
    zombie.moveSpeed = 0.8; // the gait's own speed, whatever pace its id would give it
    addEntity(sim.state.world, zombie);
    for (let tick = 0; tick < 60 * 8; tick++) sim.tick();
    expect(Math.hypot(zombie.position.x + 9.535, zombie.position.z - 7.7785)).toBeGreaterThan(3);
  });
});

describe('a player where no navigation node can be walked to', () => {
  it('does not stop the round spawning', () => {
    // A player boxed into a pen: no node is in sight from there. Every spawn point used to count as having no route to
    // them, so nothing spawned until they moved.
    const pen = [box(-0.7, 0.7, -0.7, -0.5), box(-0.7, 0.7, 0.5, 0.7), box(-0.7, -0.5, -0.7, 0.7), box(0.5, 0.7, -0.7, 0.7)];
    const surfaces: WalkSurface[] = [{ minX: -20, maxX: 20, minZ: -20, maxZ: 20, startHeight: 0, endHeight: 0 }];
    const graph: NavigationGraph = { nodes: [
      { id: 'a', position: { x: 5, y: 0, z: 0 }, neighbors: ['b'] }, { id: 'b', position: { x: 9, y: 0, z: 0 }, neighbors: ['a'] }] };
    const sim = new GameSimulation({ seed: 1, map: { collisionBoxes: pen, walkSurfaces: surfaces, zombieSpawns: [{ x: 9, y: 0, z: 5 }], navigationGraph: graph },
      playerSpawns: [{ x: 0, y: 0, z: 0 }], roundConfig: { initialWaitTicks: 1, intermissionTicks: 600 },
      spawnConfig: { baseZombieCount: 3, additionalPerRound: 0, spawnIntervalTicks: 5, maxAlive: 3 } });
    sim.getPlayer(sim.playerIds[0])!.godMode = true;
    for (let tick = 0; tick < 120; tick++) sim.tick();
    expect(sim.zombies().length).toBe(3);
  });
});

describe('doorways and stairs', () => {
  const map = ASYLUM_MAP, byId = new Map(map.navigation.nodes.map(node => [node.id, node.position]));

  /** Zombies start at the given nodes and a player stands at another, with every door open: seconds until each is in reach. */
  function crossing(from: readonly string[], to: string, seconds: number): Array<number | null> {
    const sim = new GameSimulation({ seed: 1, map: { ...simulationMap(map), zombieSpawns: [] }, playerSpawns: [byId.get(to)!],
      roundConfig: { initialWaitTicks: 2147483647, intermissionTicks: 2147483647 } });
    const player = sim.getPlayer(sim.playerIds[0])!;
    player.godMode = true;
    sim.state.power.on = true;
    for (const door of sim.state.doors) door.open = true;
    const zombies = from.map((id, index) => {
      const zombie = createZombieState(allocateEntityId(sim.state.world), { ...byId.get(id)! }, 15, index % 2 ? 'sprint' : 'run');
      addEntity(sim.state.world, zombie);
      return zombie;
    });
    const arrived: Array<number | null> = zombies.map(() => null);
    for (let tick = 0; tick < seconds * 60; tick++) {
      sim.tick();
      zombies.forEach((zombie, index) => {
        if (arrived[index] === null && Math.hypot(player.position.x - zombie.position.x, player.position.z - zombie.position.z) < 2.5
          && Math.abs(player.position.y - zombie.position.y) < 1) arrived[index] = tick / 60;
      });
      if (arrived.every(time => time !== null)) break;
    }
    return arrived;
  }

  const doorways = map.doors.map(door => door.id).filter(id => byId.has(`${id}--1`) && byId.has(`${id}-1`));
  it('has a pair of nodes either side of every door that is not a stair', () => {
    expect(doorways).toHaveLength(map.doors.length - 2);
  });

  it.each(doorways.flatMap(id => [[id, `${id}--1`, `${id}-1`], [id, `${id}-1`, `${id}--1`]]))(
    'lets a zombie through the %s doorway from %s to %s', (_, from, to) => {
      const [seconds] = crossing([from], to, 30);
      expect(seconds, `${from} to ${to}`).not.toBeNull();
    }, 60_000);

  it.each([['german', 'german-stair-foot', 'german-stair-head'], ['american', 'american-stair-foot', 'american-stair-head']])(
    'lets a zombie up and down the %s stair', (_, foot, head) => {
      expect(crossing([foot], head, 40)[0], 'up').not.toBeNull();
      expect(crossing([head], foot, 40)[0], 'down').not.toBeNull();
    }, 60_000);

  it.each(doorways)('lets a crowd of six through the %s doorway both ways, none left behind', id => {
    const side = (sign: string) => {
      const centre = byId.get(`${id}-${sign}`)!;
      return map.navigation.nodes.filter(node => node.position.y === centre.y
        && Math.hypot(node.position.x - centre.x, node.position.z - centre.z) < 4.5
        && Math.hypot(node.position.x - byId.get(`${id}-${sign === '-1' ? '1' : '-1'}`)!.x, node.position.z - byId.get(`${id}-${sign === '-1' ? '1' : '-1'}`)!.z)
          > Math.hypot(node.position.x - centre.x, node.position.z - centre.z))
        .sort((a, b) => Math.hypot(a.position.x - centre.x, a.position.z - centre.z) - Math.hypot(b.position.x - centre.x, b.position.z - centre.z)
          || a.id.localeCompare(b.id)).slice(0, 6).map(node => node.id);
    };
    for (const [from, to] of [[side('-1'), `${id}-1`], [side('1'), `${id}--1`]] as const) {
      expect(from.length).toBeGreaterThanOrEqual(4);
      const times = crossing(from, to, 45);
      expect(times.filter(time => time === null), `${from.join(',')} to ${to}`).toHaveLength(0);
    }
  }, 120_000);
});

describe('the benchmark routes', () => {
  it('leave no zombie stuck on the Bunker', () => {
    const bunker = runBunkerRoute({ ticks: 900 });
    expect(bunker.stalls.stuckZombies).toBe(0);
    expect(bunker.stalls.longestSeconds).toBeLessThan(STUCK_SECONDS);
  }, 60_000);

  it('keep 24 zombies moving through a lap of Asylum with doors opening as the player passes', () => {
    const train = runAsylumTraining({ ticks: 2400, warmup: 60 });
    expect(train.stalls.stuckZombies).toBe(0);
    expect(train.stalls.longestSeconds).toBeLessThan(STUCK_SECONDS);
    // Stuck-agent recovery is a last resort, not something that runs all the time.
    expect(train.workPerTick.stuckRecoveries).toBeLessThan(0.05);
  }, 60_000);
});
