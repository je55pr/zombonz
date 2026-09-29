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
