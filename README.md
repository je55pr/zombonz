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

Click the canvas to capture the mouse. Move with WASD, hold Shift while moving forward to sprint,
hold the right mouse button to aim down sights, and fire with the left mouse button.
Sprinting stops when firing, aiming, reloading or changing weapons; aiming slows movement
and narrows the view. The sprint/ADS handling is prototype tuning, not a frame-exact recreation.
Reload with R, knife with V, switch weapons with Q, interact with E, and restart after game over with Enter.
M mutes synthesized game audio. Escape releases the mouse. Input releases when the window loses focus.

G toggles god mode (restores health and prevents damage). F toggles noclip:
WASD flies in the direction you look, Space rises and C descends. Active modes appear
on the HUD. Turning noclip off lands you on a valid surface; if you are inside a wall
or outside the map, it returns you to where you enabled noclip. Both modes reset on restart.

F3 toggles the performance panel (FPS, frame time, CPU time and draw calls).
Rendering follows the display refresh rate, with interpolated movement and immediate
mouse-look between deterministic 60 Hz simulation ticks. Performance defaults use
1x pixel density, no MSAA, and 1024px shadows refreshed at 15 Hz. Static scenery and fallback zombie body parts
are batched where appropriate, and the HUD texture is redrawn only when its content changes.
144 FPS requires a 144 Hz-or-faster active display and enough GPU/CPU headroom;
the browser or OS may cap presentation to the current display refresh rate.

The playable solo map follows Nacht's starting room / Help room / upstairs connections.
The HELP door and each of the two stair barricades cost 1000 points. One fixed mystery
box in the Help room costs 950. It rolls for three seconds, then reserves a Kar98k,
Thompson, MP40 or BAR for the buyer to claim within ten seconds. A player carries
two guns; the first purchase keeps the M1911, while a third gun replaces the one
currently held. The box briefly closes before it can be used again. Wall purchases
offer a Kar98k in the starting room and a Thompson in the Help room. Buying wall
ammo refills an owned gun's reserves without replacing its loaded magazine; full
reserves cannot be purchased again.

The bunker uses imported environment materials and props alongside procedural details,
boarded windows, overhead beams,
stairwell openings, scattered rubble, lamps, moonlight and an exterior treeline.
Dimensions and props are an approximation, not a one-to-one recreation of the original game.
Zombies spawn outside and follow eight ground-level window approaches. They tear out
the three boards one at a time, climb through the sill, then pursue players through
open rooms and stairs. Hold E near a damaged window to rebuild one board per second.
Repairs are free and award 10 points per board up to a per-round cap. Zombies can be shot outside, and only
one zombie crosses a given window at a time. Upstairs is reached through the stairs;
upper windows and the ground window behind the north-east stair remain scenery.
Zombie health rises with each round. Headshots deal triple damage, knife swings
hit one nearby zombie in front of the player, and health recovers after five
damage-free seconds. The canvas HUD shows hit/kill feedback, ammo and reload state,
and temporary damage tint. Original synthesized audio gives simple gun, melee,
damage, box and round cues; it unlocks after user input and can be muted with M.
Eligible zombie kills can also drop timed Max Ammo, Double Points or Insta-Kill pickups.
Max Ammo refills the reserve ammo of both carried weapons for every living player
without changing loaded magazines. Double Points doubles combat and barrier-repair
rewards for 30 seconds. Kills outside a window place the pickup just inside it
so the reward is reachable. Insta-Kill makes gunshots and knife hits lethal to
zombies for 30 seconds, without bypassing walls or weapon range.

The default zombies now use Peter_D's skinned soldier model with idle, walk, run,
attack and death clips. Barrier tearing uses the attack clip; vaulting reuses a
compressed locomotion pose (the pack has no dedicated vault animation). Corpses
disappear after four seconds, with at most eight animated corpses retained.
Identical vertices and constant animation tracks are removed in memory; all instances
share model geometry/textures, with independent skeletons. Source GLBs stay untouched.
Add `?zombie=pxltiger` to try the alternate rig; it has more draw calls and no death clip.

The starter pistol uses the M1911 model; Kar98k purchases and BAR box rewards equip
their matching first-person models. Recoil, muzzle flash and a basic reload pose
follow authoritative shot/ammo/reload state. The models share textures and load on
demand; loading failures leave a playable placeholder and a visible notice.
Thompson/MP40 models and animated player hands are not in the asset pack: those guns
use labelled procedural placeholders. Full hand/bolt/round-by-round reload animation,
authentic box weapon silhouettes/roulette animation, original weapon behaviour,
recorded sounds and online co-op remain future work.

Press F2 for asset credits. Full source links, licences and conversion notes are in
[runtime attribution](public/assets/ATTRIBUTION.txt) and [asset provenance](docs/assets/THIRD_PARTY_ASSETS.md).

For map development, `/?preview=start`, `/?preview=help` and `/?preview=upstairs`
open inspection views with waves disabled, routes open and 10000 test points.
These overrides are development-only; the normal URL starts the standard survival game.
`/?preview=barrier` runs a live wave at the first window for entry-animation checks.
`/?preview=stress&perf=1` runs a development-only 24-zombie wave with open doors and
god mode for repeatable performance checks. `npm run benchmark` measures a headless
24-zombie stair-routing scenario (mean/p95 tick time); it does not measure GPU time or FPS.
`/?preview=assets&weapon=kar98k` provides a stationary target for firing/death checks.
That preview guarantees a Max Ammo drop when the target dies; add
`&powerup=doublePoints` or `&powerup=instaKill` to inspect the alternate pickups.
Use `weapon=starter-pistol`, `kar98k`, `bar`, `thompson` or `mp40` on any preview URL
to inspect that viewmodel. P fires in development previews only (useful in browsers
without pointer lock); R reloads. Production and normal survival use mouse firing.
See [map notes](docs/nacht-map.md) for layout and validation details.
