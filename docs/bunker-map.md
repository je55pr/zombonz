# Bunker geometry blockout

Target: the original **World at War** building, with three gameplay areas, three
1000-point unlocks and one fixed 950-point mystery box. This is hand-built geometry
from floor plans and screenshots, not extracted assets or a measured 1:1 recreation.
The environment pack from `dev` now supplies the PBR materials and prop dressing.
No new source textures were generated. See [environment integration](assets/ENVIRONMENT_PACK.md).

## References

- [Downstairs floor plan](https://img.atwiki.jp/cod_blackops/attach/118/1579/Nacht_der_Untoten_-_DNST.jpg)
- [Upstairs floor plan](https://static.wikia.nocookie.net/callofduty/images/a/a4/Nacht_der_Untoten_-_UPST.jpg)
- [View from the HELP doorway](https://static.wikia.nocookie.net/callofduty/images/b/b5/Nacht_Der_Untoten_Ground_Floor.jpg)
- [Building overview](https://static.wikia.nocookie.net/callofduty/images/f/fa/Nacht_der_Untoten_Overview.jpg)
- [Room descriptions and gallery](https://callofduty.fandom.com/wiki/Nacht_der_Untoten)

The downstairs plan includes a later Mule Kick annotation; that prop is intentionally
not included in this WaW-oriented blockout.

## Scale

The plan is authored in its original blockout coordinates (the numbers below) and mapped out by
`src/maps/bunkerPlan.ts` at **1.35×**. The first blockout felt cramped. WaW's own interior effect
placements (ceiling lights, god rays and room smoke in the map's createFX file) put the spawn
room at roughly 23–25 × 10–12 m and the HELP wing at roughly 33 × 9 m. The mapping gives about
24.6 × 14 m and 8.4 × 25.4 m.

Only the plan grows:
- Heights, wall thickness, doorways, windows, columns, props, wall buys and the box keep their
  real sizes.
- Anything within 0.9 m of a wall keeps its distance from that wall (`px`/`pz`).
- The main stair and its floor cutout scale as one shape (`ps`).

## Layout

- L-shaped footprint, replacing the old equal-room 16×14 rectangle.
- HELP wing: x −6.2…0, z −11…7.8 (blockout). Narrow, long, with a central column row.
- Spawn wing: x 0…18.2, z −2.6…7.8 (blockout), with a recessed south wall at x 10.4…13.8.
- Six spawn-room columns in two rows, with concrete capitals and overhead beams.
- HELP door at (0, 0, 0), offset along the shared wall rather than centred in it.
- Main stair: a quarter-turn fan stair with a short westbound upper flight. Visible
  treads and metal rails follow the same curve as the continuous collision support.
- HELP stair: a compact south-climbing flight in the west annex, with a return landing.
- Upper level at y 3.4: a long HELP wing and smaller eastern room, connected by an
  open passage. It does not duplicate the full downstairs footprint. The main
  stairwell has a bevelled floor cutout and low perimeter wall.
- Surviving roof slabs, large sky openings and wall returns. Upstairs on the wing's centre line, where the floor plan's sniper
  cabinet stands (and where the blockout had a wooden cabinet), is a Pack-a-Punch machine ([pack-a-punch.md](pack-a-punch.md)).
- Mystery box near the south-east corner of HELP, beside the stair end of the room.
- Five spawn-room window entries; two HELP windows plus a recessed cave breach.
- Four upper windows with exterior climb routes and repairable barriers. Their spawn
  points become eligible from round four, once the interior landing can reach a player.

Lengths, ceiling height, some landing clearances, the north upper gallery and damaged
roof edges remain approximations. The original complete wall-weapon catalogue and all
small debris placements are outside this geometry pass.

Outside, in the fog, is a barbed-wire perimeter on timber posts with a gateway to the
south, a watchtower, a timber hut, a half-buried concrete pillbox, a ruined brick wall,
a sandbagged machine-gun nest, sandbags and tank traps across the south field, a jeep that explodes when
shot and a burnt-out light tank. The treeline stands outside the wire. Fuel barrels (in the start room
and out in the yard) explode when shot too, and a shelf on the start room's north wall sells Bouncing
Betties for 1000 points (`BUNKER_HAZARDS`, `BUNKER_EQUIPMENT`).

## Shared geometry and gameplay

`src/maps/bunker.ts` owns geometry, support surfaces, collision, navigation, windows,
doors, purchases and spawn locations. `src/client/bunker.ts` only adds presentation,
including authoritative barrier boards and door visibility. Polygon slabs and fan
treads are rendered in `src/client/greybox.ts`.

Support surfaces are serialized rectangles, polygons or quarter-turn ramps. A sparse
navigation grid is filtered against collision and support in **both directions**,
with sampled centre-lines along the stairs. Closed-door edges are filtered by the
existing cached runtime query. Upper slabs separately occlude bullets.

All eight ground entries and four upstairs entries have exterior approaches, individual board tearing,
single-zombie vault reservation, indoor pursuit and hold-E repairs. Zombies appear about
15 m out in the fog (the cave breach's at the far end of its collapsed tunnel), at three
spots per entry, and shamble in. Spawn selection excludes entries whose
interior landing cannot reach a living player. L god mode,
K noclip, imported zombies and first-person gun assets are unchanged.

## Checks

Automated tests cover the L footprint, front recess, real upper stair holes, entry
counts, quarter-turn support, both-direction player stair traversal, both-sided
door purchases, closed routes, zombie pursuit via both stairs with HELP shut,
every entry through to pursuit, graph clearance/support, floor shot occlusion,
box placement/purchase/cooldown and deterministic state.

Development inspection URLs: `?preview=start`, `doorway`, `props`, `help`, `upstairs`, `packAPunch`, `overview`,
`barrier`, `stress`, `assets`. Preview modes open the routes and are development-only.
The normal URL starts with closed routes and the normal economy. F3 displays timings.

## Texture wish list — now supplied by the environment pack

1. Weathered cast concrete: walls, columns, capitals and ceiling beams.
2. Cracked, dusty concrete floor tiles, plus bare concrete for stairs and landings.
3. Broken plaster exposing brick/aggregate, with separate fractured-edge material.
4. Rubble and dirt blend for collapsed corners, stair debris and cave walls.
5. Splintered dark wood for window boards, HELP door, crates and mystery box.
6. Rusted steel for stair rails, window frames, reinforcing bars and box bands.
7. Torn, dirty sofa upholstery for the two stair barricades.
8. Transparent grime, damp, soot, cracks and chalk/graffiti decals.

The checked-in pack supplies these surface categories. Runtime decoding caps the
2K source textures at 1K; base colour is sRGB and normal/packed ARM maps are linear.
The modern graffiti atlas is intentionally unused to preserve the period setting.
