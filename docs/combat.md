# Combat: damage, aim and zombie melee

How a shot, a swing and a blast are decided, where the numbers come from, and what is our own balance choice. Everything
below is decided by the deterministic core (`src/core`); the client only draws what the core says happened.

## Damage and headshots (issue #159)

**Zombie health** follows WaW's `ai_calculate_health` (`maps/_zombiemode.gsc`, read from
[JBShady/COD5-Remastered](https://github.com/JBShady/COD5-Remastered)) step for step: 150 at the start, 100 more each round
up to round 9, then a tenth more than the round before with the fraction dropped each round. Round 10 is 1045 and round 11
is 1149 (a single rounding of `950 x 1.1^2` would give 1150, which is what the game did before). `test/damage-balance.test.ts`
re-implements the script's loop and checks rounds 1 to 30.

**Weapon damage** is the per-shot body damage in `WEAPON_DEFINITIONS`. These are WaW-inspired approximations tuned to a
60 Hz tick, not extracted values: the weapon files that hold the real ones are not in any source we can read. The one
anchor we have is the starting pistol, which the Nazi Zombies wiki says kills a round-1 zombie in three body shots; its 50
damage gives exactly that (3 x 50 >= 150).

**Headshots** multiply the damage of a shot whose impact is in the head volume. The multiplier used to be 3 for every gun
that did not name its own, which made the pistol's headshot 150: exactly a round-1 zombie's health, so one shot killed it.
It is now 2, so a pistol headshot is 100 and a round-1 zombie needs two. Multiplayer's multiplier is 1.4 for pistols, SMGs and
rifles, but zombie mode's own value is not in the scripts, so 2 is a balance choice. Bolt-action rifles keep 4 (one
headshot through round 3, not round 4) and shotguns 1.5 per pellet.

Shots to kill, by round (body / head), for representative guns:

| Gun (damage) | R1 | R2 | R3 | R5 |
| --- | --- | --- | --- | --- |
| M1911 (50) | 3 / 2 | 5 / 3 | 7 / 4 | 11 / 6 |
| Thompson (65) | 3 / 2 | 4 / 2 | 6 / 3 | 9 / 5 |
| MP40 (75) | 2 / 1 | 4 / 2 | 5 / 3 | 8 / 4 |
| M1 Garand (105) | 2 / 1 | 3 / 2 | 4 / 2 | 6 / 3 |
| Kar98k (100, head x4) | 2 / 1 | 3 / 1 | 4 / 1 | 6 / 2 |
| .357 Magnum (240) | 1 / 1 | 2 / 1 | 2 / 1 | 3 / 2 |

`test/damage-balance.test.ts` pins these, so a later change to a gun or a multiplier has to change the table on purpose.

## Where a zombie can be hit (issue #160)

The old hit test was one box, 0.64 m wide and 1.72 m tall, with the top 0.3 m of it counted as the head: a zombie that
stoops (both models do; their heads sit at 1.4 to 1.6 m, not 1.72) had a "head" zone that was mostly air above and beside
its skull, and a shot that grazed its shoulder counted as a headshot.

A zombie is now ten capsules (`src/core/zombieBody.ts`): a head, a torso, and an upper and lower part for each arm and
leg. Where they are comes from what the zombie is doing:

- **Stand, walk, run**: the mean position of each joint over that animation's cycle, and for the head how far it bobs, so
  its capsule is stretched by that much. The head is the centre of the skull's vertices carried by the head bone, not
  the bone.
- **Swing**: the attack clip sampled at the moment the swing has reached (the client plays the clip from the same tick
  count), so a raised arm or a head thrown back is where it is drawn.
- **Tear** (pulling at boards), **vault**: the attack pose, and the walk pose squashed to 0.85 as it is drawn.
- **Crawl**: an authored low pose (neither model has a crawl clip); the client bends the skeleton to match.

