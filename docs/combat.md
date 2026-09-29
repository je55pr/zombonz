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
