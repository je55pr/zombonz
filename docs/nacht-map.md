# Nacht geometry blockout

Target: the original **World at War** building, with three gameplay areas, three
1000-point unlocks and one fixed 950-point mystery box. This is hand-built geometry
from floor plans and screenshots, not extracted assets or a measured 1:1 recreation.
Existing placeholder materials are unchanged; no new texture assets were created.

## References

- [Downstairs floor plan](https://img.atwiki.jp/cod_blackops/attach/118/1579/Nacht_der_Untoten_-_DNST.jpg)
- [Upstairs floor plan](https://static.wikia.nocookie.net/callofduty/images/a/a4/Nacht_der_Untoten_-_UPST.jpg)
- [View from the HELP doorway](https://static.wikia.nocookie.net/callofduty/images/b/b5/Nacht_Der_Untoten_Ground_Floor.jpg)
- [Building overview](https://static.wikia.nocookie.net/callofduty/images/f/fa/Nacht_der_Untoten_Overview.jpg)
- [Room descriptions and gallery](https://callofduty.fandom.com/wiki/Nacht_der_Untoten)

The downstairs plan includes a later Mule Kick annotation; that prop is intentionally
not included in this WaW-oriented blockout.

## Layout

- L-shaped footprint, replacing the old equal-room 16×14 rectangle.
- HELP wing: x −6.2…0, z −11…7.8. Narrow, long, with a central column row.
- Spawn wing: x 0…18.2, z −2.6…7.8, with a recessed south wall at x 10.4…13.8.
- Six spawn-room columns in two rows, with concrete capitals and overhead beams.
- HELP door at (0, 0, 0), offset along the shared wall rather than centred in it.
- Main stair: a quarter-turn fan stair with a short westbound upper flight. Visible
  treads and metal rails follow the same curve as the continuous collision support.
- HELP stair: a compact south-climbing flight in the west annex, with a return landing.
- Upper level at y 3.4: a long HELP wing and smaller eastern room, connected by an
  open passage. It does not duplicate the full downstairs footprint. The main
  stairwell has a bevelled floor cutout and low perimeter wall.
- Surviving roof slabs, large sky openings, wall returns and a cabinet silhouette.
- Mystery box near the south-east corner of HELP, beside the stair end of the room.
- Five spawn-room window entries; two HELP windows plus a recessed cave breach.
- Four upper windows. These remain decorative: zombies reach upstairs via open
  stairs, not through exterior climbing routes.

Lengths, ceiling height, some landing clearances, the north upper gallery and damaged
roof edges remain approximations. The original complete wall-weapon catalogue,
exterior vehicles and all small debris placements are outside this geometry pass.

## Shared geometry and gameplay

`src/maps/nacht.ts` owns geometry, support surfaces, collision, navigation, windows,
doors, purchases and spawn locations. `src/client/bunker.ts` only adds presentation,
including authoritative barrier boards and door visibility. Polygon slabs and fan
treads are rendered in `src/client/greybox.ts`.

Support surfaces are serialized rectangles, polygons or quarter-turn ramps. A sparse
navigation grid is filtered against collision and support in **both directions**,
with sampled centre-lines along the stairs. Closed-door edges are filtered by the
existing cached runtime query. Upper slabs separately occlude bullets.

All eight ground entries retain exterior approach, individual board tearing,
single-zombie vault reservation, indoor pursuit and hold-E repairs. Spawn selection
excludes entries whose interior landing cannot reach a living player. G god mode,
F noclip, imported zombies and first-person gun assets are unchanged.

## Checks

Automated tests cover the L footprint, front recess, real upper stair holes, entry
counts, quarter-turn support, both-direction player stair traversal, both-sided
door purchases, closed routes, zombie pursuit via both stairs with HELP shut,
every entry through to pursuit, graph clearance/support, floor shot occlusion,
box placement/purchase/cooldown and deterministic state.

Development inspection URLs: `?preview=start`, `doorway`, `help`, `upstairs`, `overview`,
`barrier`, `stress`, `assets`. Preview modes open the routes and are development-only.
The normal URL starts with closed routes and the normal economy. F3 displays timings.

## Texture wish list — not created

1. Weathered cast concrete: walls, columns, capitals and ceiling beams.
2. Cracked, dusty concrete floor tiles, plus bare concrete for stairs and landings.
3. Broken plaster exposing brick/aggregate, with separate fractured-edge material.
4. Rubble and dirt blend for collapsed corners, stair debris and cave walls.
5. Splintered dark wood for window boards, HELP door, crates and mystery box.
6. Rusted steel for stair rails, window frames, reinforcing bars and box bands.
7. Torn, dirty sofa upholstery for the two stair barricades.
8. Transparent grime, damp, soot, cracks and chalk/graffiti decals.

Prefer seamless 1K/2K base-colour, normal and roughness maps; metalness only for
metal surfaces, and alpha for decals. Consistent real-world scale matters more
than high resolution for this testing map.
