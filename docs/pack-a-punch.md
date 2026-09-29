# Pack-a-Punch

Issue #147. A machine that turns the gun in your hand into a stronger one with a name of its own. It stands in two
places: upstairs in the Bunker, where the Nacht der Untoten floor plan puts the sniper cabinet, and in the Asylum's BAR
back room.

## Using it

| | |
| --- | --- |
| **Price** | 5000 points, taken when the gun goes in |
| **Power** | Needed on a map with a power switch (the Asylum); the Bunker has none |
| **Time** | 5 seconds to upgrade, then 12 seconds to take the gun |
| **Who** | The player who paid. Everyone else sees "Pack-a-Punch is in use" until the machine is free again |
| **What goes in** | The gun in your hand. Another gun has to be in your other hand to hold meanwhile: with only one gun the machine says so and takes nothing |
| **What comes out** | The upgraded gun, full: its own bigger magazine and reserve. It goes where a bought gun goes (the second slot, or in place of the gun in hand if both are full, and the prompt says which) |
| **If it is not taken** | The gun is lost, as in Black Ops. So it is if its owner dies or leaves. The clock keeps running while the owner is down, and they cannot take the gun until they are back up |
| **Twice** | An upgraded gun cannot go in again, and a gun with no upgrade is refused with the reason |

The prompt names what is wrong instead of failing quietly: "The power must be on", "Pack-a-Punch needs a second weapon to
hold meanwhile", "The Hunter's Moon is already Pack-a-Punched", "Pack-a-Punch is in use", "E  Take Hunter's Moon [9s]".

## The upgraded guns

Every gun in the game has one. The name, and what changes, is a row of `UPGRADE_SPECS` in
[`src/core/upgrades.ts`](../src/core/upgrades.ts); a gun with no row cannot be upgraded. Unless a row says otherwise an
upgrade has twice the damage (headshot and other zone multipliers are unchanged), half as much magazine and reserve again,
a reload 15% faster, a hip spread 15% tighter, and bullets that go through one more body and keep a little more force
(never past nine tenths). The starting pistol has three times the damage; the shotguns half as much again per pellet and
twelve pellets instead of eight; the RPG-7, Irrlicht and Molniya a wider blast or chain.

| Gun | Upgraded | Glow | Damage | Magazine | Reserve | Reload | Also |
| --- | --- | --- | --- | --- | --- | --- | --- |
| M1911 | Last Rites | `#22e6ff` | 50 to 150 | 8 to 12 | 32 to 60 | 1.5 to 1.2 s |  |
| Kar98k | Hunter's Moon | `#6cc4ff` | 100 to 200 | 5 to 10 | 50 to 80 | 2.0 to 1.7 s |  |
| Springfield | Long Night | `#5a6bff` | 100 to 200 | 5 to 10 | 50 to 80 | 2.3 to 1.9 s |  |
| Mosin-Nagant | Winter's Bite | `#4dffd2` | 110 to 220 | 5 to 10 | 50 to 80 | 2.3 to 2.0 s |  |
| M1 Garand | Harbinger | `#ff8a1f` | 105 to 210 | 8 to 12 | 128 to 192 | 2.5 to 2.1 s |  |
| Thompson | Undertaker | `#ff2a4a` | 65 to 130 | 20 to 30 | 160 to 240 | 2.0 to 1.7 s |  |
| MP40 | Schnitter | `#9dff2e` | 75 to 150 | 32 to 48 | 192 to 288 | 2.3 to 1.9 s |  |
| PPSh-41 | Blizzard | `#7b6cff` | 70 to 140 | 71 to 90 | 284 to 360 | 3.5 to 3.0 s |  |
| M1A1 Carbine | Nightjar | `#b04dff` | 120 to 240 | 15 to 30 | 120 to 180 | 2.5 to 2.1 s |  |
| M14 | Redeemer | `#ffc21f` | 105 to 210 | 8 to 12 | 96 to 144 | 2.5 to 2.1 s |  |
| FN FAL | Ironside | `#ff4da6` | 130 to 260 | 20 to 30 | 180 to 270 | 2.8 to 2.3 s |  |
| STG-44 | Sturmgeist | `#39ff6a` | 100 to 200 | 30 to 45 | 180 to 270 | 2.5 to 2.1 s |  |
| FG42 | Paladin | `#ffe066` | 110 to 220 | 20 to 30 | 240 to 360 | 3.0 to 2.5 s |  |
| Commando | Deadeye | `#ff5a1f` | 100 to 200 | 30 to 40 | 270 to 360 | 2.5 to 2.1 s |  |
| AK-74u | Wolfsbane | `#7dff1f` | 100 to 200 | 20 to 40 | 160 to 240 | 2.5 to 2.1 s |  |
| MP5K | Hornet | `#ff2bd6` | 80 to 160 | 30 to 45 | 120 to 240 | 2.5 to 2.1 s |  |
| Skorpion | Stinger | `#fff01f` | 60 to 120 | 20 to 40 | 200 to 300 | 2.0 to 1.7 s |  |
| .357 Magnum | Judgement | `#ff1f3d` | 240 to 480 | 6 to 9 | 48 to 72 | 3.0 to 2.5 s |  |
| Python | Coil | `#00ffb3` | 200 to 400 | 6 to 12 | 84 to 120 | 3.0 to 2.5 s |  |
| RPK | Stampede | `#ff7a00` | 110 to 220 | 100 to 150 | 400 to 600 | 5.5 to 4.7 s |  |
| BAR | Vanguard | `#00e5ff` | 125 to 250 | 20 to 30 | 140 to 210 | 2.5 to 2.1 s |  |
| MG42 | Bonesaw | `#ff3a1f` | 120 to 240 | 125 to 200 | 500 to 750 | 6.0 to 5.1 s |  |
| Double-Barreled Shotgun | Twin Fangs | `#c03bff` | 80 to 120 | 2 to 4 | 60 to 90 | 2.8 to 2.3 s | 8 to 12 pellets |
| M1897 Trench Gun | Trench Broom | `#ffa11f` | 75 to 113 | 6 to 8 | 60 to 90 | 4.0 to 3.4 s | 8 to 12 pellets |
| SPAS-12 | Scattergale | `#4dd2ff` | 70 to 105 | 8 to 10 | 32 to 60 | 4.5 to 3.8 s | 8 to 12 pellets |
| Stakeout | Hearthfire | `#ff6a1f` | 85 to 128 | 6 to 8 | 60 to 90 | 4.0 to 3.4 s | 8 to 12 pellets |
| RPG-7 | Sundering | `#ff2b2b` | 1500 to 2550 | 1 to 1 | 4 to 8 | 2.5 to 2.1 s | blast 4 to 5 m |
| Irrlicht | Sumpflicht | `#7dff9a` | 1000 to 2000 | 20 to 30 | 160 to 240 | 3.0 to 2.5 s | blast 2.2 to 3 m |
| Molniya | Tempest | `#8fd8ff` | 1200 to 2400 | 6 to 10 | 42 to 70 | 3.3 to 2.8 s | chain 5 to 8 zombies |

