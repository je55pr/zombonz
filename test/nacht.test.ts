import { describe, expect, it } from 'vitest';
import {
  NACHT_MARKERS,
  NACHT_PLAYER_SPAWN,
  NACHT_WALK_SURFACES,
  greyboxCollisionBoxes,
} from '../src/maps/nacht.ts';

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
});
