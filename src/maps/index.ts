import { ASYLUM_MAP } from './asylum.ts';
import { BUNKER_MAP } from './bunker.ts';
import type { MapId } from './catalog.ts';
import type { GameMap } from './gameMap.ts';

export const MAPS: Readonly<Record<MapId, GameMap>> = { bunker: BUNKER_MAP, asylum: ASYLUM_MAP };
export { MAP_CATALOG, isMapId, type MapId } from './catalog.ts';
