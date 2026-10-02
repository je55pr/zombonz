# Versioned map documents

Bunker and Asylum are authored in [`src/maps/data/bunker.v1.json`](../src/maps/data/bunker.v1.json) and [`src/maps/data/asylum.v1.json`](../src/maps/data/asylum.v1.json). The browser loads both through `loadMapDocument` in `src/maps/mapDocument.ts`. It does not load the Godot project. `bunkerLegacy.ts` retains the original procedural blockout for older geometry tests; it is not in the browser's map loading path.

## Version 1

The top level has four keys:

```json
{
  "version": 1,
  "metadata": { "id": "bunker", "name": "Bunker", "upperHeight": 3.4 },
  "gameplay": { "playerSpawn": { "x": 0, "y": 0, "z": 0 } },
  "presentation": { "greybox": [] }
}
```

The example omits required arrays. Use either committed document as a complete reference and `GameMap` in `src/maps/gameMap.ts` for field types. All distances are metres; `y` is up, `x` and `z` lie on the floor. Angles are radians.

| Section | Fields | Used by |
| --- | --- | --- |
| `metadata` | `id`, `name`, `upperHeight` | Registry and map selection |
| `gameplay` | Collision and shot blockers, walk surfaces, navigation, player and zombie spawns, how likely each zombie look is (`zombieLooks`, a weight per model), barriers, doors, purchases, power, traps, hazards, equipment, Pack-a-Punch machines (`packAPunch`: position, a quarter-turn `yaw`; the machine's solid body is added by the simulation) | Deterministic simulation |
| `presentation` | Greybox and scenery meshes, prop placements, windows, labels, practical lights, optional atmosphere grade, decals, preview views, other visual anchors | Three.js renderer |

The simulation receives only the gameplay subset through `simulationMap`. IDs on barriers, doors, purchases, and navigation nodes must be unique within their arrays. Navigation neighbor IDs and zombie spawn barrier IDs must exist. A collision box may have a zero width on one axis for a blocker plane, but `min` must never exceed `max`. Costs must be nonnegative. Format versions other than 1 are rejected so changes can be migrated deliberately.

Semantic validation also catches authoring mistakes that are structurally valid JSON but would fail later in play: zombie spawns within 5 cm of another spawn, barrier approach routes with fewer than two points, navigation links that cross fixed collision or leave the authored walk surfaces, and navigation islands unreachable from the component nearest the player spawn. Presentation lookup tables such as door styles and wall-gun/perk/equipment facings may only reference IDs that exist in their gameplay arrays. Practical-light colour/range/flicker/power fields and the optional atmosphere grade are validated at their exact presentation paths; see [lighting and atmosphere](lighting.md). These checks deliberately reuse runtime navigation geometry rather than maintaining a second approximation in the editor.

Run `npm run validate:maps` to validate both committed maps with path-specific errors, or pass file paths after the command for other documents. The command is suitable for CI and `npm run check` includes it alongside tests, type checking, and a browser build. The browser also validates the document when it loads it. In the Godot authoring project, **Validate open map**, import, and export all invoke this same TypeScript validator; the dock displays the same JSON paths you would see on the CLI.

To add another JSON-backed map, create a versioned document, load it through `loadMapDocument`, and register it in `src/maps/index.ts` and `src/maps/catalog.ts`. Extend `GAMEPLAY_FIELDS`, `PRESENTATION_FIELDS`, and `GameMap` together when introducing a new field; then add its runtime or renderer consumer and validator rule.
