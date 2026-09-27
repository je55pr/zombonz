# Environment and prop runtime pack

This pack is the browser-ready environment dressing library for Zombonz. Source archives and research metadata stay outside Git; only runtime derivatives are committed.

## Runtime layout

- `/assets/environment/manifest.json` indexes 10 PBR materials and 5 decal sets.
- `/assets/props/manifest.json` indexes 18 general props and 3 background military vehicles.
- `/assets/manifest.json` links both packs alongside the existing zombie and weapon assets.

### Environment material convention

Each tileable material uses:

- `basecolor.webp` in sRGB.
- `normal.webp` as an OpenGL tangent-space normal map in linear colour space.
- `arm.webp` as packed linear data: **R = ambient occlusion, G = roughness, B = metallic**.

Every material and decal map is stored at 1024 px as WebP, the size the game decodes it at
(`ENVIRONMENT_TEXTURE_SIZE`). The 2K originals were re-encoded on 2026-09-27 by
`scripts/weapon-convert/shrink-environment.mjs` (59.1 MB to 10.6 MB); the untouched 2K downloads
remain in the external asset cache.

In Three.js the same ARM texture can be assigned to `aoMap`, `roughnessMap`, and `metalnessMap`. Geometry using AO also needs the UV channel expected by the Three.js version in use.

Decals expose whichever of base colour, normal, opacity, roughness, and AO the source provides. Treat opacity/roughness/AO as linear data. The graffiti, leaks, rust, smears and grime are intended as overlays rather than baked wall variants.

## Prop convention

Every prop path in `/assets/props/manifest.json` points to a self-contained GLB. The main prop set uses 1K textures to keep environment dressing inexpensive. On 2026-09-27 their high-quality JPEG textures were re-encoded as WebP at the same 1K size, and textures no material used were dropped (`recompress.mjs`): 43 MB to 19 MB.

Especially useful first-pass props include:

- explosive barrel
- wooden plank
- incandescent bulb
- caged wall and ceiling lights
- metal jerrycan
- ammo box
- wooden crate
- shelves, table and ladder
- WWII-style field radio
- barrel stove
- hand truck
- crowbar and bench vice
- cement bag and damaged cardboard box

The project-created wooden plank is 1.8 m × 0.18 m × 0.035 m and uses the CC0 `worn_planks` Poly Haven material.

## Vehicles

The GAZ-67, Soviet off-road vehicle and T-12 light tank are CC0 OpenGameArt conversions. They load correctly as GLBs but are intentionally tagged `background` in the manifest because their visual fidelity is lower than the realistic Poly Haven prop set. Use them outside windows, behind rubble, or as distant exterior silhouettes rather than hero props.

## Licensing and source preservation

The environment and prop packs are CC0. Exact source URLs are carried in their manifests and in `public/assets/ATTRIBUTION.txt`.

Untouched source packages, API metadata and checksums remain outside Git under:

- `C:\ChatGPT\Shared\Cache\ZombonzAssets\environment-textures`
- `C:\ChatGPT\Shared\Cache\ZombonzAssets\props`

Do not copy those source caches into the repository.

## In-game integration

The Bunker map uses all ten material sets: plaster/brick wall panels, concrete
structure, damaged floors, concrete steps, wood boards/box, rusted rails, cave rock,
ground dirt, rubble, and leather on the two stair barricades. World-scaled UVs keep
the tile size consistent. Base colour uses sRGB, and normal/ARM use linear data;
the same ARM image feeds AO (R), roughness (G), and metalness (B), using UV channel 0.

`environmentMaterials.ts` shares materials and textures across the level. Images
are decoded at 1024 square before GPU upload, which is also the size they are stored at,
so no bytes are downloaded only to be discarded.
Grime/leak overlays use their opacity maps, do not write depth, and have polygon
offset to avoid flickering against the walls. The modern graffiti atlas is left out.

`bunkerProps.ts` places 31 props across spawn, HELP, upstairs and the exterior:
workbenches, radio, ammunition, shelves, crates, fuel containers, stove, tools,
ladder, cart, bags, lamps, a jeep and a tank. Vehicles stay in the background.
Props are scenery, not new pickups/explosive gameplay objects. Existing barriers,
box logic, doors, weapons and zombie state are unchanged.

Models are uniformly fitted into authored metre-scale envelopes, floor-aligned,
cloned without modifying the source, then spatially batched with compatible vertex
layouts. Solid indoor props use renderer-independent collision boxes from those
same envelopes. Small clutter is deliberately non-blocking. Downloading/failed
solid props have visible box proxies so their collision never becomes invisible.

The load status is shown in the HUD. Failures leave usable materials/proxies and
report a warning; F2 includes CC0 environment credits alongside the existing CC BY
character/weapon credits. Source asset files remain unmodified.

Validation includes every selected GLB's transformed bounds and floor anchoring,
manifest/file coverage, packed material maps, UV scale, compatible static batching,
clear stair/entry landings and the full deterministic gameplay suite. Development
preview `?preview=props` inspects the radio/box corner; `?preview=stress&weapon=bar`
checks 24 imported zombies with the dressed map (F3 for frame timings).
