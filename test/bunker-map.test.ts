import { describe, expect, it } from 'vitest';
import {
  BUNKER_MARKERS,
  BUNKER_PLAYER_SPAWN,
  BUNKER_WALK_SURFACES,
  greyboxCollisionBoxes,
  BUNKER_WINDOWS, BUNKER_DOORS, BUNKER_MYSTERY_BOXES, BUNKER_STAIRS, UPPER_HEIGHT,
} from '../src/maps/bunker.ts';
import { walkSurfaceHeight, sampleWalkHeight } from '../src/core/collision.ts';

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
    const supported = (x: number, z: number, height: number) => BUNKER_WALK_SURFACES.some(s =>
      s.startHeight === height && s.endHeight === height && walkSurfaceHeight(s, x, z) === height);
    expect(supported(-3, -10, 0)).toBe(true); // long HELP wing
    expect(supported(16, 3, 0)).toBe(true); // broad spawn wing
    expect(supported(12, 7, 0)).toBe(false); // recessed front wall
    expect(supported(5, -8, 0)).toBe(false); // exterior of the L
    expect(supported(16, 3, UPPER_HEIGHT)).toBe(false); // no cloned upper east wing
    expect(supported(8, 1, UPPER_HEIGHT)).toBe(false); // main stairwell hole
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

  it('samples the turning stair continuously and rejects the centre void', () => {
    const turn = BUNKER_WALK_SURFACES.find(s => s.quarterTurn)!;
    for (let i = 0; i <= 20; i++) {
      const angle = -i / 20 * Math.PI / 2;
      expect(walkSurfaceHeight(turn, 7.2 + 2 * Math.cos(angle), 1 + 2 * Math.sin(angle))).toBeCloseTo(2.2 * i / 20);
    }
    expect(walkSurfaceHeight(turn, 7.3, 0.9)).toBeUndefined();
    expect(walkSurfaceHeight(turn, 10.4, 1)).toBeUndefined();
    for (const stair of BUNKER_STAIRS) for (const point of stair.route)
      expect(sampleWalkHeight(point.x, point.z, point.y, BUNKER_WALK_SURFACES)).toBeCloseTo(point.y);
    expect(JSON.parse(JSON.stringify(BUNKER_WALK_SURFACES))).toEqual(BUNKER_WALK_SURFACES);
  });
});
