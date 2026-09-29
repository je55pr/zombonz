import { describe, expect, it } from 'vitest';
import bunkerDocument from '../src/maps/data/bunker.v1.json';
import { BUNKER_MAP } from '../src/maps/bunker.ts';
import { BUNKER_BARRIERS, BUNKER_COLLISION, BUNKER_DOORS, BUNKER_NAVIGATION,
  BUNKER_ZOMBIE_SPAWNS } from '../src/maps/bunkerLegacy.ts';
import { loadMapDocument, toMapDocument, validateMapDocument } from '../src/maps/mapDocument.ts';

describe('versioned map document', () => {
  it('loads the authored Bunker map without losing gameplay or presentation data', () => {
    expect(loadMapDocument(bunkerDocument)).toEqual(BUNKER_MAP);
    expect(toMapDocument(BUNKER_MAP)).toEqual(bunkerDocument);
    expect(BUNKER_MAP.navigation.nodes.length).toBeGreaterThan(50);
    expect(BUNKER_MAP.barriers.length).toBeGreaterThan(0);
    expect(BUNKER_MAP.collisionBoxes).toEqual(BUNKER_COLLISION);
    expect(BUNKER_MAP.navigation).toEqual(BUNKER_NAVIGATION);
    expect(BUNKER_MAP.barriers).toEqual(BUNKER_BARRIERS);
    expect(BUNKER_MAP.zombieSpawns).toEqual(BUNKER_ZOMBIE_SPAWNS);
    expect(BUNKER_MAP.doors).toEqual(BUNKER_DOORS);
  });

  it('reports authorable paths for broken references, geometry and costs', () => {
    const document = structuredClone(bunkerDocument);
    document.gameplay.zombieSpawns[0].barrierId = 'missing';
    document.gameplay.doors[0].cost = -1;
    document.gameplay.collisionBoxes[0].min.x = document.gameplay.collisionBoxes[0].max.x + 1;
    const errors = validateMapDocument(document);
    expect(errors).toContain('gameplay.zombieSpawns[0].barrierId: unknown barrier "missing"');
    expect(errors).toContain('gameplay.doors[0].cost: expected a nonnegative finite cost');
    expect(errors).toContain('gameplay.collisionBoxes[0]: min cannot exceed max on any axis');
  });

  it('carries how likely each zombie look is, and rejects a weight that makes no sense', () => {
    expect(BUNKER_MAP.zombieLooks).toEqual([3, 1]);
    expect(bunkerDocument.gameplay.zombieLooks).toEqual([3, 1]);
    const document = structuredClone(bunkerDocument);
    document.gameplay.zombieLooks = [3, -1];
    expect(validateMapDocument(document)).toContain('gameplay.zombieLooks[1]: expected a nonnegative finite weight');
  });

  it('rejects unsupported versions and duplicate navigation IDs', () => {
    const document = structuredClone(bunkerDocument);
    Object.assign(document, { version: 2 });
    document.gameplay.navigation.nodes[1].id = document.gameplay.navigation.nodes[0].id;
    expect(validateMapDocument(document).some(error => error.startsWith('version:'))).toBe(true);
    expect(validateMapDocument(document).some(error => error.includes('duplicate ID'))).toBe(true);
  });
});