These are balance choices in the spirit of the original's upgrades (about twice the damage, bigger magazines, faster
reloads), not measurements: neither Black Ops' nor World at War's weapon files are readable here. The names are this game's
own. Change any of it in one row.

An upgrade is a definition of its own, `<gun>-pap` (`UPGRADED_WEAPON_DEFINITIONS` in `src/core/weapon.ts`, built from the
gun's definition and its row), so it fires, reloads, is shown on the HUD and travels in a snapshot like any other gun, and
`weaponDefinition(id)` finds either kind. It is deliberately not in `WEAPON_DEFINITIONS`, which is the guns that can be
found and bought: the box, the wall and the tests that list "every gun" never hand one out.

Owning an upgrade counts as owning the gun it came from, in the places that ask:

- **Wall buys.** At the wall of the gun's base, with its upgrade in hand or in the other slot, you are sold ammo at the wall's
  ammo price, refilling to the upgrade's own reserve, and not the gun again.
- **The box** never offers the base gun of an upgrade you carry.
- **Max Ammo** fills an upgrade to its own, larger reserve.

## Looks and sounds

- **The machine** is built from primitives in [`src/client/packAPunchView.ts`](../src/client/packAPunchView.ts), so it needs no
  model file: a riveted steel cabinet with a lettered signboard, an intake slot, a tray, two gauges, a valve wheel, a stack,
  and three status lamps (red without power, amber while it works, green when the gun is out). It is dark without power,
  glows cool blue while it waits, forge-amber and shuddering while it works, and green with the upgraded gun hovering over the
  tray until it is taken. The glow is a light from the shared pool, so the map still has four real lights.
- **The gun in it.** The gun you paid with slides into the front, the upgraded one is pushed out of it, and it hovers with a
  slow bob. Both are the gun's own model.
- **An upgraded gun's finish** ([`src/client/packedMaterial.ts`](../src/client/packedMaterial.ts)): a dark, metallic,
  space-age skin over the whole gun, crossed by glowing circuit-board traces. Its own colour textures are dropped (its normal and
  occlusion maps stay, so the detail does) and the finish is a neutral near-black whatever the glow, because a metal reflects
  its own colour and a tinted one lights up in the colour instead of the lines. The traces are worked out in the shader from
  the gun's own space, projected onto the model from three sides, so they cover every part however its texture is laid out:
  fine traces in cells about 1.4 cm across, and a bolder set in 6 cm cells over them, with a pad wherever traces meet or end,
  and a slow pulse running along the barrel. Traces carry on from cell to cell (whether an edge is open is decided once per
  edge), thin ones are dimmed rather than widened, and the fine set fades out from a distance, where it would only make a haze.
  It is a copy of the gun's materials (the base gun's own are shared and never written to).
