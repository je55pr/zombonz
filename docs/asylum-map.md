# Asylum

The footprint now follows World at War Verrückt's defining shape: a compact, two-storey
sanatorium wrapping an open courtyard. The ground-floor German and American starts face one
another across a closed gate. Each side pushes away from the start, through its own wing and
stairwell, and converges in the power room on the opposite side. The bathroom sits beside the
power room on the west route, the kitchen on the east route. The upper floor forms a second,
constricted loop overlooking the courtyard.

This is a playable geometric interpretation, not a measured extraction of the original game
assets. The building is 36 × 36 m around a 16 × 16 m open courtyard. Corridors and rooms are
deliberately narrower than the old Asylum's long row of halls. A ruined fountain marks the centre.

## Current gameplay

Solo begins on the German side. Windows in the starting room are the only round-one entry points
while the routes are shut. Ground windows on the outer perimeter and the courtyard facade become
zombie barriers; upper windows remain decorative. The map has eleven buyable obstructions, ten
wall weapons, one mystery box in the power room, and two walkable stairs. Both ground and upper
routes are included in navigation.

The start gate is buyable for now. Verrückt's power switch, electricity, perks and traps are not
yet implemented in the game's interaction system; gating the start door permanently would make
the opposite wing inaccessible in solo play. The box is also fixed for now.

## Layout sketch

```text
                  NORTH
      +----- BATH -- POWER -- KITCHEN -----+
      |                                    |
      |  WEST WING    COURTYARD   EAST WING|
      |  + stair      FOUNTAIN    + stair  |
      |                                    |
      +---- GERMAN START | AMERICAN START -+
                     SOUTH
```

## Checks

`test/asylum.test.ts` covers the courtyard-ring geometry, split starts, room and stair placement,
starting-window selection, purchases, actual stair walking, connected navigation, and box use.
Development views use `?preview=<view>&map=asylum`; available views include `hall`,
`courtyard`, `kitchen`, `upstairs`, and `power`.
