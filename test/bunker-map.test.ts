import { describe, expect, it } from 'vitest';
import {
  BUNKER_MARKERS,
  BUNKER_PLAYER_SPAWN,
  BUNKER_WALK_SURFACES,
  greyboxCollisionBoxes,
  BUNKER_WINDOWS, BUNKER_DOORS, BUNKER_MYSTERY_BOXES, BUNKER_STAIRS, UPPER_HEIGHT,
  BUNKER_BARRIERS, BUNKER_ZOMBIE_SPAWNS, BUNKER_NAVIGATION,
} from '../src/maps/bunkerLegacy.ts';
import { walkSurfaceHeight, sampleWalkHeight } from '../src/core/collision.ts';
import { PLAN_SCALE, ps, px, pz } from '../src/maps/bunkerPlan.ts';

describe('Bunker greybox contract', () => {
  it('keeps marker ids unique and exposes the planned interaction/spawn points', () => {
    const ids = BUNKER_MARKERS.map((marker) => marker.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(BUNKER_MARKERS.map((marker) => marker.type))).toEqual(
      new Set(['zombieSpawn', 'door', 'wallBuy', 'mysteryBox']),
    );
  });

  it('contains ground and upper walk surfaces', () => {
    expect(BUNKER_WALK_SURFACES.some((surface) => surface.startHeight === 0)).toBe(true);
    expect(BUNKER_WALK_SURFACES.some((surface) => surface.startHeight > 2)).toBe(true);
    expect(BUNKER_PLAYER_SPAWN.y).toBe(0);
  });

  it('exports renderer-independent collision data', () => {
    const boxes = greyboxCollisionBoxes();
    expect(boxes.length).toBeGreaterThan(0);
    expect(JSON.parse(JSON.stringify(boxes))).toEqual(boxes);
  });

  it('matches the reference footprint instead of duplicating a rectangular floor upstairs', () => {
    // Probes are blockout coordinates, mapped onto the built plan like the geometry itself.
    const supported = (x: number, z: number, height: number) => BUNKER_WALK_SURFACES.some(s =>
      s.startHeight === height && s.endHeight === height && walkSurfaceHeight(s, px(x), pz(z)) === height);
    expect(supported(-3, -10, 0)).toBe(true); // long HELP wing
    expect(supported(16, 3, 0)).toBe(true); // broad spawn wing
    expect(supported(12, 7, 0)).toBe(false); // recessed front wall
    expect(supported(5, -8, 0)).toBe(false); // exterior of the L
    expect(supported(16, 3, UPPER_HEIGHT)).toBe(false); // no cloned upper east wing
    expect(BUNKER_WALK_SURFACES.some(s => s.startHeight === UPPER_HEIGHT && s.endHeight === UPPER_HEIGHT
      && walkSurfaceHeight(s, ps(8), ps(1)) === UPPER_HEIGHT)).toBe(false); // main stairwell hole
    expect(supported(-7.05, 5, UPPER_HEIGHT)).toBe(false); // HELP stairwell hole
    expect(supported(3, 2, UPPER_HEIGHT)).toBe(true);
  });

  it('keeps five spawn entries, three HELP entries, four upper windows and three unlocks', () => {
    expect(BUNKER_WINDOWS.filter(w => w.id.startsWith('start-'))).toHaveLength(5);
    expect(BUNKER_WINDOWS.filter(w => w.id.startsWith('help-'))).toHaveLength(3);
    expect(BUNKER_WINDOWS.filter(w => w.y === UPPER_HEIGHT)).toHaveLength(4);
    expect(BUNKER_DOORS).toHaveLength(3);
    expect(BUNKER_MYSTERY_BOXES).toHaveLength(1);
    expect(BUNKER_MYSTERY_BOXES[0].position.x).toBeLessThan(0);
    expect(BUNKER_MYSTERY_BOXES[0].position.z).toBeGreaterThan(6);
  });

  it('connects every upstairs entry to indoor navigation and delays its spawn points', () => {
    const nodes = new Map(BUNKER_NAVIGATION.nodes.map(node => [node.id, node]));
    for (const window of BUNKER_WINDOWS.filter(window => window.y === UPPER_HEIGHT)) {
      const barrier = BUNKER_BARRIERS.find(barrier => barrier.id === window.id);
      expect(barrier).toBeDefined();
      expect(barrier!.maxBoards).toBe(6);
      expect(BUNKER_ZOMBIE_SPAWNS.filter(spawn => spawn.barrierId === window.id)).toHaveLength(3);
      expect(BUNKER_ZOMBIE_SPAWNS.filter(spawn => spawn.barrierId === window.id)
        .every(spawn => spawn.minRound === 4)).toBe(true);
      const seen = new Set([window.id]), queue = [window.id];
      for (const id of queue) for (const next of nodes.get(id)?.neighbors ?? []) {
        if (!seen.has(next)) { seen.add(next); queue.push(next); }
      }
      expect(seen.has('spawn'), window.id).toBe(true);
    }
  });

  it('is laid out at WaW scale: a roomy spawn wing and a long HELP wing, with real-size openings', () => {
    const floors = BUNKER_WALK_SURFACES.filter(s => s.startHeight === 0 && s.endHeight === 0 && !s.polygon);
    const spawn = floors.find(s => s.minX === 0 && s.minZ < 0)!, help = floors.find(s => s.maxX === 0)!;
    expect(spawn.maxX - spawn.minX).toBeGreaterThan(24);
    expect(spawn.maxZ - spawn.minZ).toBeGreaterThan(10);
    expect(help.maxZ - help.minZ).toBeGreaterThan(25);
    expect(help.maxX - help.minX).toBeGreaterThan(8);
    expect(PLAN_SCALE).toBeGreaterThan(1.3);
    // Windows, doorways and the box keep their real sizes as the plan grows.
    expect(BUNKER_WINDOWS.find(w => w.id === 'start-north')!.width).toBe(1.5);
    const helpDoor = BUNKER_DOORS.find(d => d.id === 'help-room')!.blocker!;
    expect(helpDoor.max.z - helpDoor.min.z).toBeCloseTo(2.4);
  });

  it('samples the turning stair continuously and rejects the centre void', () => {
    const turn = BUNKER_WALK_SURFACES.find(s => s.quarterTurn)!;
    for (let i = 0; i <= 20; i++) {
      const angle = -i / 20 * Math.PI / 2;
      expect(walkSurfaceHeight(turn, ps(7.2) + ps(2) * Math.cos(angle), ps(1) + ps(2) * Math.sin(angle))).toBeCloseTo(2.2 * i / 20);
    }
    expect(walkSurfaceHeight(turn, ps(7.3), ps(0.9))).toBeUndefined();
    expect(walkSurfaceHeight(turn, ps(10.4), ps(1))).toBeUndefined();
    for (const stair of BUNKER_STAIRS) for (const point of stair.route)
      expect(sampleWalkHeight(point.x, point.z, point.y, BUNKER_WALK_SURFACES)).toBeCloseTo(point.y);
    expect(JSON.parse(JSON.stringify(BUNKER_WALK_SURFACES))).toEqual(BUNKER_WALK_SURFACES);
  });
});
