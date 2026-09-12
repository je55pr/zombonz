# threejs-zombies

Working title for a browser-based, round-driven co-op zombie survival game built with TypeScript and Three.js.

This repository is also intended to be the first real project used to dogfood **MjauSwarm** once that system is ready. The backlog is prepared now; no swarm work should be assumed to have started yet.

## Product direction

- 2-4 player co-op survival with escalating rounds, economy, purchasable map access, weapons, revives, perks, power-ups, and replayable maps.
- Browser-first delivery with Three.js for presentation.
- Player-hosted multiplayer as the primary target: one player's browser is the authoritative host and peers connect over WebRTC DataChannels.
- A tiny signalling service handles room discovery / WebRTC negotiation; STUN is expected, with TURN as a fallback where direct connectivity fails.
- Dedicated/headless hosting remains a later option rather than a requirement for the first playable.

## Architecture direction

Gameplay truth should live in a renderer-independent deterministic `game-core`. Three.js renders state rather than owning it. Simulation should use a fixed tick and seedable randomness so headless tests, multiplayer authority, replay/debugging, and eventual alternate host runtimes remain possible.

Networking should be transport-independent at the gameplay boundary. The planned browser implementation uses reliable delivery for durable events and unreliable/unordered delivery for replaceable world snapshots.

## Development path

The issue pool is organised into milestones: **M0 Bootstrap**, **M1 Solo Vertical Slice**, **M2 Networked Co-op**, **M3 Core Zombies Loop**, **M4 Content & Polish**, and **R&D Later**. Issues carry area, priority, type, and swarm-suitability labels plus explicit dependencies and acceptance criteria.

The intended first milestone is deliberately boring and structural: establish deterministic foundations and worker-safe contracts before multiple agents begin implementing gameplay in parallel.

## Working title

`threejs-zombies` is only a repository/project placeholder. It can be renamed once the game has an identity of its own.
