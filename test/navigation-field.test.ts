import { describe, expect, it } from 'vitest';
import {
  CollisionIndex, closedDoorBlockers, createDoorState, createNavigationQuery, hasClearNavigationLine, moveWithCollision,
  navigationFieldFor, resetWork, work, type CollisionBox, type Vec3,
} from '../src/core/index.ts';
import { ASYLUM_MAP } from '../src/maps/asylum.ts';
import { BUNKER_MAP } from '../src/maps/bunker.ts';
import type { GameMap } from '../src/maps/gameMap.ts';
import { referenceNavigationQuery } from './legacyNavigation.ts';

/** A small seeded generator, so every run asks the same questions. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The map's walls with the doors in `open` open and the rest shut. */
function wallsWith(map: GameMap, open: (id: string) => boolean): { fixed: CollisionBox[]; shut: CollisionBox[] } {
  const doors = map.doors.map((door, index) => createDoorState(door, `e:${index + 10}`));
  for (const door of doors) door.open = open(door.id);
  return { fixed: [...map.collisionBoxes], shut: closedDoorBlockers(doors) };
}

/** Somewhere on the floor: a node with a wander of up to two metres, so some spots crowd walls and some sit inside them. */
function spot(map: GameMap, next: () => number): Vec3 {
  const nodes = map.navigation.nodes, node = nodes[Math.floor(next() * nodes.length)];
  return { x: node.position.x + (next() - 0.5) * 4, y: node.position.y, z: node.position.z + (next() - 0.5) * 4 };
}

describe('the indexed navigation gives the answers of a scan of everything', () => {
  it.each([
    ['Asylum', ASYLUM_MAP, 4],
    ['Bunker', BUNKER_MAP, 3],
  ] as const)('%s, with every door shut, some open and all open', (_, map, configurations) => {
    const next = random(map.navigation.nodes.length);
    const outcomes = { goal: 0, start: 0, node: 0 };
    for (let configuration = 0; configuration < configurations; configuration++) {
      const chance = configuration / (configurations - 1);
      const opens = new Map(map.doors.map(door => [door.id, next() < chance]));
      const { fixed, shut } = wallsWith(map, id => opens.get(id)!);
      const all = [...fixed, ...shut];
      // The walls as the simulation holds them: the map's fixed ones, and the movable ones a shut door adds.
      const fast = navigationFieldFor(map.navigation, map.collisionBoxes, 0.32, map.walkSurfaces).query(shut);
      const reference = referenceNavigationQuery(map.navigation, all, 0.32, map.walkSurfaces);
      const flat = createNavigationQuery(map.navigation, all, 0.32, map.walkSurfaces);
      for (let i = 0; i < 70; i++) {
        const start = spot(map, next), goal = spot(map, next);
        const expected = reference(start, goal);
        // Compare by what it is (the goal, the start, or which node), since positions are shared objects.
        const kind = (answer: Vec3) => answer === goal ? 'goal' : answer === start ? 'start' : `${answer.x},${answer.y},${answer.z}`;
        expect(kind(fast(start, goal)), `door configuration ${configuration}, pair ${i}`).toBe(kind(expected));
        outcomes[expected === goal ? 'goal' : expected === start ? 'start' : 'node']++;
        expect(kind(flat(start, goal)), `flat, configuration ${configuration}, pair ${i}`).toBe(kind(expected));
      }
    }
    // The answers must be a mix of straight at the goal, no way, and a node on a route, or the comparison proves little.
    expect(outcomes.goal).toBeGreaterThan(5);
    expect(outcomes.start).toBeGreaterThan(5);
    expect(outcomes.node).toBeGreaterThan(20);
  }, 120_000);

  it('answers the same for a route between far corners of the map on both floors', () => {
    const map = ASYLUM_MAP, { fixed, shut } = wallsWith(map, () => true);
    const fast = navigationFieldFor(map.navigation, map.collisionBoxes, 0.32, map.walkSurfaces).query(shut);
    const reference = referenceNavigationQuery(map.navigation, [...fixed, ...shut], 0.32, map.walkSurfaces);
    const byId = new Map(map.navigation.nodes.map(node => [node.id, node.position]));
    for (const [from, to] of [['spawn', 'power-north'], ['german-stair-foot', 'kitchen-north'], ['american-south-a', 'left-upstairs-west']]) {
      expect(fast(byId.get(from)!, byId.get(to)!)).toBe(reference(byId.get(from)!, byId.get(to)!));
    }
  });
});

describe('the wall index', () => {
  const boxes = ASYLUM_MAP.collisionBoxes;
  const index = new CollisionIndex(boxes);

  it('agrees with testing every box on whether a line is clear', () => {
    const next = random(11);
    let blocked = 0, clear = 0;
    for (let i = 0; i < 1500; i++) {
      const a = spot(ASYLUM_MAP, next), b = i % 3 === 0 ? spot(ASYLUM_MAP, next)
        : { x: a.x + (next() - 0.5) * 8, y: a.y, z: a.z + (next() - 0.5) * 8 };
      const radius = i % 2 ? 0.32 : 0;
      const expected = !hasClearNavigationLine(a, b, boxes, radius);
      expect(index.blocks(a, b, radius, 1.72), `line ${i}`).toBe(expected);
      if (expected) blocked++; else clear++;
    }
    // The comparison means something only if lines of both kinds were asked.
    expect(blocked).toBeGreaterThan(200);
    expect(clear).toBeGreaterThan(200);
  });

  it('moves a body exactly as moving against every box does', () => {
    const next = random(5);
    for (let i = 0; i < 1500; i++) {
      const at = spot(ASYLUM_MAP, next), delta = { x: (next() - 0.5) * 0.3, y: 0, z: (next() - 0.5) * 0.3 };
      const expected = moveWithCollision(at, delta, 0.32, 1.72, boxes);
      expect(index.move(at, delta, 0.32, 1.72), `move ${i}`).toEqual(expected);
    }
  });

  it('looks at a small part of the map, not all of it', () => {
    resetWork();
    index.blocks({ x: -18, y: 0, z: 9 }, { x: -12, y: 0, z: 12 }, 0.32, 1.72);
    expect(work.navigationBoxTests).toBeLessThan(boxes.length / 5);
  });

  it('copes with no boxes at all', () => {
    const empty = new CollisionIndex([]);
    expect(empty.blocks({ x: 0, y: 0, z: 0 }, { x: 9, y: 0, z: 9 }, 0.3, 1.7)).toBe(false);
    expect(empty.near(0, 0, 5)).toEqual([]);
  });
});