- **Each gun has its own glow colour**, a bright one on its row in `UPGRADE_SPECS` (`glow`): the traces, the muzzle flash and
  the gun's name on the HUD all use it. A magenta Hornet (the MP5K) has magenta traces, a magenta flash and a magenta name; the
  Kar98k is ice blue, the Thompson red, the Python teal. Different guns may share a colour. The table has them all.
- **The muzzle flash** of an upgraded gun is its glow colour, in place of the base gun's (a pale yellow, or the Irrlicht's green
  and the Molniya's blue). The guns as found are unchanged. Its sights, zoom and hip pose are the base gun's, and it sounds like
  its base gun, a little lower.
- **Sounds** are the recorded clips the game already has, as stand-ins (a clank and a hum as the gun goes in, the electric
  surge when it is ready, the pickup when it is taken, the refusal buzz): see [audio-wanted.md](audio-wanted.md).

## In the code

- [`src/core/upgrades.ts`](../src/core/upgrades.ts): the rows, `upgradeIdFor`, `baseWeaponId`, `isUpgradedWeapon`, and
  `upgradedDefinition`, which makes a definition from a gun and its row.
- [`src/core/packAPunch.ts`](../src/core/packAPunch.ts): the rules, `PackAPunchState` (idle, upgrading or ready; the owner; the
  upgraded gun; the clock), the prompts, `handlePackAPunchInteraction` and `tickPackAPunch`. It is deterministic like the rest
  of the core: nothing is random, and the same inputs give the same match.
- **Its body is solid, and comes from the simulation.** A map gives `position` (the middle of the machine's footprint on the
  floor), `yaw` (which way its front looks, a multiple of a quarter turn, as its body is an axis-aligned box) and optionally a
  `cost`; `packAPunchBlocker` makes the 1.6 x 1.0 x 2.3 m box that stops walkers, bullets, blasts and zombies' routes, and
  `packAPunchUsePoint` the point in front of it where the interactable is. So a map leaves the machine's space clear of its own
  collision, like the mystery box.
- A machine cannot be used through its own body, from behind.

## In a shared game

The host decides everything, as for every purchase. A snapshot carries each machine's phase, owner, upgraded gun and clock
(`pap` in `src/net/snapshot.ts`, in the map's order), a client's prompts are worked out from that copy, and a player's upgraded
gun arrives in their own state. `PROTOCOL_VERSION` is 8, so co-op needs matching builds.

## Adding one

To a map, in the map document ([map-format.md](map-format.md)):

```json
"gameplay": {
  "packAPunch": [{ "id": "bar-room-pap", "position": { "x": 19.5, "y": 0, "z": 9.7 }, "yaw": 0 }]
}
```

Put it against a wall with room to stand in front (`test/pack-a-punch.test.ts` checks that the body clears every wall and prop,
that a player can stand at the buy point, and that it is in the right room on both maps). A `previews` entry gives a
`?preview=` view of it for development. The Godot editor shows it as a marker.

To a gun: one row in `UPGRADE_SPECS`. The tests require every gun to have one, a name of its own, more damage, a reload no
slower, and a model to show.

## Where they are

- **Bunker:** on the upstairs wing's centre line, half way between its first and second pillars from the north end, facing south toward the stair. That is
  where the floor plan's "Sniper Cabinet" (PTRS-41, scoped Springfield, scoped Kar98k) stands, and where the map had a wooden
  cabinet as a placeholder; the cabinet is gone (from the JSON and from `bunkerLegacy.ts`, which a test holds to it).
  `?preview=packAPunch&map=bunker`.
- **Asylum:** against the BAR back room's north wall, facing the door, needing the power. Its door costs 750.
  `?preview=packAPunch&map=asylum&power=on`.

## Not built

- The upgraded guns' own models: they are the base gun's model in the space-age finish.
- The circuit lines are drawn by a shader that only a real graphics context compiles, so the tests check that it hooks into
  three.js's shader and carries the right colour, and the finish itself was checked by eye in the running game.
- Upgrading an upgraded gun a second time, and a paid ammo refill for an upgraded gun at the machine.
- A recorded soundscape for the machine: the wanted sounds are listed in [audio-wanted.md](audio-wanted.md).
- A light under the tray or steam from the stack: the glow is the shared pool's, and the machine has no particles.
