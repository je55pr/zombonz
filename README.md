# Zombonz

Browser-based, round-driven co-op zombie survival game built with Three.js.

**Play it: https://je55pr.github.io/zombonz/** (the latest `dev` build).

## Product direction

- Strongly target the grounded, weighty **World at War / Black Ops 1 Zombies** feel rather than modern movement-heavy FPS design.
- Support **1-N players** architecturally. Classic small co-op is the first target; larger player counts are an explicit scalability experiment rather than a promise.
- Use handcrafted maps. **Bunker** is the first development/reference map for validating the classic loop;
  **Asylum**, a two-storey sanatorium around a courtyard laid out after Verrückt, is the second. Choose one after Solo.
- Preserve match purity for now: players start each run fresh rather than bringing persistent power/loadouts into a match.
- Mirror the classic loop closely: escalating rounds, points, doors, wall weapons, random weapon box, barriers, revives, perks, power, power-ups, ammo pressure and game-over survival.
- Stay close to the original WWII / occult-horror flavour while the project identity develops.
- **One visible HTML canvas only.** Three.js world rendering, HUD, menus and other visual UI belong in the canvas rather than DOM overlays.

## Multiplayer direction

- Player-hosted authoritative multiplayer, using WebRTC DataChannels for small co-op sessions, is playable now: players connect by swapping short copy-paste codes, with no server (see [online co-op](docs/networking.md)).
- A tiny signalling service for short room codes is implemented in [`server/`](server) and documented in [online co-op](docs/networking.md); TURN fallback where direct connectivity fails is still to come.
- Gameplay/protocol code must not assume four players even if 1-4 is the first practical test target.
- Large sessions such as 16/32/64 players are a later architecture/performance investigation and may require a server/relay topology rather than one browser maintaining a classic small-lobby host star.
- Dedicated/headless hosting remains a later option rather than a requirement for the first playable.

## Architecture direction

Gameplay truth should live in a renderer-independent deterministic `game-core`. Three.js renders state rather than owning it. Simulation should use a fixed tick and seedable randomness so headless tests, multiplayer authority, replay/debugging, and eventual alternate host runtimes remain possible.

Networking should be transport-independent at the gameplay boundary. The planned browser implementation uses reliable delivery for durable events and unreliable/unordered delivery for replaceable world snapshots.

## Development path

The issue pool is organised into milestones: **M0 Bootstrap**, **M1 Solo Vertical Slice**, **M2 Networked Co-op**, **M3 Core Zombies Loop**, **M4 Content & Polish**, and **R&D Later**. Issues carry area, priority, type, dependencies and acceptance criteria.

The intended first milestone is deliberately structural: establish deterministic foundations and clean module contracts before broad gameplay implementation.

## Deployment

Every push to `dev` runs `.github/workflows/pages.yml`: it installs from the lockfile, typechecks,
runs the tests, builds with `npm run build:pages` (the same build, served under `/zombonz/`) and
publishes `dist/` to GitHub Pages. No secrets are involved. The F2 credits screen shows the live
build's commit (`BUILD abc1234`). To roll back, open that workflow in the Actions tab and re-run it
for an earlier `dev` commit. To check a Pages build locally, run `npm run build:pages` and then
`npx vite preview --base=/zombonz/` and open `/zombonz/`.

## Run the current prototype

Use Node.js 22.12.0, then `npm ci` and `npm run dev`. Open the local address printed by Vite.
Run `npm run check` for TypeScript validation, automated tests and a production build.

For visual level editing, use **Godot 4.7 .NET** and run `npm run editor:setup`, then open
`tools/godot-map-editor/project.godot`. The map authoring plugin uses C# and exports the JSON loaded
by the browser game. See [the map editor setup and workflow](docs/godot-map-editor.md).

