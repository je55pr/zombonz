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
There are seventeen zombie windows and one open climb, as in the original's room guides:

- **German balcony railing:** zombies also climb the courtyard wall by a drainpipe and over the
  balcony railing. There are no boards there to rebuild.
- **Ground floor (nine):** four in the German start, three in the American start and two in the hallway.
- **Upstairs (eight):** one on the German balcony, two in Left Upstairs, two on the right balcony,
  and one each in the Speed Cola room, the kitchen and the power room.

A window only takes zombies once players can reach the room behind it. The other upstairs windows
are decorative.

## How zombies come in

As in the original's early rounds, zombies appear well away from the building and shamble in, rather
than appearing at the boards:

- **Ground floor, outside:** from 16-18 m out in the grounds.
- **Courtyard:** from the far side of the courtyard, around the fountain. The courtyard windows and
  the German balcony railing are reached this way.
- **Upstairs:** single-storey brick wings run along the outside walls under every upstairs entry, with
  flat roofs at the upper floor's level. Zombies walk in from about 20 m out, climb straight up the
  wing's outer wall and cross its roof to the window.

Each entry has three spots where its zombies appear, scattered about the start of its route, so a
round's zombies come in spread out rather than single file. Routes, spawn spots, lanes and planted
trees are checked against every wall and piece of scenery by `test/entry-routes.test.ts`.

## Surroundings

What players see but never reach:

- **The courtyard:** raised beds of dead shrubs and trees, benches and old lamp posts around the
  fountain, and an abandoned wheelchair, all clear of the zombies' routes.
- **The grounds:** a brick boundary wall with concrete piers all the way round, about 26 m out, with
  a wrought-iron gateway to the south. A gatehouse stands by the gateway, and a drive with lamp posts
  runs up to the boarded main entrance on the south front. There is also a timber shed, a brick
  morgue in the north-east corner, a stripped greenhouse frame, dead trees and an old car.
- **The wings:** chimneys on their roofs, seen from the upstairs windows.

The treeline stands outside the boundary wall.

## Power, perks, traps and the box

- **Power:** the switch is on the panel in the power room. Until it is thrown, the door between the
  starts cannot be bought, and it opens by itself once the power comes on. The lamps burn low until then.
- **Perks** need the power on:

  | Perk | Where | Cost | Effect |
  | --- | --- | --- | --- |
  | Jugger-Nog | German start | 2500 | 250 health: zombies need five hits instead of two |
  | Double Tap Root Beer | German balcony | 2000 | Fire rate a third faster |
  | Quick Revive | American start | 1500 | Revives teammates twice as fast; solo, gets you back up |
  | Speed Cola | Speed Cola room | 3000 | Reloads take half as long |

  Solo, Quick Revive works as in Black Ops: after going down, the player gets back up alone after ten
  seconds, at most three times (the machine stops selling it after that).
- **Electric traps:** one across each balcony, 1000 points once the power is on. A trap runs for
  25 seconds and then recharges for 25. It kills zombies that walk into it, for no points, and
  hurts players standing in it.
- **The box** starts in the power room and can move to the German start, the German balcony,
  Left Upstairs or the hallway. Nothing marks where it went: players have to find it, as in
  Verrückt (a map can turn on a locator beam with `boxLocatorBeam`). The teddy bear follows
  Black Ops' odds as best I recall them: never in a spot's first four rolls, then 15%. At the
  starting spot, the roll after the eighth always brings the bear. After a move, the odds rise to
  30% after eight rolls and 50% after thirteen. The bear refunds the roll, then the box leaves and
  lands at another spot.

## Last stand

A killing blow puts a player down instead of killing them, as in World at War:

- They keep the view from the floor with an M1911 and spare ammo, and can shoot and reload.
- Going down costs every perk.
- Zombies leave them alone.
- A teammate holding use beside them for three seconds revives them, or a second and a half with
  Quick Revive. The revive starts over if the reviver lets go.
- They get their guns back when revived.
- Otherwise they bleed out after 30 seconds and come back at the start of the next round.
- When no one is left standing to revive, the game is over. Solo without Quick Revive, that is
  straight away.

These rules are core game rules, so they apply on Bunker too.

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
- Last stand: going down, revives (with and without Quick Revive), bleeding out, respawning, game
  over, and solo Quick Revive's three uses.

Development views use `?preview=<view>&map=asylum`. The views are `american`, `hallway`,
`balcony`, `upstairs`, `power`, `kitchen`, `rightBalcony`, `courtyard`, `barrier`, `upperEntry` and `juggernog`. Add `&power=on` to start with the power on,
or `&traps=on` to also set both traps running. `&down=on` starts in last stand, with Quick Revive.
