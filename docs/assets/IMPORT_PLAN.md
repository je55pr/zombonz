# Zombonz asset import plan

## Phase 1: provenance and originals

1. Download original archives only from the recorded creator/source page.
2. Save them under `C:\ChatGPT\Shared\Cache\ZombonzAssets\originals\{zombies|weapons}`.
3. Calculate SHA-256 for each untouched archive.
4. Preserve any bundled licence/readme alongside the archive.
5. Update `THIRD_PARTY_ASSETS.md` with retrieval date, archive filename, hash, and exact licence version.

## Phase 2: conversion sandbox

Never destructively modify an original archive. Extract to a disposable staging folder and produce a GLB derivative for Three.js.

For characters: inspect skeleton, skin weights, texture sets, material count and animation clips before retargeting anything. Peter_D is the first animation/rig test; pxltiger is the first low-cost horde/performance test.

For weapons: verify moving parts are separable enough for first-person reload/fire animation. Prefer one 2K viewmodel texture set initially; world/wall versions can later use 1K derivatives.

## Phase 3: browser benchmark

Test each derivative in a throwaway Three.js scene before wiring it into gameplay. Record GLB size, texture memory, draw calls, skinned-mesh cost, and visual problems.

Do not replace authoritative gameplay objects with presentation assets. Weapons and zombies remain renderer views over game-core state.

## Current priorities

1. Peter_D Zombie Soldier
2. pxltiger Zombie
3. M1911
4. Kar98k
5. MP40
6. Thompson M1A1
7. Winchester 1897
8. Double barrel
9. PPSh / Garand / BAR / MG42 / STG-44 / Mosin / Springfield

M1 Carbine remains an art-source gap. Keep searching rather than using the clearly PS1-styled free candidate.
