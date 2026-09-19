# Nacht bunker prototype

The reference is the original Nacht room connectivity: the starting room connects
to the Help room through the HELP door, and each ground-floor room has a stairway
to the upstairs. Both stairs can be cleared to reach the Help room without buying
the HELP door. The upstairs has two wings connected through a broad central passage.
There is exactly one fixed mystery box, beside the shared wall in the Help room.

References: [room layout](https://callofduty.fandom.com/wiki/Nacht_der_Untoten)
and [fixed box location](https://callofduty.fandom.com/wiki/Mystery_Box/Spawn_Locations).
This is original procedural geometry with approximate dimensions, not an extracted
or metrically accurate reproduction of the source map. The weapon pool is deliberately
small; all current guns use the existing hitscan simulation.

## Coordinates and authority

- Ground floor footprint: x = -8 to 8, z = -7 to 7.
- Starting room: negative x. Help room: positive x.
- Upstairs: y = 3.4, with real holes over the two stair runs.
- Starting stairs: west side, climbing south. Help stairs: east side, climbing north.
- HELP door, both stair barricades: 1000 points each.
- Mystery box: 950 points, one immediate replacement weapon, 180-tick cooldown.

`src/maps/nacht.ts` is the shared source for collision, walk surfaces, navigation,
doors, wall purchases, barriers and box placement. `src/client/bunker.ts` adds
presentation only, including board visibility driven by the simulation.
Spawn selection checks the window's inside landing, excluding rooms with no open
route to a living player and preventing rounds from stalling behind an unopened door.

Eight ground-level windows have exterior entry routes. Spawns are five metres
outside the wall, with ordered exterior waypoints, three staging lanes, a shared
75-tick board-tearing interval and a 90-tick climb. A reserved crossing slot prevents
simultaneous vaults, releases when the occupant dies, and disallows rebuilding while
occupied. The climb lifts the zombie above the sill before moving across the opening;
only that explicit entry link bypasses normal wall collision. Its crouched presentation
and hitbox fit the window. No melee damage occurs before a zombie lands inside.

Holding E near a damaged window restores one board every 60 ticks; releasing E or
leaving the interaction resets partial repair progress. Repairs are free and grant no
points. Board damage persists between rounds and resets on a new match. Barrier state,
entry phases, queue ownership and timers are serializable and deterministic.

The upper windows remain decorative: exterior zombies reach the upstairs through
opened stairs instead of spawning in mid-air. The north-east ground-floor window is
also decorative because its inside landing would intersect the stair structure.

The navigation graph is filtered against closed doors and actual walk surfaces.
The compiled query is shared between enemies and rebuilt when a door changes.
Floor slabs separately block shots; movement uses support surfaces for stepping onto
landings. Melee respects vertical distance and walls. Interaction sight checks stop
players buying the box or wall weapons through the shared room wall.

## Validation

Automated coverage includes walking up and down both stairs; closed routes; zombie
pursuit through both stairs with HELP shut; graph clearance and support; accessible
spawns; cross-floor melee/bullet occlusion; box price, cooldown, seeded replay,
insufficient funds, wall occlusion and restart reset.
Exterior-entry coverage additionally checks every active window through to player
pursuit, individual board timing, group queues, shooting an outside attacker, death
during a vault, locked-room spawn filtering, repair holds, and replay after restoring
a snapshot mid-vault.

Development-only inspection URLs (`?preview=start`, `help`, `upstairs`) allow visual
checks without waves. The default URL retains normal starting points and closed routes.
`?preview=barrier` places the camera facing the first window and runs a live wave there.
