# Simulation performance and stuck zombies

Why the simulation used to spike with a large horde (issue #186), why zombies used to stick to walls (issue #191), what
was changed, and how to keep an eye on both. Everything here is in the deterministic core (`src/core`) except the
profiler overlay and the benchmark scenarios.

## What was measured

`npm run benchmark` builds a repeatable stress run and times the simulation tick by tick. The main one, **train**, is the
worst case a player can make on purpose: 24 zombies (two thirds runners, a third sprinters) chase a player who walks a full
lap of Asylum at 3.7 m/s (a hair faster than a sprinter's 3.6): out of the German start, up its stair, through the upstairs
rooms and the power room, down the American stair, through the hallway and back, with each door opening as the player
reaches it. Ticks are 60 a second, so one has 16.7 ms.

| Asylum, 24 zombies | mean | p95 | p99 | worst tick |
| --- | --- | --- | --- | --- |
| before | 35.4 ms | 55.5 ms | 62.3 ms | 173 ms |
| after | 0.8 ms | 1.2 ms | 1.7 ms | 5.7 ms |

Before, the simulation could not keep up with real time at all. The fixed-step clock then runs several ticks in one frame
to catch up (up to a quarter of a second's worth), which is what made the F3 profiler's simulation time spike wildly: each
slow tick made the next frame do more ticks.

Two other runs are in the benchmark: **wave** (the spawn director keeps 24 alive at Asylum's windows while the oldest is
shot every second, so a spawn is wanted all the time) and **bunker** (the first benchmark this project had: 24 zombies on
the Bunker with the HELP door shut).

| Worst tick | before | after |
| --- | --- | --- |
| wave | 32 ms (a spawn check) | 2 ms |
| bunker | 11.9 ms (mean 8.0) | 2.6 ms (mean 1.1) |

## Where the time went

Almost all of it (34.9 of 35.4 ms) was `updateZombiePursuit`, and inside it, navigation. The simulation now counts the work
it does (`src/core/profiling.ts`, printed by the benchmark), and the counts show why:

| Per tick, train | before | after |
| --- | --- | --- |
| wall boxes tested against a line | 988,000 | 1,500 |
| graph nodes looked at | 20,500 | 19 |
| line tests | 8,500 | 250 |
| floor heights sampled | 53,000 | 1,900 |
| wall boxes looked at to move | 22,000 | 640 |

Four separate causes, each a scan of everything where a look at what is nearby would do:

1. **The nearest node was found by scanning the whole graph, twice per zombie per tick.** Asylum's graph has 1,106 nodes.
   The answer was cached by exact position, so a zombie that moves every tick never hit the cache, and neither did the
   goal (the player moves too). Worse, a candidate node was only line-tested if it was nearer than the best *reachable*
   one so far, so until one was found (and nodes behind walls never were) every node was tested.
2. **Every line test looked at every wall.** Asylum has 304 wall boxes. A line was tested against all of them.
3. **A zombie walked back along its route testing lines.** To pick its next waypoint it tests the far end of its route,
   then the one before, until one is in sight: up to the length of the route, each test a scan of the walls.
4. **Every door, the box or a hazard changing rebuilt the door-aware graph the same way**: about 11,000 directed links,
   each tested against every wall and walked across the floor. That is the 150 ms spike (and the spawn check ran up to
   54 routes in one tick, which is the 32 ms one).

Also, `collisionBoxes()` rebuilt and copied the whole wall list for every zombie, several times a tick.

## What changed (issue #186)

The answers did not change: each step below was checked against the old code, as described at the end.

- **`CollisionIndex`** (`src/core/collisionIndex.ts`) is a coarse grid over the wall boxes. A line, or a zombie's move, only
  looks at the boxes in the cells around it. It answers exactly what a scan of the whole list would (a box is skipped only
  when it is too far away to matter).
- **`NavigationField`** (`src/core/navigation.ts`) is everything about a map's navigation that does not change during a
  match, made once per map: the graph laid out for lookup with links pre-sorted, which links are clear of the fixed walls
  and are floor all the way (worked out the first time each is wanted, then kept), and the nodes in a grid. The nearest
  node is now found nearest first from a widening ring, so only nodes nearer than the answer are tried. Routes search
  preallocated arrays. A query for the moment's *movable* solids (shut doors, the box, hazards) is made from it cheaply,
  so a door opening costs a few milliseconds of route searches rather than a rebuild of the graph.
- **The simulation holds its solid list and index** until a door, the box or a hazard changes, rather than rebuilding
  them for each zombie.
- **`hasWalkableConnection`** only looks at the floors the line passes over.

The slowest ticks left in the benchmark are door openings (the routes for the new doors are searched afresh: 7 to 17
searches, about 4 to 5 ms).

## Watching it

- **F3** (or `?perf`) now shows the simulation tick by tick: average, p95, p99 and max in milliseconds, which stage the
  slowest tick was in, and the work per tick (routes, line tests, wall tests, searches). The frame-level "simulation" row
  is an average and hides a single slow tick, which is the stutter. `?preview=stress&perf=1&map=asylum&power=on` starts a
  24-zombie wave with the doors open.
- **`npm run benchmark`** runs the three scenarios (`-- train`, `-- wave` or `-- bunker` for one) and prints the tick
  distribution, each stage's, the slowest tick and what it was doing, the work per tick on average and at most, and the
  stall report below.
- **`SimulationProbe`** (`simulation.probe = new SimulationProbe(performance.now)`) times the stages of every tick:
  players, combat, blasts, spawning, entries, pursuit, melee, separation, and the rest. It is only ever written to, so it
  cannot change what happens. The work counters (`work`, `readWork`, `workSince`) are module totals that never influence
  the simulation either.
- **`test/simulation-cost.test.ts`** holds the simulation to what it costs now. The work counts are exact wherever they are
  run, so they carry the guarantee (per-tick means, the most any one tick does, and that a spawn check stays cheap); the
  wall-clock check (p95 under a frame) is only a coarse floor that would catch a return to the old cost on any machine.

`test/navigation-field.test.ts` is the equivalence check: a plainly correct, slow copy of the old query lives in
`test/legacyNavigation.ts`, and the fast one is held to giving the very same answer over both maps, with every door shut,
some open and all open, for hundreds of random start and goal spots (of which enough are straight at the goal, no way
through, and a node on a route to mean something). The wall index is likewise compared with a scan of every box on 1,500
lines and 1,500 moves.

### Not done, and why

- **Separation is still every pair of zombies.** At the game's cap of 24 that is 276 distance checks a tick (0.02 to
  0.06 ms), so a spatial grid would cost more than it saves. It is the first thing to change if the cap is raised.
- **Routes are searched per start and goal node pair**, not as one search from the goal that every zombie shares. That
  would need far fewer searches (one per player per tick), but it changes which of several equally short routes zombies
  take, and the point of this change was to keep every answer the same. It is the next step if door openings, the one
  place a tick still costs several milliseconds, ever matter.

## Why zombies got stuck (issue #191)

Stuck zombies came from four separate bugs, found by watching the benchmark's stall report and following the zombies it
named. A zombie is *stalled* in the report when it is out of the player's reach, means to move, is not swinging, and moves
less than a sixth of its own pace over a second; one still stalled after five seconds is *stuck*.

1. **A zombie touching a wall could see nothing at all.** `moveWithCollision` stops a zombie exactly on the edge of a wall's
   margin (the wall grown by the zombie's radius). The line test then treated the edge as the inside of the wall: from a
   position exactly on it every line back out, along the wall or away from it was "blocked". With no line clear to any
   node the zombie was given no waypoint and stood still for good. On the Bunker, two zombies stood like that for 10 s and
   4 s. Anything that pushed a zombie against a wall did it: the crowd, or a slide round a corner.
   *Fix:* touching is no longer penetrating (`CONTACT`, a tenth of a millimetre): only a line that goes into the margin
   is blocked.
2. **A zombie inside a wall's margin could never get out.** The same test found every line blocked from inside a wall. A
   zombie ends up there when the box lands on it, or it is pushed in.
   *Fix:* at the start of its move a zombie inside a margin is put back on the nearest edge of it, a shortest push along
   one axis, which cannot carry it through the wall (`pushOutOfBoxes`).
3. **A zombie could dither for ever between two waypoints.** Found on the Bunker's HELP stairs, where one stood for 24 s
   (moving 1.3 cm each way each tick, so it looked alive). It heads for the furthest node of its route that is in sight.
   On a stair whose top is a kink, whether the far node is in sight turns on a centimetre of height: from one spot it is,
   so the zombie steps toward it; from the next it is not, so the fallback is the nearer node, which is now behind it; it
   steps back; and so on. *Fix:* standing within a quarter of a metre of the first node of its route, a zombie heads for
   the next one, as the link between them was checked from the node itself.
4. **A wall-blocked shove stayed in the other zombie's body.** Two zombies too close each move half the overlap; if one is
   against a wall it cannot, and the pair stayed overlapped, jostling into the wall every tick. *Fix:* what the wall stops
   is passed on to the other zombie (`separateZombies`).

Also: a zombie in a spot no node can be walked to (a nook between nodes) used to be given no waypoint (`start`); it now
heads for the nearest node all the same. (The same gap made the spawn check see no route from any spawn to a player
standing in such a spot, so nothing could spawn until they moved.)

### Recovery, for what is left

Every recovery is deterministic, moves a zombie by a little, and cannot carry it through geometry.

1. **Sliding.** A zombie whose step gets it little closer to its waypoint (a fifth of its step or less) tries headings 45,
   90 and 135 degrees off to either side and takes whichever closes on the waypoint most. Sliding along a wall to a door
   is thereby chosen over sliding away from it. (The first version chose a side by the zombie's id, and could slide away
   from the door.)
2. **Stall detection.** `ZombieState.stall` counts the ticks a zombie has meant to move and stayed within 0.2 m of where it
   was (the anchor, `anchorX`/`anchorZ`). Measured from a fixed spot rather than tick to tick, it catches a zombie that
   shuffles or dithers, which moves every tick and gets nowhere. It clears the moment the zombie leaves the circle, or
   stops wanting to move (swinging, nobody to hunt, no way through to the player). Only the host uses these three
   fields, so they are left out of snapshots. `PROTOCOL_VERSION` is 9.
3. **Relocation.** After three seconds stalled a zombie is moved to a nearby spot (within 2 m, on the same floor, clear of
   every wall's margin) that is reached from where it stands by a line with **no wall across it**, choosing the one nearest
   the way it was heading. A zombie that is walled in with no such spot stays where it is and tries again a second later
   (`freeSpotNear`; `test/zombie-stuck.test.ts` puts one in a pen for half a minute and checks it never leaves it).

## Checking a change to any of this

`test/zombie-stuck.test.ts` reproduces each bug: the line test from a wall face on a synthetic wall and on every real
Asylum wall face (over a hundred), a zombie against and inside a wall margin, a crowd of twelve getting past a wall, the
HELP-stairs position, a zombie walled in a pen, every Asylum doorway (both directions, alone and as a crowd of six), both
stairs up and down, and the benchmark routes leaving nobody stuck. Each fix was checked to be the one the tests need by
switching it off in turn: with touching counted as inside again the wall-face tests fail, without the push out of a margin
the embedded tests fail, and without the step onto the next node the HELP-stairs test fails.

A doorway's width was never the problem: Asylum's named doors are 2.4 m wide (its stairs 4 and 5 m, the Bunker's doors
2.2 to 2.75 m) against a zombie's 0.64 m. What went wrong at a doorway was the wall beside it (bug 1) for a zombie pressed
along it, which is why the crowd tests put zombies against the wall on the way in.
