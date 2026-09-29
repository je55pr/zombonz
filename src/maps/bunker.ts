import type { GameMap } from './gameMap.ts';
import bunkerDocument from './data/bunker.v1.json';
import { loadMapDocument } from './mapDocument.ts';

/** Bunker is authored in JSON. Godot exports this same file for the browser runtime. */
export const BUNKER_MAP: GameMap = loadMapDocument(bunkerDocument);