The game opens on a start menu: **Solo**, **Multiplayer** and **Settings** (mouse or arrow keys,
Enter to choose, Esc to go back). Multiplayer hosts or joins online co-op for up to four players:
the host gets a five-letter room code and everyone else types it in (this needs the small game server in [`server/`](server), which
[docs/server-setup.md](docs/server-setup.md) shows how to run for free on Cloudflare; a copy of the game without one falls back to swapping
short codes over chat or text) ([how it works](docs/networking.md)). **Test my connection**
there (and in the lobby) checks whether a network will allow it and gives a text report to send to a friend. Settings
holds mouse sensitivity, field of view and volume, saved in this browser. While the menu is open it
downloads the game code and every model and texture the game uses (about 88 MB), with a progress
bar, then unpacks them (decodes the textures and parses the props, zombie and starting pistol).
Solo and Multiplayer unlock when both finish (Settings works throughout). The files are kept in
memory, so starting Solo makes no further requests, and the menu stays up until the chosen map is fully built,
its textures uploaded and shaders compiled, so the map never appears half-loaded. In play, a gun
starts unpacking while the box rolls it or while you stand at its wall buy, so it appears straight
away. Choosing a map captures the mouse and starts round one as soon as loading finishes.

If the browser denies mouse capture, click the game canvas to retry. Move with WASD, hold Shift while moving forward to sprint,
hold the right mouse button to aim down sights, and fire with the left mouse button.
Sprint lasts about four seconds, then recharges after a short pause; once exhausted you
need a second of stamina back before sprinting again. Sprinting also stops when firing, aiming, reloading or changing weapons; aiming slows movement
and zooms the view in (1.74x for anything but a pistol, from whatever field of view is set, matching Black Ops screenshots
of the Kar98k; 1.3x for pistols, which do not zoom at all in Black Ops) and slows looking around to 0.7 of its speed. Aimed, each gun turns so its own rear sight, front sight and
your eye are one line through the middle of the screen, which is also the line the shot leaves along
([how the sights were measured](docs/weapon-sights.md)). ADS also reduces weapon-specific hip-fire spread by 90%; shot
variation is seeded in the game core for repeatable results. The handling is
prototype tuning, not a frame-exact recreation.
Reload early with R (or automatically when the magazine empties), knife with V (the gun drops away, the knife
swings across the view and its blow lands at the strike, 0.15 s in, whatever is then in reach; see [combat notes](docs/combat.md)),
throw a grenade with T or middle mouse, set a Bouncing Betty with G, switch weapons
with Q or the mouse wheel, interact with E, and restart after game over with Enter.
A killing blow puts you into last stand with a pistol: a teammate can revive you by holding E beside
you, you bleed out after 30 seconds, and solo play ends there unless you drank Quick Revive.
In co-op, a bled-out player spectates a standing teammate until the next round; fire cycles forward
and aim cycles backward through valid teammates. Respawning keeps points and lifetime score stats,
but starts a fresh combat loadout: starter pistol, no perks, no Betties and fresh grenades
(see [Asylum](docs/asylum-map.md#last-stand)).
M mutes game audio. Escape releases the mouse and opens the pause menu, with Resume,
Restart, Settings and Quit to Main Menu. Losing focus or hiding the tab also pauses the game,
so zombies do not advance while you are away. Input releases when focus is lost.

L toggles god mode (restores health and prevents damage). K toggles noclip:
WASD flies in the direction you look, Space rises and C descends. Active modes appear
on the HUD. Turning noclip off lands you on a valid surface; if you are inside a wall
or outside the map, it returns you to where you enabled noclip. Both modes reset on restart.

F3 toggles the frame profiler (`?perf` opens it automatically). It shows average and
95th-percentile frame/CPU time, a 144 Hz budget bar for each CPU stage, shadow-update
versus regular scene cost, draw calls, triangles, and active rigs. GPU draw time appears
when the browser supports asynchronous timer queries; it excludes browser presentation,
so CPU and GPU times should not be added together. The panel stays dormant while hidden.

F4 toggles the multiplayer network diagnostics (`?netdiag` opens it automatically). Clients see
connection state/role, smoothed RTT, received snapshot rate, an approximate rolling snapshot-loss
percentage, the 100 ms interpolation target, buffer depth, render lag and snapshot age. Hosts show
connection state, connected peers and their actual snapshot publication rate; RTT/loss are correctly
left to clients because the host does not receive snapshot acknowledgements. Transport errors appear
in the panel without changing the simulation.

Rendering follows the display refresh rate, with interpolated movement and immediate
mouse-look between deterministic 60 Hz simulation ticks. Performance defaults use
1x pixel density and no MSAA. The moon's shadow map (1024px, 2048px on the larger Asylum) holds only the
building (ceilings, roofs and upper floors block the moon from the rooms beneath them; ground floors do not
cast; the shadow camera is fitted to the building's corners in `src/client/shadowFit.ts`, because anything outside it counts as lit): zombies and teammates take its shadows but cast none, so it is redrawn only when a door,
window board, the box or the power lever moves (at most 15 times a second while one is moving). A map's
lamps, perk machines, traps and box glow share four real point lights (`src/client/lightPool.ts`), given
to the nearest of them each frame, because every lit pixel pays for every point light in the scene.
Runtime models may not use transmissive glass: three.js redraws the whole scene for it every frame, so
`scripts/weapon-convert/plain-glass.mjs` turns it into plain see-through glass (a test enforces this).
Static scenery and fallback zombie body parts
are batched where appropriate, and the HUD texture is redrawn only when its content changes.
144 FPS requires a 144 Hz-or-faster active display and enough GPU/CPU headroom;
the browser or OS may cap presentation to the current display refresh rate.

The HUD follows WaW: the round counter is chalk tally marks for rounds one to five and a red
numeral after, flashing when a round is cleared, and every hit, kill and purchase throws a gold
"+10"/"+50"/"+100" (or red "-950") off the score. The four-line hip crosshair shows the gun's real spread: it
opens while moving, sprinting and firing, settles back when you stop, and hides when aiming down sights.
It shows state, not controls: there is no strip of key hints, and no key is drawn for grenades, Bouncing Betties or
switching weapons (the keys are in Controls, in the main menu and the pause menu). Grenades, and Bouncing Betties while
any are carried, are a row of little icons on the right, level with the ammunition: gold while held, an outline once spent.
A round begins with a low bell strike. There are three, taken in turn by round, so a long run does not hear the same one every
time; they are synthesised by `scripts/make_round_start.py` and need no attribution.

The playable solo map, Bunker, follows WaW's first map: starting room / Help room / upstairs connections.
The HELP door and each of the two stair barricades cost 1000 points. One fixed mystery
box in the Help room costs 950. It rolls for three seconds, with guns flicking past above the open lid, then reserves a random gun you
don't already carry for the buyer to claim within ten seconds. The box holds every gun except
the M1911: WaW's WWII arsenal (Kar98k, Springfield, Mosin-Nagant, M1 Garand, M1A1 Carbine, STG-44,
FG42, Thompson, MP40, PPSh-41, BAR, MG42, double-barrel, Trench Gun, .357 Magnum), the Cold War guns
BO1 added to that map (M14, FN FAL, Commando, AK-74u, MP5K, Skorpion, RPK, SPAS-12, Stakeout, Python,
RPG-7), and two rare original wonder weapons. The **Irrlicht** is a dieselpunk flare pistol whose
bolts burst on impact, hitting nearby zombies and a careless shooter. The **Molniya** fires lightning
that jumps through up to five zombies in line of sight. A player carries
two guns; the first purchase keeps the M1911, while a third gun replaces the one
currently held. The box briefly closes before it can be used again. Wall chalk follows WaW's
original map: a Kar98k (200) and M1A1 Carbine (600) in the starting room, a Thompson and a
double-barreled shotgun (1200 each) in the Help room, and a Trench Gun (1500) and BAR (1800)
upstairs. BO1-style chalk adds an M14 (500) in the starting room, an MP5K (1000) in the Help room
and an AK-74u (1200) upstairs. Wall ammo costs half the gun. Wall buys show a chalk
contour at first, then the gun model appears over the contour after its first purchase.
Shotguns fire eight pellets per shell, deadly up close and weak at range. Buying wall
ammo refills an owned gun's reserves without replacing its loaded magazine; full
reserves cannot be purchased again. Bullet penetration varies by weapon: a pistol can
hit a short line, while rifles and heavy weapons reach farther through aligned zombies.
World geometry stops bullets. See [penetration rules](docs/combat-penetration.md).

The bunker uses imported environment materials and props alongside procedural details,
boarded windows, overhead beams,
stairwell openings, scattered rubble, lamps, moonlight and an exterior treeline.
Dimensions and props are an approximation, not a one-to-one recreation of the original game.
Zombies spawn outside and follow eight ground-level plus four upstairs window approaches. Before each spawn,
entrances that cannot currently route to any standing player are excluded. Of the remaining entrances, the director
prefers ones at least 10 m from every standing player and hidden behind world geometry; farther safe entrances receive
more deterministic weight. If every route-valid entrance is visible or too close, all remain eligible as a weighted
fallback so a round cannot stall. Scatter points behind one barrier share that entrance's weight rather than multiplying
its odds. They tear out
the six boards one at a time, in a random order (any board still up may go, and rebuilding
fills a random gap; the match seed decides, so every player sees the same), climb through the
sill, then pursue players through open rooms and stairs. The boards sit in two groups, three
below the eye-line and three above, so the middle of a window is open to look and shoot through
however many are up. Hold E within reach of a damaged window to rebuild one board per second;
you do not need to look at it. Elsewhere an interaction needs you to face it within about 70
degrees left or right (looking up or down doesn't matter), or to stand right beside it. Where
several are in reach, the nearest and best-centred one is used.
Repairs are free and award 10 points per board up to a per-round cap. Once a board is gone,
a zombie at the window swipes a player standing within an arm's length of the opening on the inside (about a metre),
and it stops tearing while it swings. Repair from further back to stay safe. Zombies can be shot outside, and only
one zombie crosses a given window at a time. Upstairs entries begin spawning from round four,
when their interior landing can reach a player; the ground window behind the north-east stair remains scenery.
Rounds follow the classic WaW/BO1 curves: solo rounds hold 6, 8, 13, 18 and 24 zombies,
then grow faster from round 10, with more per extra co-op player and at most 24 alive at once.
Rounds are ten seconds apart. Spawns start two seconds apart and speed up 5% each round. Each zombie rolls a walk, run or
sprint gait when it spawns: round 1 is all walkers, runners join from round 2, sprinters from
round 6, and from round 10 everything sprints. A sprinter runs a little slower than a walking player, so walking away
always opens a gap (see [zombie difficulty](docs/zombie-difficulty.md)), but zombies are solid: run into a group of them and you stop.
Zombie health rises with each round. Headshots deal double damage (quadruple with the Kar98k, which one-shots through round 3;
the starting pistol takes two on round 1), and only where the head is drawn: a zombie is ten capsules that follow what it is doing
(see [docs/combat.md](docs/combat.md); `?hitboxes=1` draws them). Hip-fire wanders, a lot at range and on the move, so aim for
anything far off. A zombie winds up before it hits and its blows land one at a time, so two arriving together do not down you at once.
Strong hits, and every explosion, can take a zombie's limbs off (never the pistol's or the knife's): a head goes with the shot that
kills, and a zombie that loses a leg and lives crawls after you, slower and from a shorter reach. Knife swings
hit one nearby zombie in front of the player, and health recovers after five
damage-free seconds. The canvas HUD shows hit/kill feedback, ammo and reload state,
and temporary damage tint. Presentation-only recorded audio gives gun, melee, damage, box and round cues. World SFX are
listener-relative with distance falloff and stereo pan; reusable gain/panner voices are pooled while the Web Audio
buffer source itself is recreated as required by the API. SFX, UI and music/ambience have separate volume buses under
the master setting. Web Audio is created/resumed only from user input and can be muted with M. Quiet recorded wind and
electrical hum use the non-positional music/ambience bus and fade out while solo play is paused. Practical lamps occasionally flicker.
Zombie kills can also drop Max Ammo, Double Points, Insta-Kill, Nuke or Carpenter pickups, using the
classic rules. Each time the team's total earned points pass a threshold (2000 above the
starting points, growing 14% after each drop), the next kill drops one. Any kill also has
a 3% chance. At most four drop per round, and every kind appears once before any repeats.
Pickups stay for 15 seconds, then blink faster and faster for about 11 more before vanishing.
Max Ammo refills the reserve ammo of both carried weapons and all four grenades for every
living player, without changing loaded magazines. Double Points doubles combat and barrier-repair
rewards for 30 seconds. Kills outside a window place the pickup just inside it
so the reward is reachable. Insta-Kill makes gunshots and knife hits lethal to
zombies for 30 seconds, without bypassing walls or weapon range.
A Nuke kills all currently active zombies and awards 400 points to every living player;
it does not award a kill bonus for each zombie, and the screen flashes white and fades back.
A Carpenter rebuilds every damaged barrier to full boards and pays 200 points to each player
who is not down. It only drops once five barriers have lost every board (or all of them, on a
map with fewer), so a kind that cannot drop yet is passed over in the deck. The wonder weapons
are as likely as any other gun in the box for now, and each solo game starts from a fresh random
seed, so the box and drops differ between games (dev builds can pin one with `?seed=<n>`).
### Pack-a-Punch

A Pack-a-Punch machine turns the gun in your hand into a stronger one with a name of its own: 5000 points, five seconds
to upgrade, then twelve to take it before it is lost. It needs the power on where a map has a switch, and another gun to
hold meanwhile (with one gun it says so and takes nothing). The upgraded gun has about twice the damage, bigger magazine
and reserve, a faster reload, and its base gun's sights and sound, but a dark space-age finish with glowing circuit lines
(and a muzzle flash) in a bright colour of its own: a magenta MP5K, an ice-blue Kar98k, a red Thompson. Every gun has one, and a
Molniya's lightning reaches eight zombies where it reached five. Bunker's machine is upstairs where the Nacht der Untoten
floor plan has its sniper cabinet, and Asylum's is in the BAR back room. Wall ammo refills an upgraded gun and the box never
offers you the gun you have upgraded. See [docs/pack-a-punch.md](docs/pack-a-punch.md).

### Explosives

Everything that goes bang shares one set of blast rules (`src/core/blast.ts`): full damage at the
centre, falling in a straight line to nothing at the radius, blocked by walls, credited (and paid) to
whoever set it off. Insta-Kill and Double Points apply to every kind.

- **Frag grenades:** two to start, two more each new round, at most four. A grenade follows a fixed-tick
  arc, bounces off solid geometry (and rings off it) and explodes after two seconds. Only its thrower
  is hurt by it. It is a hand-built Mk 2 "pineapple" that tumbles as it flies, settles on its side
  when it stops, trails sparks from its fuse and glows at the neck as the fuse runs out. In the hand
  it is shown with its pin and lever, and the gun dips out of the way for the throw.
- **Bouncing Betties:** sold two at a time (1000 points, 500 to top up a used pair) from a shelf on the
  wall: in the hallway in Asylum and in the start room in Bunker. G sets one on the floor just in front
  of you (at your feet if a wall is in the way). It blinks amber while it arms (1.25 s), then glows
  red. When a zombie comes within 1.7 m it springs to chest height and goes off a third of a second
  later, killing whatever is close. Players never set one off, but its blast hurts its owner. At most
  eight per player are out at once, and they last until they go off.
- **Barrels and vehicles:** `src/core/hazard.ts` defines them as data (a kind, a position and a yaw), so
  a map only places `{ id, kind, position, yaw }`. Explosive barrels, a jeep and a truck are in the
  game. They are solid while they stand, take bullets (a barrel about three pistol shots), a blast or
  a grenade, and burn when their health runs out: a barrel goes off almost at once, a vehicle after
  three or four seconds of burning. They go off exactly once, hurt every player and zombie near them
  (and each other, so a row of barrels goes up in turn), and pay the last player who hurt them for
  what they kill. A barrel leaves a scorched husk and no collision; a vehicle leaves a blackened shell
  that stays solid and keeps stopping bullets. Scenery vehicles that should not explode stay ordinary
  props.
- **Look and sound:** the explosion is drawn by `src/client/blastEffects.ts`: a white flash, a fireball,
  a column of flame for fuel, smoke that cools from warm to black, sparks, debris that lands on the
  floor, a shockwave ring, a scorch mark that fades over a minute, a burst of light from the shared
  light pool and a shake of the camera that grows with how near the blast is. Barrels and cars smoke
  as they are shot up and burn before they go. The grenade and the Betty are built in code. Their sounds
  are the recorded clips the game already had (two bangs, some metal and mechanical sounds), pitched to
  suit, until the recordings listed in [docs/audio-wanted.md](docs/audio-wanted.md) are found. Teammates'
  explosions are heard where they happen.

The default zombies now use Peter_D's skinned soldier model with idle, walk, run,
attack and death clips. Barrier tearing uses the attack clip; vaulting reuses a
compressed locomotion pose (the pack has no dedicated vault animation). Corpses
disappear after four seconds, with at most eight animated corpses retained.
Identical vertices and constant animation tracks are removed in memory; all instances
share model geometry/textures, with independent skeletons. Source GLBs stay untouched.
Zombies are drawn with one of two models, chosen when each spawns by its map's proportions (the Bunker's dead are mostly
Peter_D's soldiers, the Asylum's mostly pxltiger's bare-chested patients), and differ again in colouring, build, tempo and
bearing. `?zombie=peter_d` or `?zombie=pxltiger` makes every zombie one of them (the alternate rig has no death clip, and a
few more draw calls). More models and animations are wanted: see [docs/zombie-art-wanted.md](docs/zombie-art-wanted.md).

Every gun has a real first-person model (29 licensed CC BY models; see the F2 credits).
Recoil, muzzle flash and a basic reload pose
follow authoritative shot/ammo/reload state. The models share textures and load on
demand; loading failures leave a playable placeholder and a visible notice.
There are no animated player hands.
Weapon stats are WaW-inspired approximations. Full hand/bolt/round-by-round reload animation,
authentic box weapon silhouettes/roulette animation, original weapon behaviour,
and recorded sounds remain future work.

Press F2 for asset credits. Full source links, licences and conversion notes are in
[runtime attribution](public/assets/ATTRIBUTION.txt) and [asset provenance](docs/assets/THIRD_PARTY_ASSETS.md).

For map development, `/?preview=start`, `/?preview=help` and `/?preview=upstairs`
open inspection views with waves disabled, routes open and 10000 test points.
These overrides are development-only; the normal URL starts the standard survival game.
Add `&map=asylum` to any preview URL to open Asylum instead of Bunker (see [Asylum](docs/asylum-map.md)).
On Asylum, `&power=on` starts with the power on, and `&traps=on` also sets both electric traps running.
`&down=on` starts in last stand, with Quick Revive so the solo player gets back up.
`/?preview=wallBuys` and `/?preview=helpWalls` face the start-room and HELP-room chalk wall buys.
`/?preview=barrier` runs a live wave at the first window for entry-animation checks.
`/?preview=stress&perf=1` runs a development-only 24-zombie wave with open doors and
god mode for repeatable performance checks. Add `&round=N` to any preview URL to start its wave at
round N, for example `/?preview=start&round=9` to face a round of sprinters. `npm run benchmark` runs headless
stress scenarios (24 zombies trained round Asylum's power side, a spawn wave, the Bunker) and reports tick time as
mean/p95/p99/max with a per-stage breakdown and exact work counts; it does not measure GPU time or FPS (see
[simulation performance](docs/simulation-performance.md)). `npm run difficulty` prints how the game feels by the numbers:
the gap a chase opens and what running through a crowd costs (see [zombie difficulty](docs/zombie-difficulty.md)).
`/?preview=assets&weapon=kar98k` provides a stationary target for firing/death checks.
That preview places a Max Ammo pickup in front of the player and guarantees another when the target dies. Add
`&powerup=doublePoints`, `&powerup=instaKill`, `&powerup=nuke` or `&powerup=carpenter` to inspect the other pickup models.
Use `weapon=` with any gun id (for example `thompson`, `stg44`, `ak74u`, `spas12`, `rpg7`,
`irrlicht` or `molniya`; the full list is `WEAPON_DEFINITIONS` in `src/core/weapon.ts`) on any preview URL
to inspect that viewmodel; add `&aim=1` to hold it aimed down the sights (development only). P fires in development previews only (useful in browsers
without pointer lock); R reloads. Production and normal survival use mouse firing.
See [map notes](docs/bunker-map.md) for layout and validation details.
