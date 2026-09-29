# Godot map authoring

Open `tools/godot-map-editor/project.godot` with Godot 4.3 or newer. The bundled project was verified with Godot 4.7.2. Install this repository's Node dependencies with `npm install` before exporting. The Godot project is an editor only; the game still runs in the browser with Three.js.

Click **Import map into scene** in the **Zombonz Maps** dock to generate a Bunker authoring scene from the committed JSON. Godot scenes under `maps/` are local editor artifacts; commit the JSON after exporting. The dock provides:

1. **Import map into scene** reads the JSON path in the dock (Bunker by default) and rebuilds its authoring scene. This is useful after editing JSON directly or adding a new object that has nested route points. Import replaces the saved scene, so export existing scene edits first.
2. Select a node in **Geometry**, **Props**, or **Gameplay** and use Godot's move, rotate, and scale tools. The Inspector exposes IDs, costs, weapon IDs, board counts, assets, and other fields on relevant nodes. **Collision** and **Routes** start hidden in the scene tree; enable each group's visibility to edit blocker boxes, navigation nodes, or barrier approach points.
3. Choose an object type and click **Add selected object** to create a prop, greybox, collision box, zombie spawn, barrier, door, wall weapon, barrel hazard, or navigation node. Give it a unique ID in the Inspector where applicable. New barriers get a short default approach route, and new doors get a default blocker; refine their nested points after reimport. New navigation nodes start without neighbors, so connect them in JSON before expecting zombies to use them.
4. **Validate open map** checks common reference and placement mistakes. **Export open map** applies only changed values to the JSON source, runs the TypeScript validator, and saves the scene. It requires `node` on `PATH`. An invalid export leaves the JSON unchanged and shows the error in the dock.
5. **Export and play in browser** runs the export, starts Vite on port 5173, and opens Bunker's fixed development preview. Choose Solo from the game menu for normal round gameplay.

The Godot scene stores editor handles, and the versioned JSON is the browser's source of truth. A newly added object receives its stable JSON path after export; reimport to expose any nested points created by its default template. Additional gameplay systems can add Inspector properties and import/export mappings in `addons/zombonz/plugin.gd`, while their data schema and runtime behavior remain in TypeScript.

For a headless editor smoke check:

```text
godot --headless --editor --path tools/godot-map-editor --script res://smoke_test.gd
```

It imports Bunker, confirms an untouched scene leaves the document unchanged, moves the player spawn in memory, and adds a prop in memory. It does not alter the committed JSON.
