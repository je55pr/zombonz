import { describe, expect, it } from 'vitest';
import {
  NACHT_MARKERS,
  NACHT_PLAYER_SPAWN,
  NACHT_WALK_SURFACES,
  greyboxCollisionBoxes,
  NACHT_WINDOWS, NACHT_DOORS, NACHT_MYSTERY_BOXES, NACHT_STAIRS, UPPER_HEIGHT,
} from '../src/maps/nacht.ts';
import { walkSurfaceHeight, sampleWalkHeight } from '../src/core/collision.ts';

describe('Nacht greybox contract', () => {
  it('keeps marker ids unique and exposes the planned interaction/spawn points', () => {
    const ids = NACHT_MARKERS.map((marker) => marker.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(NACHT_MARKERS.map((marker) => marker.type))).toEqual(
      new Set(['zombieSpawn', 'door', 'wallBuy', 'mysteryBox']),
    );
  });

  it('contains ground and upper walk surfaces', () => {
    expect(NACHT_WALK_SURFACES.some((surface) => surface.startHeight === 0)).toBe(true);
    expect(NACHT_WALK_SURFACES.some((surface) => surface.startHeight > 2)).toBe(true);
    expect(NACHT_PLAYER_SPAWN.y).toBe(0);
  });

  it('exports renderer-independent collision data', () => {
    const boxes = greyboxCollisionBoxes();
    expect(boxes.length).toBeGreaterThan(0);
    expect(JSON.parse(JSON.stringify(boxes))).toEqual(boxes);
  });

  it('matches the reference footprint instead of duplicating a rectangular floor upstairs', () => {
    const supported = (x: number, z: number, height: number) => NACHT_WALK_SURFACES.some(s =>
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
    expect(NACHT_WINDOWS.filter(w => w.id.startsWith('start-'))).toHaveLength(5);
    expect(NACHT_WINDOWS.filter(w => w.id.startsWith('help-'))).toHaveLength(3);
    expect(NACHT_WINDOWS.filter(w => w.y === UPPER_HEIGHT)).toHaveLength(4);
    expect(NACHT_DOORS).toHaveLength(3);
    expect(NACHT_MYSTERY_BOXES).toHaveLength(1);
    expect(NACHT_MYSTERY_BOXES[0].position.x).toBeLessThan(0);
    expect(NACHT_MYSTERY_BOXES[0].position.z).toBeGreaterThan(6);
  });

  it('samples the turning stair continuously and rejects the centre void', () => {
    const turn = NACHT_WALK_SURFACES.find(s => s.quarterTurn)!;
    for (let i = 0; i <= 20; i++) {
      const angle = -i / 20 * Math.PI / 2;
      expect(walkSurfaceHeight(turn, 7.2 + 2 * Math.cos(angle), 1 + 2 * Math.sin(angle))).toBeCloseTo(2.2 * i / 20);
    }
    expect(walkSurfaceHeight(turn, 7.3, 0.9)).toBeUndefined();
    expect(walkSurfaceHeight(turn, 10.4, 1)).toBeUndefined();
    for (const stair of NACHT_STAIRS) for (const point of stair.route)
      expect(sampleWalkHeight(point.x, point.z, point.y, NACHT_WALK_SURFACES)).toBeCloseTo(point.y);
    expect(JSON.parse(JSON.stringify(NACHT_WALK_SURFACES))).toEqual(NACHT_WALK_SURFACES);
  });
});
