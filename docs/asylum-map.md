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
| Power door between the starts | Opens with the power |
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
There are seventeen zombie windows, as in the original's room guides:

- **Ground floor (nine):** four in the German start, three in the American start and two in the hallway.
- **Upstairs (eight):** one on the German balcony, two in Left Upstairs, two on the right balcony,
  and one each in the Speed Cola room, the kitchen and the power room.

Zombies climb into the upstairs windows off a short roof ledge outside. A window only takes zombies
once players can reach the room behind it. The other upstairs windows are decorative.

## Power, perks, traps and the box

- **Power:** the switch is on the panel in the power room. Until it is thrown, the door between the
  starts cannot be bought, and it opens by itself once the power comes on. The lamps burn low until then.
- **Perks** need the power on:

  | Perk | Where | Cost | Effect |
  | --- | --- | --- | --- |
  | Jugger-Nog | German start | 2500 | 250 health: zombies need five hits instead of two |
  | Double Tap Root Beer | German balcony | 2000 | Fire rate a third faster |
  | Quick Revive | American start | 1500 | Saves the player from one killing blow |
  | Speed Cola | Speed Cola room | 3000 | Reloads take half as long |

  The game has no downed state yet, so Quick Revive works like Black Ops' solo Quick Revive: a killing
  blow brings the player straight back at full health, and every perk is lost.
- **Electric traps:** one across each balcony, 1000 points once the power is on. A trap runs for
  25 seconds and then recharges for 25. It kills zombies that walk into it, for no points, and
  hurts players standing in it.
- **The box** starts in the power room and can move to the German start, the German balcony,
  Left Upstairs or the hallway. A pale beam of light shows where it is. The teddy bear follows
  Black Ops' odds as best I recall them: never in a spot's first four rolls, then 15%. At the
  starting spot, the roll after the eighth always brings the bear. After a move, the odds rise to
  30% after eight rolls and 50% after thirteen. The bear refunds the roll, then the box leaves and
  lands at another spot.

## Not yet implemented

- The German balcony's second entry, where zombies climb over the railing from the courtyard.
- A downed state and reviving, which Quick Revive would speed up in co-op.

## Checks

`test/asylum.test.ts` covers:

- The courtyard and two-storey footprint, and the room positions.
- Costs and wall buys.
- Round-one windows.
- Zombies climbing in through the upstairs windows.
- Buying every door from its own floor.
- Walking both stairs.
- A connected navigation graph.
- That each route reaches the power room without joining the starts.
- Zombies chasing down both routes.
- The box, and every wall buy.

`test/power-perks.test.ts` covers:

- The power door and the switch.
- Buying each perk from its own floor, only with the power on.
- Each perk's effect.
- Both trap switches, and what traps do.
- The box at every spot.
- The teddy odds and the box moving.

Development views use `?preview=<view>&map=asylum`. The views are `american`, `hallway`,
`balcony`, `upstairs`, `power`, `kitchen`, `rightBalcony`, `courtyard`, `barrier`, `upperEntry` and `juggernog`. Add `&power=on` to start with the power on,
or `&traps=on` to also set both traps running.
