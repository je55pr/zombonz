# Zombonz third-party asset shortlist

Verified 2026-09-19. This file records source provenance before any third-party art is imported into the game.

## Policy

- Prefer assets whose source page explicitly permits commercial use and modification.
- Keep original source archives outside Git by default in `C:\ChatGPT\Shared\Cache\ZombonzAssets\originals`.
- Record creator, source URL, displayed licence, geometry notes, and any later modifications.
- Do not bypass login/download gates. Sketchfab originals marked `auth-required` must be downloaded through an authenticated Sketchfab account.
- Before public redistribution, re-check the licence metadata included with the downloaded archive.

## Locked zombie candidates

### Peter_D - Zombie Soldier
- Status: **locked candidate / primary soldier zombie**
- Source: https://sketchfab.com/3d-models/zombie-soldier-176e930e63d144cc8f615b8dd3a8c74f
- Creator: Peter_D (@better_peter)
- Displayed licence: CC Attribution
- Geometry: ~7.2k triangles / 3.6k vertices
- Notes: normal + roughness maps, standard rig, Mixamo-compatible; source page says some Mixamo animations are included.
- Download: auth-required (Sketchfab)

### pxltiger - Zombie
- Status: **locked candidate / lightweight horde body**
- Source: https://sketchfab.com/3d-models/zombie-73ef58af341e46afba1da53366ed79cf
- Creator: pxltiger
- Displayed licence: CC Attribution
- Geometry: ~4.8k triangles / 2.7k vertices
- Notes: creator explicitly permits commercial computer-game use and modification; creator asks that the package not be sold/redistributed as a competing asset product.
- Download: auth-required (Sketchfab)

## First-pass realistic WWII weapon set

### M1911
- Source: https://sketchfab.com/3d-models/realistic-m1911-handgun-game-ready-aa874a0e55224aeb99c5fef0aaf109a1
- Creator: Quinn Kuslich (@qkuslic1)
- Displayed licence: CC Attribution
- Geometry: ~15.5k triangles
- Notes: realistic worn-metal Substance Painter treatment; game-ready.
- Download: auth-required

### Kar98k
- Source: https://sketchfab.com/3d-models/kar98k-c383b7ac23854314989773776e6c76ff
- Creator: ARIA (@I_Live)
- Displayed licence: CC Attribution
- Geometry: ~9.8k triangles
- Notes: 4K texture set; PBR/game-asset presentation.
- Download: auth-required

### MP40
- Source: https://sketchfab.com/3d-models/mp-40-ww2-submachine-gun-7ec7e1f9656e4319b8edae0d785699ad
- Creator: Moony_State
- Displayed licence: CC Attribution
- Geometry: ~14.5k triangles
- Notes: low-poly, modern-engine oriented, 4K textures.
- Download: auth-required

### Thompson M1A1
- Source: https://sketchfab.com/3d-models/m1a1-thompson-199fe2c79a32458f9f420ffb708d4167
- Creator: calico16
- Displayed licence: CC Attribution
- Geometry: ~8.6k triangles
- Notes: appropriate box-magazine M1A1 configuration.
- Download: auth-required

### PPSh-41
- Source: https://sketchfab.com/3d-models/ppsh-41-5c8a64490fa747389e9cfcaecc69c88a
- Creator: Zillious
- Displayed licence: CC Attribution
- Geometry: ~12.4k triangles
- Notes: optimized for game engines, 4K PBR textures; magazine and trigger can be separated for animation.
- Download: auth-required

### M1 Garand
- Source: https://sketchfab.com/3d-models/m1-garand-ec368667c6a54f018c8cb4bacdebbb94
- Creator: YieldingMist206
- Displayed licence: CC Attribution
- Geometry: ~11.1k triangles
- Notes: includes clip and bullets; source notes some incorporated ambientCG CC0 material assets.
- Download: auth-required

### BAR M1918A2
- Source: https://sketchfab.com/3d-models/bar-m1918-a2-game-ready-rigged-1213683e58b14dd89fd4520489c7b732
- Creator: Peanut_Butcher
- Displayed licence: CC Attribution
- Geometry: ~13.3k triangles
- Notes: game-ready and rigged; handle can be added/removed.
- Download: auth-required

### MG42
- Source: https://sketchfab.com/3d-models/mg42-f00a231e6fd046ecb4defb48c8dcd817
- Creator: AxelK
- Displayed licence: CC Attribution
- Geometry: ~9.5k triangles
- Notes: simple, lightweight game-ready candidate.
- Download: auth-required

### STG-44
- Source: https://sketchfab.com/3d-models/stg-44-c1fa5b79ab0c42a1949506b3e0137424
- Creator: Observer3D (@3danalyst)
- Displayed licence: CC Attribution
- Geometry: ~25k triangles
- Notes: PBR, HD texture maps, game-ready.
- Download: auth-required

