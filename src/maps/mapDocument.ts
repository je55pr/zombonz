import type { GameMap } from './gameMap.ts';

/** Versioned, renderer-independent source file used by the browser and the Godot editor. */
export const MAP_FORMAT_VERSION = 1;

export const GAMEPLAY_FIELDS = [
  'collisionBoxes', 'shotBlockers', 'walkSurfaces', 'navigation', 'playerSpawn',
  'windowBoards', 'barriers', 'zombieSpawns', 'doors', 'wallWeapons',
  'mysteryBoxes', 'powerSwitch', 'perkMachines', 'traps', 'hazards', 'equipment', 'packAPunch', 'zombieLooks',
] as const satisfies readonly (keyof GameMap)[];
export const PRESENTATION_FIELDS = [
  'greybox', 'scenery', 'prisms', 'windows', 'doorStyles', 'wallWeaponFacing',
  'fountain', 'perkMachineFacing', 'equipmentFacing', 'boxCenter', 'boxYaw',
  'boxLocatorBeam', 'rails', 'props', 'decals', 'labels', 'lights', 'rubble',
  'focus', 'grounds', 'trees', 'previews',
] as const satisfies readonly (keyof GameMap)[];

type GameplayField = typeof GAMEPLAY_FIELDS[number];
type PresentationField = typeof PRESENTATION_FIELDS[number];
export interface MapDocumentV1 {
  version: 1;
  metadata: Pick<GameMap, 'id' | 'name' | 'upperHeight'>;
  gameplay: Pick<GameMap, GameplayField>;
  presentation: Pick<GameMap, PresentationField>;
}

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** Paths in diagnostics match the JSON source, so an author can find the bad value. */
export function validateMapDocument(value: unknown): string[] {
  const errors: string[] = [];
  const error = (path: string, message: string) => errors.push(`${path}: ${message}`);
  const vec = (value: unknown, path: string) => {
    if (!record(value) || !finite(value.x) || !finite(value.y) || !finite(value.z))
      error(path, 'expected a finite {x, y, z} position');
  };
  const array = (value: unknown, path: string): unknown[] => {
    if (!Array.isArray(value)) { error(path, 'expected an array'); return []; }
    return value;
  };
  const size = (value: unknown, path: string) => {
    if (!record(value) || !finite(value.x) || !finite(value.y) || !finite(value.z)
      || value.x <= 0 || value.y <= 0 || value.z <= 0)
      error(path, 'expected positive finite x, y, z dimensions');
  };
  const box = (value: unknown, path: string) => {
    if (!record(value)) { error(path, 'expected a box'); return; }
    vec(value.min, `${path}.min`); vec(value.max, `${path}.max`);
    const min = value.min, max = value.max;
    if (record(min) && record(max) && ['x', 'y', 'z'].some(axis =>
      finite(min[axis]) && finite(max[axis]) && min[axis] > max[axis]))
      error(path, 'min cannot exceed max on any axis');
  };
  const ids = (items: unknown[], path: string): Set<string> => {
    const seen = new Set<string>();
    items.forEach((item, i) => {
      const id = record(item) ? item.id : undefined;
      if (!nonempty(id)) error(`${path}[${i}].id`, 'expected a nonempty ID');
      else if (seen.has(id)) error(`${path}[${i}].id`, `duplicate ID "${id}"`);
      else seen.add(id);
    });
    return seen;
  };
  if (!record(value)) return ['map: expected an object'];
  if (value.version !== MAP_FORMAT_VERSION) error('version', `expected ${MAP_FORMAT_VERSION}`);
  const { metadata, gameplay, presentation } = value;
  if (!record(metadata)) error('metadata', 'expected an object');
  if (!record(gameplay)) error('gameplay', 'expected an object');
  if (!record(presentation)) error('presentation', 'expected an object');
  if (!record(metadata) || !record(gameplay) || !record(presentation)) return errors;
  if (!nonempty(metadata.id)) error('metadata.id', 'expected a nonempty ID');
  if (!nonempty(metadata.name)) error('metadata.name', 'expected a nonempty name');
  if (!finite(metadata.upperHeight) || metadata.upperHeight < 0) error('metadata.upperHeight', 'expected a nonnegative finite number');

  vec(gameplay.playerSpawn, 'gameplay.playerSpawn');
  const requiredGameplay = ['collisionBoxes', 'shotBlockers', 'walkSurfaces', 'barriers', 'zombieSpawns', 'doors', 'wallWeapons', 'mysteryBoxes'];
  for (const field of requiredGameplay) array(gameplay[field], `gameplay.${field}`);
  if (!Number.isInteger(gameplay.windowBoards) || (gameplay.windowBoards as number) < 0 || (gameplay.windowBoards as number) > 30)
    error('gameplay.windowBoards', 'expected an integer from 0 to 30');
  for (const field of ['collisionBoxes', 'shotBlockers'] as const)
    array(gameplay[field], `gameplay.${field}`).forEach((item, i) => box(item, `gameplay.${field}[${i}]`));
  array(gameplay.walkSurfaces, 'gameplay.walkSurfaces').forEach((item, i) => {
    const path = `gameplay.walkSurfaces[${i}]`;
    if (!record(item)) { error(path, 'expected a walk surface'); return; }
    for (const key of ['minX', 'maxX', 'minZ', 'maxZ', 'startHeight', 'endHeight'])
      if (!finite(item[key])) error(`${path}.${key}`, 'expected a finite number');
    if (finite(item.minX) && finite(item.maxX) && item.minX > item.maxX
      || finite(item.minZ) && finite(item.maxZ) && item.minZ > item.maxZ)
      error(path, 'minimum bounds cannot exceed maximum bounds');
  });
  const nav = gameplay.navigation;
  const nodes = record(nav) ? array(nav.nodes, 'gameplay.navigation.nodes') : [];
  if (!record(nav)) error('gameplay.navigation', 'expected a graph');
  const nodeIds = ids(nodes, 'gameplay.navigation.nodes');
  nodes.forEach((node, i) => {
    if (!record(node)) return;
    vec(node.position, `gameplay.navigation.nodes[${i}].position`);
    array(node.neighbors, `gameplay.navigation.nodes[${i}].neighbors`).forEach((neighbor, j) => {
      if (!nonempty(neighbor) || !nodeIds.has(neighbor))
        error(`gameplay.navigation.nodes[${i}].neighbors[${j}]`, `unknown node "${String(neighbor)}"`);
    });
  });
  const barriers = array(gameplay.barriers, 'gameplay.barriers');
  const barrierIds = ids(barriers, 'gameplay.barriers');
  barriers.forEach((barrier, i) => {
    if (!record(barrier)) return;
    vec(barrier.position, `gameplay.barriers[${i}].position`);
    vec(barrier.insidePoint, `gameplay.barriers[${i}].insidePoint`);
    if (!finite(barrier.width) || barrier.width <= 0) error(`gameplay.barriers[${i}].width`, 'expected a positive width');
    if (!Number.isInteger(barrier.maxBoards) || (barrier.maxBoards as number) < 0 || (barrier.maxBoards as number) > 30)
      error(`gameplay.barriers[${i}].maxBoards`, 'expected an integer from 0 to 30');
    array(barrier.approachPath, `gameplay.barriers[${i}].approachPath`).forEach((point, j) =>
      vec(point, `gameplay.barriers[${i}].approachPath[${j}]`));
  });
  array(gameplay.zombieSpawns, 'gameplay.zombieSpawns').forEach((spawn, i) => {
    vec(spawn, `gameplay.zombieSpawns[${i}]`);
    if (record(spawn) && spawn.barrierId !== undefined && !barrierIds.has(String(spawn.barrierId)))
      error(`gameplay.zombieSpawns[${i}].barrierId`, `unknown barrier "${String(spawn.barrierId)}"`);
  });
  for (const field of ['doors', 'wallWeapons', 'mysteryBoxes', 'perkMachines', 'traps', 'hazards', 'equipment', 'packAPunch'] as const) {
    if (gameplay[field] === undefined && !['doors', 'wallWeapons', 'mysteryBoxes'].includes(field)) continue;
    array(gameplay[field], `gameplay.${field}`).forEach((item, i) => {
      if (!record(item)) return;
      if (field === 'traps') {
        vec(item.switchPosition, `gameplay.traps[${i}].switchPosition`);
        box(item.zone, `gameplay.traps[${i}].zone`);
      } else vec(item.position, `gameplay.${field}[${i}].position`);
      if (field === 'doors') box(item.blocker, `gameplay.${field}[${i}].blocker`);
      // The machine's body is an axis-aligned box, so it can only face along an axis.
      if (field === 'packAPunch' && (!finite(item.yaw) || Math.abs(Math.sin(2 * item.yaw)) > 1e-6))
        error(`gameplay.packAPunch[${i}].yaw`, 'expected a multiple of a quarter turn (0, pi/2, pi, ...)');
      for (const cost of ['cost', 'weaponCost', 'ammoCost'] as const)
        if (item[cost] !== undefined && (!finite(item[cost]) || item[cost] < 0))
          error(`gameplay.${field}[${i}].${cost}`, 'expected a nonnegative finite cost');
    });
    ids(gameplay[field] as unknown[], `gameplay.${field}`);
  }
  if (gameplay.powerSwitch !== undefined && record(gameplay.powerSwitch)) vec(gameplay.powerSwitch.position, 'gameplay.powerSwitch.position');
  // How likely each zombie look is on this map (index = the look); a look with no weight never spawns.
  if (gameplay.zombieLooks !== undefined) array(gameplay.zombieLooks, 'gameplay.zombieLooks').forEach((weight, i) => {
    if (!finite(weight) || weight < 0) error(`gameplay.zombieLooks[${i}]`, 'expected a nonnegative finite weight');
  });

  for (const field of ['greybox', 'prisms', 'windows', 'rails', 'props', 'decals', 'labels', 'lights', 'rubble'] as const)
    array(presentation[field], `presentation.${field}`);
  for (const field of ['greybox', 'scenery'] as const) {
    if (field === 'scenery' && presentation.scenery === undefined) continue;
    array(presentation[field], `presentation.${field}`).forEach((item, i) => {
      const path = `presentation.${field}[${i}]`;
      if (!record(item)) { error(path, 'expected a greybox'); return; }
      vec(item.center, `${path}.center`);
      size(item.size, `${path}.size`);
    });
  }
  array(presentation.props, 'presentation.props').forEach((item, i) => {
    const path = `presentation.props[${i}]`;
    if (!record(item)) { error(path, 'expected a prop'); return; }
    vec(item.position, `${path}.position`);
    size(item.size, `${path}.size`);
  });
  ids(array(presentation.props, 'presentation.props'), 'presentation.props');
  array(presentation.lights, 'presentation.lights').forEach((light, i) => vec(light, `presentation.lights[${i}]`));
  array(presentation.rails, 'presentation.rails').forEach((rail, i) => {
    if (!record(rail)) { error(`presentation.rails[${i}]`, 'expected a rail'); return; }
    vec(rail.from, `presentation.rails[${i}].from`);
    vec(rail.to, `presentation.rails[${i}].to`);
  });
  vec(presentation.boxCenter, 'presentation.boxCenter');
  if (!finite(presentation.boxYaw)) error('presentation.boxYaw', 'expected a finite angle');
  if (!record(presentation.focus) || !finite(presentation.focus.x) || !finite(presentation.focus.z) || !finite(presentation.focus.radius))
    error('presentation.focus', 'expected finite x, z, radius');
  if (!record(presentation.previews)) error('presentation.previews', 'expected an object');
  // Catch NaN and Infinity in programmatically constructed documents too; JSON.parse already rejects them.
  const scan = (item: unknown, path: string): void => {
    if (typeof item === 'number' && !Number.isFinite(item)) error(path, 'expected a finite number');
    else if (Array.isArray(item)) item.forEach((child, i) => scan(child, `${path}[${i}]`));
    else if (record(item)) for (const [key, child] of Object.entries(item)) scan(child, `${path}.${key}`);
  };
  scan(value, 'map');
  return errors;
}

export function loadMapDocument(value: unknown): GameMap {
  const errors = validateMapDocument(value);
  if (errors.length) throw new Error(`Invalid map document:\n${errors.join('\n')}`);
  const document = value as MapDocumentV1;
  return { ...document.metadata, ...document.gameplay, ...document.presentation };
}

export function toMapDocument(map: GameMap): MapDocumentV1 {
  const pick = <K extends keyof GameMap>(fields: readonly K[]): Pick<GameMap, K> =>
    Object.fromEntries(fields.filter(field => map[field] !== undefined).map(field => [field, map[field]])) as Pick<GameMap, K>;
  return {
    version: MAP_FORMAT_VERSION,
    metadata: pick(['id', 'name', 'upperHeight']),
    gameplay: pick(GAMEPLAY_FIELDS),
    presentation: pick(PRESENTATION_FIELDS),
  };
}