Every pose is turned to the zombie's facing (`ZombieState.yaw`, which the simulation turns at up to 9 rad/s; the client
draws exactly that) and belongs to its look (`ZombieState.variant`): the soldier stoops and hangs its arms, the walker
stands upright with its arms out in front. The numbers come from `scripts/measure-zombie-rig.ts`, which loads the models
and clips the way the game does and writes `src/core/zombieRigData.ts`; run it again after changing a rig.

A shot hits the nearest capsule it meets, so a head in front of a chest is hit first, a raised arm can shield a head,
and there is no way to score a headshot through the torso. Head hits are headshots; everything else is a body shot, and the
part struck (`torso`, `armL`, `armR`, `legL`, `legR`) rides on the hit event for the client's blood and, later, for
dismemberment. Blasts, knives and chain lightning aim at the middle of the chest wherever that is (a crawler's is low).

`?hitboxes=1` draws the capsules over every zombie (red head, yellow torso, blue arms, green legs) so they can be checked
against the model by eye.

## Hip-fire and aiming (issue #160)

Shots land evenly over a disc whose half-angle is the gun's spread, the circle the crosshair draws. Hip spread was under
half a degree for a pistol, so a distant head was as easy to hit as a near one; it is now 2.6 degrees for the M1911 (0.9 m
either side at 20 m), 3 to 4 for sub-machine guns and 2.3 to 3 for rifles, 4 to 5 for machine guns, and it doubles while
walking and triples while sprinting on top of the bloom from each shot (never wider than 11 degrees). Aiming down the sights
leaves 12% of it (5% for the scoped bolt-action rifles); shotguns keep their pellet cone.

Measured with the starting pistol at a standing zombie, 4000 seeded shots aimed at the middle of the head:

| Range | Hip: headshot | Hip: any hit on the body | Aimed: headshot | Aimed: any hit |
| --- | --- | --- | --- | --- |
| 5 m | 32% | 62% | 100% | 100% |
| 10 m | 8% | 39% | 100% | 100% |
| 20 m | 1.8% | 21% | 100% | 100% |
| 30 m | 0.9% | 12.5% | 58% | 83% |
| 50 m | 0.3% | 4.5% | 21% | 54% |

`test/hip-fire.test.ts` and `test/hit-volumes.test.ts` pin these.

## Zombie melee (issue #131)

A zombie used to hit the moment it was within a metre of a player (3D, so also through a floor's thickness), then every
second: two arriving together landed together, and a window swipe reached 1.4 m from the window's centre, which is more
than two metres from the zombie standing outside it. Now (`src/core/zombie.ts`, timings in `src/core/zombieMelee.ts`):

- **A swing has a wind-up and a recovery.** It starts when a target is in reach and in front, the blow lands when the
  wind-up ends, and the recovery follows, then a pause of up to 8 ticks. A walker winds up for 42 ticks (0.7 s) and takes 1.6 s
  a swing; a runner 30 and 1.2 s; a sprinter 22 and 0.9 s (WaW gives its faster zombies faster attack animations). Each
  zombie's own tempo adds up to 12 ticks to the wind-up and 10 to the recovery, fixed by its id, so a group never swings in step.
- **The client plays the attack clip from the swing's tick count** (`attackClipTime`), so the arm comes down on the tick the
  blow lands, and the head and arms the hit volumes use are where they are drawn. The zombie grunts as it starts.
- **Reach is real.** A swing starts within 1.1 m across the floor (0.9 m for a crawler) and a blow still lands out to 1.8 m (1.6 for a crawler),
  the lunge a player can step back out of; the target must be on the same floor (within 0.9 m) with nothing solid between
  their feet (a wall, a closed door, a sill, a barrel: so not through a boarded window, which has a sill), and in front of the
  zombie (0.9 rad to start, 1.3 to land; it turns at up to 9 rad/s first). The blow is aimed where the player is when it lands,
  so a player who steps back out of reach in the wind-up is missed.
- **The blow is a swipe, live from a tenth of the way in** (issue #210). It goes live 10% of the way through the swing
  (`ZOMBIE_MELEE.liveFrom`: 6 to 12 ticks, well before the arm is drawn coming down) and stays live to the end: 90% of the
  animation. Whoever is in reach at any point in that stretch is hit, the moment they are in it, once: a swing is one blow,
  whoever it lands on. A player standing in reach is hit on the first live tick; one who is out of reach until then is hit the
  moment they come in; one who is out of reach for the whole stretch is missed. (It used to go live only as the arm came down,
  40 to 45% in, so a player who stayed out of reach until then and stepped back at the end avoided it altogether.) A blow
  that finds the player in another zombie's grace lands when the grace ends, if they are still in reach and the swing is not
  over (the arm does not stop and wait).
- **A zombie keeps coming while it swings, and reads where the player is going** (issue #210). A swing is a lunge on the move,
  not a halt: the zombie closes on the player through the wind-up and the recovery, and stops only when it touches them (it
  never pushes them along). It also starts a swing when the player, at the speed and heading they have now, and it, still
  coming, will be within strike range as the wind-up ends (looking at most 2 m of their travel between them ahead), so it
  begins about 4 m out for a player running at it and the blow arrives with them, rather than the player getting in and out
  untouched. A player who stops short, turns off or backs away once it has begun is missed if that takes them out of reach;
  one who turns away before it begins is not swung at.
- **Windows.** A zombie tearing boards swipes once a board is gone, at a player inside within 1 m of the window plane and
  no farther to the side than the opening plus 0.3 m: an arm's length through the gap, not the length of the room. It stops
  tearing while it swings, a crawler cannot swipe at all, and a swing is dropped if the window is rebuilt first.
- **Blows come one at a time.** A landed blow gives the player 18 ticks (0.3 s) of grace against every other zombie; a
  blow that arrives in the grace waits, its arm out, until it has passed. So a crowd's blows are spaced, and someone hit
  once can step away, shoot or knife before the second.
- **Zombies do not stand inside each other or the player, and the player cannot walk through them.** Each tick, pairs closer
  than ZOMBIE_SPACING (0.72 m, a little over a body's 0.64 width) are pushed apart (all of it for the one free to move, when the other is mid-swing or coming
  through a window), and the walls still hold. A crowd spreads round its target. A player is stopped by a zombie's body
  (0.66 m from its middle) and slides round it; a swinging zombie holds its ground, a free one gives way a little. Zombies
  queued behind a fight are not taken for stuck. See [zombie difficulty](zombie-difficulty.md) (issue #210).

The damage per blow is unchanged at 50, so two blows still down a 100-health player (250 with Juggernog takes five), as in
WaW; only when they land has changed. Ticks (at 60 a second) from a zombie's first swing until the player goes down, with
the player standing still and the zombies arriving together (`test/zombie-melee.test.ts` pins the ordering):

| Zombies | Walker: first blow / down | Runner | Sprinter |
| --- | --- | --- | --- |
| 1 | 12 / 123 (2.0 s) | 10 / 97 (1.6 s) | 8 / 79 (1.3 s) |
| 2 | 12 / 30 (0.5 s) | 10 / 28 (0.5 s) | 8 / 26 (0.4 s) |
| 4 | 12 / 30 (0.5 s) | 10 / 28 (0.5 s) | 8 / 26 (0.4 s) |
| 6 | 12 / 30 (0.5 s) | 10 / 28 (0.5 s) | 8 / 26 (0.4 s) |

The first blow lands a tenth of the way into the swing, so two zombies arriving together put a player down in about half a
second (the second blow comes one grace later, 0.3 s). Issue #131 found two arriving together near-instant death; the first
fix made it 1.3 s, and this pass (issue #210) has taken it back to about 0.5 s on purpose, for crowds that are dangerous.

## Dismemberment and crawlers (issues #135 and #139)

Which limbs come off is decided by the core (`src/core/gore.ts`), ported from WaW's `zombie_gib_on_damage`
(`_zombiemode_spawner.gsc`), so every peer sees the same bodies and the state (`ZombieState.limbs`, a bit for each of head,
left and right arm, left and right leg) rides in snapshots and replays like any other:

- **A hit must take a tenth of the zombie's health at once** to gib at all. A rifle round takes limbs in the first rounds and
  not by round ten; the starting pistol never does (WaW excludes every pistol but the .357), nor a knife, fire or the
  Molniya's lightning.
- **The head comes off only with the shot that kills** (a bullet, or a blast within 1.4 m of it).
- **By the part struck:** an arm hit takes that arm; a torso hit opens the torso up or takes an arm, half each; a leg hit takes
  that leg, and one time in four the other with it, but a leg only to a real blow (a fifth of its health) since it makes a
  crawler.
- **A blast takes the limbs nearest its centre** (WaW's `derive_damage_refs`): one, plus one more if it took half the zombie's
  health, one more if it was within half its radius, and one more if it kills. A grenade among a group leaves torsos, crawlers
  and lumps. It takes the head of a zombie it kills within 1.4 m of it. Bullets, rocket bursts, grenades, Betties, barrels and
  cars all use it.

A zombie with a leg gone and life left is a **crawler**: `zombiePose` puts it in the crawl pose (a low body with the head up
and the arms reaching), it moves at most a metre a second (`CRAWLER.speed`), is only 0.7 m tall to walls (so it passes under
what a standing zombie cannot), starts a swing from 0.9 m and lands it from 1.6 m rather than 1.1 and 1.8, and cannot swipe
through a window. It still hunts, hits, tears boards and vaults, and is killed and paid for like any zombie. A zombie shot off
a wall it is climbing cannot hold on: it falls, dead, and the shooter is credited (`method: 'fall'`).

The client draws all of this (`src/client/skinnedZombieView.ts`, `zombieRig.ts`, `goreEffects.ts`, `goreDirector.ts`):

- A missing limb is hidden, cut at the elbow, knee or neck, and its stump closed with a dark cap. The one-mesh soldier is
  masked in the shader by a per-vertex limb bit (so all zombies share one program); the walker is drawn one mesh per part, and
  those meshes are just hidden.
- The limb that came off is copied from the skeleton in the pose it was in (vertices skinned by hand from the bones) and
  thrown: along the shot, or away from the blast. It tumbles, lands, lies for eleven seconds and shrinks away. At most three
  are copied in a frame; the rest of a big blast still bleeds.
- A bullet sprays blood forward from the hit and back toward the gun (more for the head). Nothing lights up the zombie itself: a glow added to the whole body turned a hit zombie into a flat pink silhouette. A zombie torn
  open by a blast throws lumps of flesh, a spray and a pool; every death leaves a pool on the floor.
- All of it is pooled: 512 droplets, 56 lumps, 18 thrown limbs and 20 pools, oldest recycled first, and nothing is drawn or
  updated while none is alive (`GORE_BUDGET` in `goreEffects.ts`).
- A crawler's skeleton is aimed each frame at the joints of the simulation's crawl volumes, its arms taking turns.

There is no reduced-gore setting yet, but `GoreDirector` is the one place the effects are triggered, so one would be a single
flag there.

## Looks and variety (issue #134)

What a zombie *is* (its model) is part of the simulation, because the models are shaped differently and that decides where a
shot lands: `ZombieState.variant`, chosen when it spawns by its map's `zombieLooks` weights (Bunker 3 soldiers to 1 walker,
Asylum 1 to 3). Everything else about how it looks is presentation, drawn from its id (`zombieLooks.ts`), so it is the same on
every screen and from frame to frame:

- **Colouring** from the map's palette (the Bunker's dead as they were, greener, paler or filthy; the Asylum's paler,
  gown-grey), with a little brightness of their own.
- **Build**: 95 to 106% of the height and 96 to 105% of the width.
- **Tempo and phase**: cycles play at 88 to 114% of pace, starting from a place of their own, so a crowd never walks in step.
  A cycle's pace is tied to the zombie's real ground speed, so feet stay planted whatever its tempo.
- **Bearing**: straight, hunched, head tilted, or limping (about half the dead are not straight).
- **Attack**: the walker's clip is a two-handed flail and each swing is one of its two swipes, alternately; the soldier's is one
  slow overhead blow. Each zombie's swing is also its own length (see melee above).
- **Death** at 90 to 120% of speed.

Still wanted, and the reason #134 stays open: more models (other outfits, a nurse and orderlies for the Asylum, women, children,
burnt and bloated ones), and more clips: a real crawl, several walks, runs, idles, hit reactions, deaths (from front, back,
blasts) and window and climbing animations. [zombie-art-wanted.md](zombie-art-wanted.md) lists them; the systems above take
another model or clip as data (a `RigSpec` in `zombieRig.ts`, a rig in the measure script, and a weight in a map).

## The player's knife (issue #178)

Pressing melee used to play a sound and hit the nearest zombie on that same tick, with nothing to see. Now a swing has a
shape in the core and a picture on screen, and the two are tied together (`MELEE_RULES` in `src/core/weapon.ts`, the
picture in `knifeSwing` in `src/client/weaponView.ts`).

- **Timing.** A swing lasts 48 ticks (0.8 s: nothing else can be done meanwhile, as before) and its blow lands 9 ticks
  (0.15 s) after the button: `beginMelee` announces the swing with `meleeSwung` at once, and `tickMelee` lands the blow on
  the tick a per-player counter (`meleeStrikeTicks`) reaches zero. Reach (1.6 m), facing and line of sight are read then,
  not when the button went down, so a zombie that steps out is missed and one that steps in is hit. If the player is
  downed or dead by then, or the zombie is, nothing lands. Damage, range, cooldown and points are unchanged (150 damage,
  130 points for a kill).
- **Picture.** The knife's swing is a wind-up (it rises from the lower right and is cocked beside the head), the strike,
  a follow-through across the view to the lower left and a return, while the gun drops out of the way and comes back.
  The strike is the pose at full stretch, furthest in front of the player, and it is at the same 0.15 s as the blow (a
  test finds the furthest point of the animation and requires it to be within a tick of `strikeTicks`).
- **Aiming.** A swing cancels aiming (as it already did), and the view comes out of it fast (a time constant of 25 ms
  rather than 77 ms) so the knife is not drawn through a narrow aimed lens.
- **Other actions.** Firing, reloading and switching are already blocked for the swing. A grenade or a Bouncing Betty can
  no longer be thrown or set during one either (they would have drawn over the knife); starting a swing still cancels a
  grenade wind-up and a reload. A toss animation in progress is dropped when a swing begins.
- **Rapid presses.** The core allows one swing at a time, so a knife is drawn once; the view holds one knife object,
  hidden between swings, and a test presses melee every seven ticks for five seconds and checks there is still exactly
  one and that it ends hidden.
- **Sound.** The swish plays with `meleeSwung`, at the start; a thud plays with `meleeHit`, at the strike.
- **Network.** `meleeStrikeTicks` is part of the player in snapshots (protocol 7). A client runs the swing's timing for
  itself (no hits: only the host knows what the blow reaches), so its knife and gun move at once.

The model is the gamekorp Ka-Bar, CC0 (see [assets/THIRD_PARTY_ASSETS.md](assets/THIRD_PARTY_ASSETS.md)).
Not built: the first-person hands and arms (there is no hand system yet), a separate lunge and stab, or a Bowie knife
(issue #150).