### Mosin Nagant M91
- Source: https://sketchfab.com/3d-models/mosin-nagant-m91-55c00242c4024307a761a89167e39a7c
- Creator: Doink (@Doinkoloink)
- Displayed licence: CC Attribution
- Geometry: ~9.1k triangles
- Notes: Substance Painter/PBR candidate with good realtime geometry.
- Download: auth-required

### M1903 A3 Springfield
- Primary source: https://gintoki1234.itch.io/springfield-m1903-a3
- Sketchfab mirror: https://sketchfab.com/3d-models/m1903-a3-springfield-fa6f760cd28b4d3db2011ab2cab0f719
- Creator: Gintoki1234
- Licence: CC BY 4.0 (explicitly stated by creator)
- Geometry: rifle ~17,748 triangles; separate cartridge, bullet, empty shell and magazine meshes.
- Notes: simple rig, one material, 4K textures; strongest source package for reload/ejection work.
- Download: creator-hosted free/name-your-own-price page; archive listed as `M1903 A3.zip` (76 MB).

### Winchester Model 1897 / M97 trench gun
- Source: https://sketchfab.com/3d-models/winchester-model-1897-6194ecd23344442fb23f5820f895a0d8
- Creator: buh (@buh-late)
- Displayed licence: CC Attribution
- Geometry: ~18.3k triangles
- Notes: historically appropriate trench-gun configuration.
- Download: auth-required

### Double-barrel shotgun
- Source: https://sketchfab.com/3d-models/double-barrel-shotgun-04741a40f2224cffafc343b0236d5bbe
- Creator: Sebastian Kansik (@Pepego)
- Displayed licence: CC Attribution
- Geometry: ~5k triangles
- Notes: Blender/Substance Painter source; useful classic box-weapon candidate.
- Download: auth-required

## Known arsenal gap

A suitably realistic, freely redistributable **M1 Carbine** is not locked yet. The clearly CC-attribution result found so far is intentionally PS1/low-poly (~496 tris), so it is not a good visual match for this set. Do not lower the art bar just to fill the slot.

## Attribution template

For every imported asset, preserve an entry containing:

- Asset/model name
- Creator name and handle
- Original source URL
- Licence name and licence URL/version
- Date retrieved
- Original archive filename and SHA-256
- Runtime file(s) derived from it
- Modifications performed (conversion, texture resize, mesh cleanup, rigging, etc.)

A future credits screen can be generated from this manifest rather than maintained separately.

## Import policy

Original archives live outside Git. Runtime derivatives may enter the repository only after their licence has been rechecked from the downloaded package and their texture/mesh budget has been evaluated. Prefer GLB for Three.js runtime delivery, with source FBX/BLEND archives retained only in the external asset cache.

## Local intake received 2026-09-19

Jess downloaded the selected source archives into `C:\ChatGPT\Downloads`. These ZIPs are being treated as the canonical untouched intake copies until they are unpacked and inspected.

| Asset | Archive | Size (bytes) |
|---|---|---:|
| Peter_D Zombie Soldier | `zombie-soldier.zip` | 9,024,287 |
| pxltiger Zombie | `zombie.zip` | 8,766,730 |
| M1911 | `realistic-m1911-handgun-game-ready.zip` | 39,101,634 |
| Kar98k | `kar98k.zip` | 58,663,229 |
| MP40 | `mp-40-ww2-submachine-gun.zip` | 52,341,412 |
| PPSh-41 | `ppsh-41.zip` | 100,685,372 |
| M1 Garand | `m1-garand.zip` | 18,377,317 |
| BAR M1918A2 | `bar-m1918-a2-game-ready-rigged.zip` | 70,863,822 |
| MG42 | `mg42.zip` | 61,490,140 |
| STG-44 | `stg-44.zip` | 25,251,290 |
| Mosin Nagant M91 | `mosin-nagant-m91.zip` | 71,064,666 |
| M1903 A3 Springfield | `m1903-a3-springfield.zip` | 69,119,044 |
| Winchester Model 1897 | `winchester-model-1897.zip` | 82,184,606 |
| Double-barrel shotgun | `double-barrel-shotgun.zip` | 24,119,011 |

The Thompson M1A1 candidate was intentionally not downloaded because the available source was untextured. Keep it on the sourcing backlog rather than importing an art-quality mismatch.

## Post-download verification 2026-09-19

All 14 downloaded ZIP archives were copied byte-for-byte into the external cache under `C:\ChatGPT\Shared\Cache\ZombonzAssets\originals`. SHA-256 comparison against the originals in `C:\ChatGPT\Downloads` passed for every archive; see `SOURCE_HASHES.tsv`.

