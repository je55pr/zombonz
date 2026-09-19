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
