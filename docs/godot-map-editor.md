# Godot map authoring

The map editor targets **Godot 4.7 .NET**, with its C# SDK pinned to **4.7.2**. The editor plugin, map nodes, Inspector and smoke check are written in C#. The game runs in the browser with Three.js and consumes the exported JSON.

Install the [.NET edition of Godot 4.7.2](https://godotengine.org/download/archive/4.7.2-stable/) and a 64-bit [.NET SDK](https://dotnet.microsoft.com/download) (8 or newer). The standard Godot download cannot run the C# plugin. The project targets `net8.0`; a newer SDK such as .NET 10 can build it. Node.js is also required for map validation and browser previews.

From the repository root, run:

```text
npm ci
npm run editor:setup
```

Then import/open `tools/godot-map-editor/project.godot` in the **.NET** editor. The **Zombonz Maps** dock appears on the right. If it is disabled, build the project with Godot's **Build** button, then enable **Zombonz Map Authoring** under **Project → Project Settings → Plugins**. Build again after changing C# scripts. An external C# editor can be chosen under **Editor → Editor Settings → Dotnet → Editor**.

`editor:setup` builds the C# project and migrates local scenes that still reference the old GDScript nodes. It preserves transforms and exported values, and saves an original `.tscn.gd-backup` beside each migrated scene. Close Godot before running setup on an existing authoring project. Local scenes and their backups are ignored by Git; keep any unsent level work in JSON by exporting it.

Set the dock's source to `../../src/maps/data/bunker.v1.json` or `../../src/maps/data/asylum.v1.json`, then click **Import map into scene** to generate an authoring scene from the committed JSON. Godot scenes under `maps/` are local editor artifacts; commit the JSON after exporting. The dock provides:

Imported scenes use the **same GLB prop models and environment textures as the browser game**, loaded from `public/assets`. Architecture previews include base color, normal, and packed occlusion/roughness/metallic maps, the map's chosen surface looks, gabled roofs, distinct floor/ceiling surfaces, prisms, and wall decals. Models use the browser's uniform fit, yaw, and foot anchoring, including the crowbar orientation correction. The scene uses neutral authoring lighting; check the game's lighting and procedural gameplay objects with **Export and play in browser**. Gameplay objects remain colored editing markers.

For an existing placeholder scene, click **Refresh models and textures** in the dock. This preserves object transforms and Inspector fields, so you can refresh before exporting unsaved level edits. Also refresh after changing an Asset or Base Size, or resizing an object, to update model fitting and texture repeats. Move the **Prop** or **greybox** parent node, rather than its generated **Art** children. Refresh replaces those preview children. Missing assets are reported in the dock and retain the previous editable view.

The first preview import generates binary resources in ignored `tools/godot-map-editor/preview-cache/`; later imports reuse the cache. Source content hashes invalidate changed assets automatically. Keep this local cache alongside your saved scenes, which reference it. Only the JSON needs committing. If recreating the editor on another machine, import the JSON to rebuild the cache and scenes.

1. **Import map into scene** reads the JSON path in the dock (Bunker by default) and rebuilds its authoring scene. This is useful after editing JSON directly or adding a new object that has nested route points. Import replaces the saved scene, so export existing scene edits first.
2. Select a node in **Geometry**, **Props**, or **Gameplay** and use Godot's move, rotate, and scale tools. The Inspector exposes IDs, costs, weapon IDs, board counts, assets, and other fields on relevant nodes. **Collision** and **Routes** start hidden in the scene tree; enable each group's visibility to edit blocker boxes, navigation nodes, or barrier approach points.
3. Choose an object type and click **Add selected object** to create a prop, greybox, collision box, zombie spawn, barrier, door, wall weapon, barrel hazard, or navigation node. Give it a unique ID in the Inspector where applicable. New barriers get a short default approach route, and new doors get a default blocker; refine their nested points after reimport. New navigation nodes start without neighbors, so connect them in JSON before expecting zombies to use them.
4. **Validate open map** checks common reference and placement mistakes. **Export open map** applies only changed values to the JSON source, runs the TypeScript validator, and saves the scene. It requires `node` on `PATH`. An invalid export leaves the JSON unchanged and shows the error in the dock.
5. **Export and play in browser** runs the export, starts Vite on port 5173, and opens the selected map's start preview. Choose Solo from the game menu for normal round gameplay.

The Godot scene stores editor handles, and the versioned JSON is the browser's source of truth. A newly added object receives its stable JSON path after export; reimport to expose any nested points created by its default template. Additional gameplay systems can add Inspector properties in `addons/zombonz/ZombonzMapItem.cs`, scene handles in `MapScene.cs`, and import/export mappings in `MapDocument.cs`. Their data schema and runtime behavior are defined in TypeScript.

For the C# build and headless editor check, put the Godot .NET executable on `PATH` as `godot`, or set `GODOT` to its full path. On Windows, use the `_console.exe` executable so check output is visible:

```text
npm run editor:check
```

The check starts the actual Godot 4.7 .NET editor with the plugin enabled, then imports **Bunker and Asylum**, checks prop materials and foot anchoring, architecture PBR maps, decals and prisms, saves and reopens textured scenes, verifies untouched maps produce no JSON edits, moves a player spawn and adds a prop, exercises every add-object choice, and exports temporary copies through the same TypeScript validator as the dock. Refresh must preserve level edits and recover from a missing asset. Invalid exports must leave those files unchanged. The committed maps and local authoring scenes are not changed by the smoke test. CI runs the same check with Godot 4.7.2 .NET.

For a visual check, run `res://tests/PreviewCapture.tscn` with the normal renderer (not `--headless`). It renders a prop corner from each map into PNGs in Godot's user data directory, or in an output directory supplied after `--` on the command line. This is an optional verification scene, not the game.
