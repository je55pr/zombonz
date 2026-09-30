# Zombie difficulty: speed, crowds and pressure

Why zombie pressure felt wrong in two opposite ways (issue #210), what was changed, and the numbers to tune it by. The
constants are all named and in the deterministic core (`src/core/zombie.ts`); `npm run difficulty` prints the measurements
below for whatever they are set to, and `test/zombie-difficulty.test.ts` pins how it feels.

## What was wrong

1. **Late rounds were glued to a walking player.** From round 10 every zombie rolls as a sprinter, and a sprinter ran at
   4.1 m/s against the player's 4.2 walk (the original numbers; the player now walks at 4.0 and sprints at 6.0). The
   player's own sprint lasts about four seconds; when it ran out a
   sprinter was at 98% of their walking pace, so any turn or corner let the horde close and nothing ever opened a gap again.
2. **A crowd cost nothing to run through.** The player had no collision with zombies at all: `separateZombies` pushed each
   zombie out of a ring round the player instead, so the player shouldered through a group at full speed. A swing needs a
   wind-up and a strike reach of 1.3 m, and a player moving at 6 m/s is out of reach before it lands.

3. **Running up to a zombie and away again cost nothing.** A swing only began within 1.1 m, and its blow lands 22 to 42
   ticks later where the player *was*, so a player who ran at a zombie and turned away was out of the 1.3 m strike range
   before it landed. Training zombies that way never got hit.

## What changed

- **Sprinters are 3.24 m/s, not 4.1**, and the player walks at 4.0 (was 4.2) and sprints at 6.0 (was 6.3). The fastest zombie
  a horde can hold is 3.5, seven eighths of the player's walk. Walking away from any zombie now opens a gap;
  sprinting opens a large one; a player who stops, or who is cornered, is still caught in seconds. Walkers (0.8) and
  runners (2.2) are as they were.
- **Every zombie has its own pace**, its gait's speed within 8% either way, fixed by its id (`zombiePaceFactor`). A horde of
  sprinters therefore strings out into a line behind a player walking away instead of arriving as one blob: the slowest
  sprinter is 3.0 m/s and the fastest 3.5, still under a walking player. The client plays each zombie's run cycle at its own
  pace so feet stay planted.
- **Zombies are solid to the player** (`blockPlayerByZombies`). After the player moves each tick they are put back on the
  edge of any body they have run into (bodies touch at 0.66 m, the player's radius and a zombie's), so they slide round a
  zombie rather than through it; the part of their speed that carried them into it is taken off and the part that runs along
  it is kept. Two zombies closer than 1.32 m apart (a player's width and both of theirs) leave no way through.
  - **A swinging zombie does not give way.** One that is free (not swinging, not coming through a window) gives way by 30%
    of a squeeze, so a player can shoulder past it slowly (`ZOMBIE_GIVE`); `separateZombies` moves it the rest of the way.
    A zombie that is swinging holds its ground and is not pushed by the player either.
  - **A wedge stops the player where they were.** Between three or more bodies there can be no spot in reach that clears
    them all; rather than leave the player inside one, they stay where they were the tick before (`WEDGE_DEPTH`).
  - **Walls still hold**: the push cannot carry the player through one. Downed players, zombies on another floor (over a
    metre up or down), zombies mid-window and noclip are left alone.
  - **Co-op predicts it too**: a client's own movement is stopped by the zombies as it sees them (`PredictionWorld.zombies`),
    so it is not pulled back when the host says the same.
- **Zombies queued behind a fight wait, they are not "stuck"** (`holdBehindFighters`). A crowd that now stands still round a
  pinned player used to trip the stuck-zombie recovery from issue #191: a zombie at the back was taken for stuck after three
  seconds and put down "on a free spot nearby", which in a crowd is through the ones in front, on top of the player. A
  zombie touching others that are swinging, or that are against a player, has its stall count restarted; a jam with no
  fighter in it (zombies wedged on a corner) recovers as before.

- **Zombies keep coming while they swing** (`updateZombiePursuit`). They used to halt within 1.1 m and plant their feet to
  swing, stopping short of a player they could have reached. A zombie now closes on its target through the wind-up and the
  recovery, and stops only when it touches them (`ARRIVED`), so it never pushes them along. Three things follow: a zombie
  that is mid-swing is not counted as stalled (it is busy, not stuck); one swinging on the spot holds its ground while one
  swinging on the move is jostled like any other; and separation now runs as up to four passes (stopping as soon as nothing
  is more than 5 mm off), because a queue pressing on a zombie that holds its ground could not be settled in one.
- **The blow has a window** (`ZOMBIE_MELEE.hitWindow`, `advanceSwing`). The blow was a single-tick check at contact, so a
  player in reach the tick before and out of it on the tick, or arriving a tick late, was missed however close it looked. It now
  lands at contact on whoever is in reach then, and also on whoever was in reach in the 4 ticks before and has stepped out, and
  whoever comes into reach in the 8 ticks after. A standing player is hit on the same tick as before; a dodge has to be made a
  little sooner (4 ticks, about 70 ms). Each swing is still one blow (`ZombieState.blow`, host-only).
  What it does not do is reach further: with the reach then at 1.3 m, running past a zombie at arm's length was hit 100% of
  the time at 1.2 m or closer and 0% at 1.4 m or further, with the window or without it, because a player who is passing is
  already met by the early swing. (The reach was raised afterwards, below.)
- **Reach 1.5 m, grace 0.3 s, a wider swarm** (tuned after the window). `ZOMBIE_MELEE.reach.strikeRange` is 1.5 m (a crawler's 1.3), so
  running past a zombie at arm's length is now hit at up to 1.4 m and missed from 1.5 m. A landed blow gives the player 18 ticks
  (0.3 s) of grace, not 30, so a crowd's blows come faster: two zombies down a player in 0.8 s (sprinters), 1.1 s (walkers),
  where it was 0.9 and 1.3. And `ZOMBIE_SPACING` is 0.72 m between zombies' middles, up from 0.58: a swarm round a standing
  player is about 14% wider (90% of it within 1.8 m of its middle, was 1.6) and a horde on a walking player's heels about a third
  wider at 5 s (2.2 m, was 1.6); nearest neighbours sit 0.72 m apart, not 0.57.
- **Zombies read where you are going** (`willConnect` in `tickZombieMelee`, `ZOMBIE_MELEE.anticipation`). A zombie also
  starts its swing when the player, at the speed and heading they have now, and it, still coming, will be within strike range
  as the blow lands, so it begins about 3 m out for a player running at it and the blow arrives with them. It looks at most
  2 m of the two's travel ahead and only at a player in front of it. A player who stops short, turns off or backs away once it
  has begun is missed if that takes them out of reach; a zombie is committed by then and still closing, so a feint has to be
  made before the swing begins (4 m out in the table below), not after.

Not changed: round sizes, zombie health, the spawn interval and the 24-alive cap (all ported from WaW/BO1, and solo and
co-op scale as before: each extra player adds a full share to a round), the gait roll by round, the melee timings (only
when a swing may start, and whether the zombie moves during it, changed), damage (50 a blow).

## The numbers

Speeds, in m/s: the player walks 4.0 and sprints 6.0 for four seconds (then a pause, and a recharge). Zombies:

| Gait | Speed | With each zombie's own pace |
| --- | --- | --- |
| walk | 0.8 | 0.74 to 0.86 |
| run | 2.2 | 2.02 to 2.38 |
| sprint | 3.24 (was 4.1) | 2.98 to 3.50 |

The mix by round is WaW's: round 1 all walkers, runners from round 2, walkers gone by round 6 where the first sprinters
appear (12%), 57% sprinters in round 8, and all sprinters from round 10.

**A chase** (`runChase`): a sprinter three metres behind a player on open ground, the gap in metres after 1, 5, 10 and 20 s.
Nobody was hit in any of these.

| Player | Before (original game) | After |
| --- | --- | --- |
| walking | 2.7, 3.1, 3.6, 4.6 | 3.2, 5.4, 8.2, 13.7 |
| sprinting whenever stamina allows | 4.4, 11.1, 15.8, 25.2 | 4.8, 13.1, 19.8, 33.3 |

**A crowd** (`runCrowd`): a group of running zombies coming the other way, six layouts each, the player sprinting. Blows
taken (with the player unkillable, so a run that is stopped keeps taking them) and how many of the six got through:

| Zombies in the group | 1 | 2 | 3 | 6 | 12 |
| --- | --- | --- | --- | --- | --- |
| straight through, before | 0.0 / 6 | 0.0 / 6 | 0.0 / 6 | 0.0 / 6 | 0.0 / 6 |
| straight through, after | 1.0 / 6 | 1.0 / 6 | 14.0 / 0 | 14.0 / 0 | 14.0 / 0 |
| steering round, before | 0.0 / 6 | 0.0 / 6 | 0.0 / 6 | 0.0 / 6 | 0.0 / 6 |
| steering round, after | 0.0 / 6 | 0.0 / 6 | 1.0 / 6 | 1.0 / 6 | 1.0 / 6 |

Read as: one or two zombies can be run past (they cost a blow); three side by side (bodies 1.1 m apart, so no gap a player
fits) are a wall, and running into one is a dead stop under blows (14 in eight seconds; in a real game two put the player
down). The way round stays open, but a player who steers close round a whole group now takes a blow, at most one, where
before it was free. That is the shape asked for: running through a crowd is no longer free, and a player with good movement still
creates space and trains a horde.

**Running up to a sprinter and away again** (`runRunUp`): the player runs at one coming for them, turns at the distance
shown and runs the other way; blows taken per run (mean of six tempos), and how far off the zombie began its swing.

| Player turns at | 0.7 m (touching) | 2.5 m | 4 m |
| --- | --- | --- | --- |
| walking, before | 0.0, swing at 1.2 m | 0.0, 1.1 m | 0.0, no swing |
| walking, after | 1.0, swing at 3.4 m | 0.2, 3.4 m | 0.0, 3.4 m |
| sprinting, before | 0.0, swing at 1.2 m | 0.0, 1.1 m | 0.0, no swing |
| sprinting, after | 1.0, swing at 3.4 m | 1.0, 3.4 m | 0.0, 3.3 m |

So running right up is punished (a blow, which is half a life; a walker gets a second as it follows), and a player who turns
after the swing has begun is caught too, because the zombie is committed and still closing. Turning away at 4 m, before it
begins, dodges it (and the zombie swings at nothing).

## Tuning it by feel

| Constant | Now | What it does |
| --- | --- | --- |
| `ZOMBIE_GAIT_SPEEDS.sprint` | 3.24 | How near a late-round zombie runs to a walking player (81%; the fastest, at +8% pace, is 3.5 or 87%). Raise it and walking away opens a gap more slowly. |
| `PLAYER_MOVEMENT.maxSpeed` | 4.0 | The player's walk (sprint is 1.5 times it). |
| `ZOMBIE_PACE_SPREAD` | 0.08 | How strung out a horde gets; 0 makes every zombie of a gait identical. |
| `ZOMBIE_GIVE` | 0.3 | How much a free zombie yields to a shoulder; 0 makes every zombie a wall. |
| `WEDGE_DEPTH` | 0.05 m | How deep in the bodies round them a player is before they are stopped where they were. |
| `ZOMBIE_MELEE.anticipation` | 2 m | How far ahead a zombie reads (the two's travel while it winds up): it never starts a swing from further out than reach plus this, about 3.3 m. Raise it and it swings from further out and catches more feints. |
| `ZOMBIE_MELEE.reach.strikeRange` | 1.5 m (crawler 1.3) | How far a blow lands from. Raise it and more near-misses connect and more of a crowd reaches over its front row. |
| `ZOMBIE_MELEE.hurtGraceTicks` | 18 (0.3 s) | How long a player is safe from every other zombie after a blow: lower it and a crowd's blows come faster. |
| `ZOMBIE_SPACING` | 0.72 m | How far apart zombies keep their middles: a bigger number makes a wider, looser swarm. |
| `ZOMBIE_MELEE.hitWindow` | 4 before, 8 after (ticks) | How long the blow is live around contact: raise either and more near-misses land; both 0 is the old one-tick check. |
| `ARRIVED` | touching plus 4 cm | How near a zombie gets before it stops closing on its target. |
| rest of `ZOMBIE_MELEE` (`zombieMelee.ts`) | unchanged | Wind-ups, recoveries, reach, arcs and the hurt grace: how long a player in contact survives. |

`npm run difficulty` recomputes the tables above; the tests in `test/zombie-difficulty.test.ts` will say which claim a
change breaks (walking must always outpace the fastest zombie a horde can hold, a group of three or more must stop a
straight run, steering round must cost at most a blow, running right up to a zombie must connect, and turning away before
its swing begins must dodge; a zombie must keep coming while it swings, not be counted stuck, and not merge into the ones
beside it).

## Not covered

- Only measured against scripted players on open ground. How it plays in Asylum's corridors and doorways, where a crowd
  cannot be steered round, is for hands-on play, as is whether 3.24 m/s and a 30% give feel right.
- Co-op with a real second player: a client predicts against zombies a moment old, so a shove can be corrected by a few
  centimetres. Not tried over a real connection.
- The stuck-zombie recovery and the wall-aware navigation from issues #191 and #186 are unchanged apart from the queue rule
  above; `npm run benchmark` shows no change in what a tick costs.
