# Asylum

Asylum follows the layout of World at War's Verrückt: a two-storey sanatorium wrapped around an
open courtyard. It is laid out from the fan floor plans and the original map's script and effect
placements, so the proportions follow Verrückt's. It is not extracted from the original assets.
The building is 60 × 51 m around a courtyard of about 35 × 17 m, with a ruined fountain in the
middle.

## Layout

Both starts sit side by side at the south end, divided by the power door. The power room is
upstairs at the north end, and each side reaches it by its own route:

- **German side (west):** the stair in the German start → the German balcony → Left Upstairs →
  the power room.
- **American side (east):** the hallway, with the BAR back room off it → the stair at the
  hallway's north end → the right balcony above the hallway → the Speed Cola room → the
  kitchen → the power room.

```text
                               NORTH (upstairs)
  +- LEFT UPSTAIRS -+--- POWER ROOM ---+--- KITCHEN ---+- SPEED COLA -+
  |  German         |                  |               |  right       |
  |  balcony        |    COURTYARD     |               |  balcony     |
  |  (upstairs)     |    fountain      |               |  over the    |
  |                 |                  |               |  hallway     |
  |  stair ^        +------------------+               |  stair ^     |
  |  GERMAN START          | power |  AMERICAN START   |  BAR room    |
  +------------------------+ door  +-------------------+--------------+
                               SOUTH
```

| Unlock | Cost |
| --- | --- |
| Power door between the starts | 1500 |
| German stair debris / American stair debris | 1000 each |
| Left Upstairs / Right Upstairs | 750 each |
| Power room from Left Upstairs | 1000 |
| Hallway / BAR back room | 750 each |
| Kitchen from the Speed Cola room | 1000 |
| Power room from the kitchen | 750 |

The fourteen wall buys follow the original's rooms: Kar98k and Gewehr 43 in the German start,
M1 Garand and Springfield in the American start, Thompson and double-barrel in the hallway, BAR
in the back room, MP40 and double-barrel on the German balcony, STG-44 and Trench Gun in Left
Upstairs, Trench Gun and BAR on the right balcony, and the sawed-off in the Speed Cola room.
There are nine zombie windows on the ground floor. The upper windows are decorative.

## Not yet implemented

- The power switch. The power door is buyable for now, so solo play can still reach the
  American side.
- Perks.
- The electric traps on both balconies.
- The moving box. The box stays in the power room.

## Checks

`test/asylum.test.ts` covers:

- The courtyard and two-storey footprint, and the room positions.
- Costs and wall buys.
- Round-one windows.
- Buying every door from its own floor.
- Walking both stairs.
- A connected navigation graph.
- That each route reaches the power room without joining the starts.
- Zombies chasing down both routes.
- The box, and every wall buy.

Development views use `?preview=<view>&map=asylum`. The views are `american`, `hallway`,
`balcony`, `upstairs`, `power`, `kitchen`, `rightBalcony`, `courtyard` and `barrier`.
