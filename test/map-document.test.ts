import { describe, expect, it } from 'vitest';
import bunkerDocument from '../src/maps/data/bunker.v1.json';
import asylumDocument from '../src/maps/data/asylum.v1.json';
import { BUNKER_MAP } from '../src/maps/bunker.ts';
import { ASYLUM_MAP } from '../src/maps/asylum.ts';
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

  it('loads the authored Asylum map with its routes, traps and presentation data', () => {
    expect(loadMapDocument(asylumDocument)).toEqual(ASYLUM_MAP);
    expect(toMapDocument(ASYLUM_MAP)).toEqual(asylumDocument);
    expect(ASYLUM_MAP.barriers).toHaveLength(18);
    expect(ASYLUM_MAP.traps).toHaveLength(2);
    expect(ASYLUM_MAP.navigation.nodes.length).toBeGreaterThan(50);
    expect(ASYLUM_MAP.scenery?.length).toBeGreaterThan(0);
  });

  it('validates authored lighting and atmosphere at exact presentation paths', () => {
    const document = structuredClone(asylumDocument);
    const presentation = document.presentation as any;
    presentation.lights[0].color = 0x1000000;
    presentation.lights[0].unpoweredLevel = 1.5;
    presentation.lights[0].flicker = 'haunted';
    presentation.lights[1].power = 'sometimes';
    presentation.atmosphere = {
      fogColor: -1,
      fogDensity: -0.1,
      exposure: Number.NaN,
      moonOffset: { x: 0, y: Infinity, z: 0 },
    };
    const errors = validateMapDocument(document);
    expect(errors).toContain('presentation.lights[0].color: expected a 24-bit RGB integer');
    expect(errors).toContain('presentation.lights[0].unpoweredLevel: expected 0 to 1');
    expect(errors).toContain('presentation.lights[0].flicker: expected "none" or "fluorescent"');
    expect(errors).toContain('presentation.lights[1].power: expected "always", "dim-until-power", or "power-only"');
    expect(errors).toContain('presentation.atmosphere.fogColor: expected a 24-bit RGB integer');
    expect(errors).toContain('presentation.atmosphere.fogDensity: expected a nonnegative finite number');
    expect(errors).toContain('presentation.atmosphere.exposure: expected a nonnegative finite number');
    expect(errors).toContain('presentation.atmosphere.moonOffset: expected a finite {x, y, z} position');
  });

  it('validates Asylum trap switches and zones at their document paths', () => {
    const document = structuredClone(asylumDocument);
    document.gameplay.traps[0].switchPosition.x = Number.NaN;
    document.gameplay.traps[1].zone.min.x = document.gameplay.traps[1].zone.max.x + 1;
    const errors = validateMapDocument(document);
    expect(errors).toContain('gameplay.traps[0].switchPosition: expected a finite {x, y, z} position');
    expect(errors).toContain('gameplay.traps[1].zone: min cannot exceed max on any axis');
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

  it('catches duplicate zombie spawns and barrier routes that runtime cannot traverse', () => {
    const document = structuredClone(bunkerDocument);
    Object.assign(document.gameplay.zombieSpawns[1], {
      x: document.gameplay.zombieSpawns[0].x,
      y: document.gameplay.zombieSpawns[0].y,
      z: document.gameplay.zombieSpawns[0].z,
    });
    document.gameplay.barriers[0].approachPath = [document.gameplay.barriers[0].approachPath[0]];
    const errors = validateMapDocument(document);
    expect(errors).toContain('gameplay.zombieSpawns[1]: duplicate spawn within 0.05 m of gameplay.zombieSpawns[0]');
    expect(errors).toContain('gameplay.barriers[0].approachPath: expected at least two exterior route points');
  });

  it('catches disconnected and physically blocked navigation before runtime', () => {
    const disconnected = structuredClone(bunkerDocument);
    disconnected.gameplay.navigation.nodes.push({
      id: 'orphan-authoring-node',
      position: { x: 500, y: 0, z: 500 },
      neighbors: [],
    });
    expect(validateMapDocument(disconnected).some(error =>
      error.includes('orphan-authoring-node') && error.includes('unreachable from the player-spawn navigation component'))).toBe(true);

    const blocked = structuredClone(bunkerDocument);
    blocked.gameplay.playerSpawn = { x: 0, y: 0, z: 0 };
    blocked.gameplay.collisionBoxes = [{ min: { x: 0.8, y: 0, z: -1 }, max: { x: 1.2, y: 2, z: 1 } }];
    blocked.gameplay.walkSurfaces = [{ minX: -2, maxX: 4, minZ: -2, maxZ: 2, startHeight: 0, endHeight: 0 }];
    blocked.gameplay.navigation.nodes = [
      { id: 'left', position: { x: 0, y: 0, z: 0 }, neighbors: ['right'] },
      { id: 'right', position: { x: 2, y: 0, z: 0 }, neighbors: ['left'] },
    ];
    const errors = validateMapDocument(blocked);
    expect(errors).toContain('gameplay.navigation.nodes[0].neighbors[0]: link "left" -> "right" crosses fixed collision');
    expect(errors.some(error => error.includes('node "right" is unreachable'))).toBe(true);
  });

  it('rejects stale presentation lookup IDs instead of silently orphaning authoring metadata', () => {
    const document = structuredClone(asylumDocument);
    Object.assign(document.presentation.wallWeaponFacing, { 'missing-wall-gun': 0 });
    Object.assign(document.presentation.doorStyles, { 'missing-door': { kind: 'planks', yaw: 0, width: 2 } });
    const errors = validateMapDocument(document);
    expect(errors).toContain('presentation.wallWeaponFacing.missing-wall-gun: unknown gameplay.wallWeapons ID "missing-wall-gun"');
    expect(errors).toContain('presentation.doorStyles.missing-door: unknown gameplay.doors ID "missing-door"');
  });
});
