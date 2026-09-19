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

## Run the current prototype

Use Node.js 22.12.0, then `npm ci` and `npm run dev`. Open the local address printed by Vite.
Run `npm run check` for TypeScript validation, automated tests and a production build.

Click the canvas to capture the mouse. Move with WASD, fire with the left mouse button,
reload with R, interact with E, and restart after game over with Enter. Escape releases the mouse.

G toggles god mode (restores health and prevents damage). F toggles noclip:
WASD flies in the direction you look, Space rises and C descends. Active modes appear
on the HUD. Turning noclip off lands you on a valid surface; if you are inside a wall
or outside the map, it returns you to where you enabled noclip. Both modes reset on restart.

F3 toggles the performance panel (FPS, frame time, CPU time and draw calls).
Rendering follows the display refresh rate, with interpolated movement and immediate
mouse-look between deterministic 60 Hz simulation ticks. Performance defaults use
1x pixel density, no MSAA, and 1024px shadows. Static scenery and zombie body parts
are batched, and the HUD texture is redrawn only when its content changes.
144 FPS requires a 144 Hz-or-faster active display and enough GPU/CPU headroom;
the browser or OS may cap presentation to the current display refresh rate.

The playable solo map follows Nacht's starting room / Help room / upstairs connections.
The HELP door and each of the two stair barricades cost 1000 points. One fixed mystery
box in the Help room costs 950 and immediately replaces your weapon with a loaded
Kar98k, Thompson, MP40 or BAR, followed by a three-second cooldown. Wall purchases
offer a Kar98k in the starting room and a Thompson in the Help room.

The bunker uses original procedural textures, boarded windows, overhead beams,
stairwell openings, scattered rubble, lamps, moonlight and an exterior treeline.
Dimensions and props are an approximation, not a one-to-one recreation of the original game.
Zombies spawn outside and follow eight ground-level window approaches. They tear out
the three boards one at a time, climb through the sill, then pursue players through
open rooms and stairs. Hold E near a damaged window to rebuild one board per second.
Repairs are free and do not award points yet. Zombies can be shot outside, and only
one zombie crosses a given window at a time. Upstairs is reached through the stairs;
upper windows and the ground window behind the north-east stair remain scenery.

A full box roulette/claim animation, original weapon behaviour, finished character/
weapon art, audio and online co-op remain future work. Zombie figures currently use
simple animated parts for walking, tearing and climbing.

For map development, `/?preview=start`, `/?preview=help` and `/?preview=upstairs`
open inspection views with waves disabled, routes open and 10000 test points.
These overrides are development-only; the normal URL starts the standard survival game.
`/?preview=barrier` runs a live wave at the first window for entry-animation checks.
`/?preview=stress&perf=1` runs a development-only 24-zombie wave with open doors and
god mode for repeatable performance checks. `npm run benchmark` measures a headless
24-zombie stair-routing scenario (mean/p95 tick time); it does not measure GPU time or FPS.
See [map notes](docs/nacht-map.md) for layout and validation details.
