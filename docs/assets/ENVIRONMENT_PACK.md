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
- `arm.jpg` as packed linear data: **R = ambient occlusion, G = roughness, B = metallic**.

In Three.js the same ARM texture can be assigned to `aoMap`, `roughnessMap`, and `metalnessMap`. Geometry using AO also needs the UV channel expected by the Three.js version in use.

Decals expose whichever of base colour, normal, opacity, roughness, and AO the source provides. Treat opacity/roughness/AO as linear data. The graffiti, leaks, rust, smears and grime are intended as overlays rather than baked wall variants.

## Prop convention

Every prop path in `/assets/props/manifest.json` points to a self-contained GLB. The main prop set uses 1K textures to keep environment dressing inexpensive.

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
