# Zombonz

Browser-based, round-driven co-op zombie survival game built with Three.js.

## Product direction

- Strongly target the grounded, weighty **World at War / Black Ops 1 Zombies** feel rather than modern movement-heavy FPS design.
- Support **1-N players** architecturally. Classic small co-op is the first target; larger player counts are an explicit scalability experiment rather than a promise.
- Use handcrafted maps. **Nacht der Untoten** is the first development/reference map for validating the classic loop.
- Preserve match purity for now: players start each run fresh rather than bringing persistent power/loadouts into a match.
- Mirror the classic loop closely: escalating rounds, points, doors, wall weapons, random weapon box, barriers, revives, perks, power, power-ups, ammo pressure and game-over survival.
- Stay close to the original WWII / occult-horror flavour while the project identity develops.
- **One visible HTML canvas only.** Three.js world rendering, HUD, menus and other visual UI belong in the canvas rather than DOM overlays.

## Multiplayer direction

- Player-hosted authoritative multiplayer is the first implementation target, using WebRTC DataChannels for small co-op sessions.
- A tiny signalling service handles room discovery / WebRTC negotiation; STUN is expected, with TURN fallback where direct connectivity fails.
- Gameplay/protocol code must not assume four players even if 1-4 is the first practical test target.
- Large sessions such as 16/32/64 players are a later architecture/performance investigation and may require a server/relay topology rather than one browser maintaining a classic small-lobby host star.
- Dedicated/headless hosting remains a later option rather than a requirement for the first playable.

## Architecture direction

Gameplay truth should live in a renderer-independent deterministic `game-core`. Three.js renders state rather than owning it. Simulation should use a fixed tick and seedable randomness so headless tests, multiplayer authority, replay/debugging, and eventual alternate host runtimes remain possible.

Networking should be transport-independent at the gameplay boundary. The planned browser implementation uses reliable delivery for durable events and unreliable/unordered delivery for replaceable world snapshots.

## Development path

The issue pool is organised into milestones: **M0 Bootstrap**, **M1 Solo Vertical Slice**, **M2 Networked Co-op**, **M3 Core Zombies Loop**, **M4 Content & Polish**, and **R&D Later**. Issues carry area, priority, type, dependencies and acceptance criteria.

The intended first milestone is deliberately structural: establish deterministic foundations and clean module contracts before broad gameplay implementation.

## Current starter

The local project currently contains a minimal zero-install Three.js scene as an initial smoke test.

- Open `index.html` through a local static web server to view the scene.
- Run `npm run check` for the current syntax gate.
- The starter uses a pinned Three.js browser module through an import map and does not yet represent the planned final project structure.
