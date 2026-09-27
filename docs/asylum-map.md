# Asylum

An original map in the spirit of World at War's second map, the split sanatorium. It is not a
recreation: the layout, sizes and placements are its own, authored in metres in `src/maps/asylum.ts`
with the reusable `MapBuilder` (`src/maps/mapBuild.ts`).

## Layout

Ground floor, west to east along one corridor of rooms (z −10…0), each behind a bought door:

| Room | Extent (x, z) | Notes |
|---|---|---|
| Dining hall | −26…−14, −10…8 | Solo spawn. Two storeys; Kar98k and M1A1 Carbine chalk; three entries. |
| Kitchen | −14…−4, −10…0 | Double-barrel, Thompson; one entry north, one from the courtyard. |
| Main hall | −4…6, −10…0 | The mystery box on the north wall; STG-44; two entries. |
| Surgery | 6…14, −10…0 | Trench Gun, MP40; two entries. |
| Isolation ward | 14…26, −10…8 | Two storeys; M1 Garand, BAR; three entries. |

Each tall hall has a stair along its south wall up to a mezzanine. A balcony (z 0…3, y 3.4) runs
outside the corridor's courtyard facade between the two mezzanines, so the map is one loop, WaW's
split-and-rejoin layout for a solo player: through the corridor doors, or up one stair, across the
balcony (M14 chalk) and down the other.

| Unlock | Cost |
|---|---|
| Kitchen, isolation ward doors | 750 |
| Main hall, surgery doors | 1000 |
| Each hall's stair debris | 1000 |

Twelve ground windows take zombies (six boards each); three boarded windows on the balcony facade
are decorative until exterior climbing exists. With every door shut, zombies only come through the
dining hall's three entries.

## Not yet

Power switch, perks and traps come next, in their own change. The box is fixed (no teddy-bear moves).

## Checks

`test/asylum.test.ts` covers the registry, entry and unlock counts, the spawn room, dining-hall-only
spawns at the start, buying every door from an accessible side, walking both stairs up to the
balcony and back, one connected and supported navigation graph, a runner taking the long way over
the balcony with the corridor shut, every wall buy from the floor in front of it, the box, and
bullets stopped by the balcony floor.

Development previews: add `&map=asylum` to any `?preview=` URL. Asylum's own views are `kitchen`,
`hall`, `barrier`, `balcony`, `courtyard`, `ward` and `upstairs`.