Public Sketchfab API metadata for the 14 exact model IDs was snapshotted under `C:\ChatGPT\Shared\Cache\ZombonzAssets\licenses`. Each snapshot reports **Creative Commons Attribution (CC BY 4.0)** and that commercial use is allowed. The extracted download archives themselves did not contain standalone files named LICENSE, LICENCE, or README, so the source-page/API evidence must remain part of provenance.

### Zombie runtime findings

- **Peter_D Zombie Soldier** is the preferred primary runtime body. The prepared mesh has 7,176 faces, 4,223 vertices, 55 bones, one main PBR material, and 2K textures. Its walk/attack/death/etc. derivatives are animation-only GLBs, allowing one mesh to be reused with separate clips.
- **pxltiger Zombie** remains a good secondary visual/horde variant at roughly 4.8k faces. Its converted animation files currently duplicate the skinned mesh, so it is less elegant as the main animation architecture.
- Runtime derivatives are kept outside Git in `C:\ChatGPT\Shared\Scratch\ZombonzRuntimeAssets\zombies` until the game-facing integration chooses exactly what should ship.

### Weapon runtime findings

Runtime GLBs are committed for M1911, Kar98k and BAR M1918A2 (first pass), and for MP40, PPSh-41, M1 Garand, MG42, Mosin Nagant, M1903 Springfield, the double-barrel shotgun and the Winchester 1897 trench gun (converted 2026-09-26). The STG-44 stays quarantined (below).

The 2026-09-26 conversions were made without Blender: three.js FBX/Collada/OBJ loaders read the geometry in Node, and gltf-transform with sharp wrote each GLB. Every model is baked to world space, reoriented to Y up with the muzzle toward +Z, scaled to its real length, and given its source PBR maps as WebP (base colour and normal at most 2K; roughness, metalness and any AO packed into a 1K ORM texture). Each is 0.9-2.1 MB, compared with 13-33 MB for the first-pass GLBs. Orientation was checked with rendered side and top silhouettes and then in the game's viewmodel. The Winchester's source is a `.blend` whose materials have no node setup, so `blend-to-glb.py` first exports its geometry with Blender 4.5 LTS (portable build, SHA-256 checked against download.blender.org). Its two texture atlases were matched to its two materials by sampling each material's UVs against each atlas's transparency: one pairing lands 0% of faces on empty atlas and the other 3-10%. The converter is in `scripts/weapon-convert/` (its own `npm install`; not part of the game build): extract the source archives, set `WEAPONS` to that folder and run `node run.mjs [id ...]`. `preview.mjs` renders the orientation silhouettes.

The BAR source contained embedded 4096x4096 textures and produced a 37.02 MB GLB. Its runtime copy was resized to 2048x2048 textures, reducing it to about 13.18 MB with **zero glTF validation errors**. The validator still warns that tangent space must be generated at runtime for its normal-mapped submeshes; an attempted explicit tangent-generation derivative produced invalid zero-length tangent vectors and was rejected.

### STG-44 quarantine

Do **not** ship the downloaded Observer3D STG-44 yet. Although the exact Sketchfab API record currently reports CC BY 4.0, the extracted source uses internal names such as `wpn_h1_asl_mp44` and reuses `m1014_foregrip_*` texture names. That is a provenance red flag and the uploader-selected licence alone is not sufficient evidence that the uploader owned every underlying component.

A replacement should be sourced before STG-44 integration. One current candidate to review is ELIZION's downloadable CC Attribution STG-44:
https://sketchfab.com/3d-models/stg-44-sturmgewehr-fa37bef729e141a6a29bb022a3e0be41

### Thompson

The previously shortlisted Thompson M1A1 was intentionally skipped because its downloadable package was untextured. Keep Thompson on the sourcing backlog rather than shipping a visual mismatch.

### Browser benchmark follow-up

A standalone Three.js benchmark with 20 animated instances confirmed both zombie candidates load and animate without model errors after runtime cleanup. Peter_D renders the 20-zombie test in 20 draw calls from one shared geometry, while pxltiger requires 280 draw calls from its 14-mesh body. pxltiger's four runtime clips have now been converted to clean animation-only GLBs, removing the stale PSD texture reference and duplicated animation meshes. See `ZOMBIE_BENCHMARK.md`.

## CC0 environment and prop pack

A browser-ready CC0 environment/prop pack was added on 2026-09-20. It contains 10 tileable PBR environment materials, 5 decal/overlay sets, 18 general props, and 3 lower-fidelity background military vehicles.

Runtime paths, map conventions and vehicle usage notes are documented in `ENVIRONMENT_PACK.md`. Exact CC0 source URLs are carried in the runtime manifests and `public/assets/ATTRIBUTION.txt`. Untouched source archives and metadata remain outside Git in the shared asset cache.
