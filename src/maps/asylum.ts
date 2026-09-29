import type { GameMap } from './gameMap.ts';
import asylumDocument from './data/asylum.v1.json';
import { loadMapDocument } from './mapDocument.ts';

/** Asylum is authored in JSON, shared by the browser runtime and the Godot map editor. */
export const ASYLUM_MAP: GameMap = loadMapDocument(asylumDocument);
