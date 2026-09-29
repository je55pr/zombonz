# Audio wanted for explosives

The explosions, grenades, Bouncing Betties, barrels and cars currently use the game's existing recorded clips
as stand-ins (one small bang, one large bang, and a few metal and mechanical sounds), which is thin for
what they are. This is the list of recordings that would replace them. Nothing here is synthesized: the
game plays recordings only.

## What I need from each file

- **Licence:** CC0, or CC BY with the creator's name. It ships in a public repo as an MP3 derivative, so
  "free to use but not to redistribute" packs will not do. Every source goes in
  `public/assets/ATTRIBUTION.txt`.
- **Format:** WAV or OGG originals, 44.1 or 48 kHz, mono is fine (stereo is folded down). The originals
  stay outside the repo; `scripts/prepare_audio.py` trims, converts to 32 kHz mono MP3 and caps the length.
- **Dry:** no long baked-in reverb or room tail beyond what the list says, and no music or voices. The first
  sample should be the start of the sound: no leading silence.
- **Level:** any. Each clip is measured when the game loads and its loudest 50 ms is brought to a common level
  (by at most 12 dB either way), so how loud each kind is against the others is set in code, not in the files.
- **Length:** the game trims to the maximum listed, so a longer recording is fine if the sound has died away
  by then.

## Must have

These are the ones that make it sound right. Ten names, sixteen files.

| Name | Files | What it is | Length | Plays when |
| --- | --- | --- | --- | --- |
| `blast-frag` | 1 | A hand grenade or rocket warhead: one sharp, mid-sized explosion. Hard crack on top, a low thump under it, a short rattle of debris. Neither a firework nor a cannon. | 1.5–2.5 s | Every frag grenade and rocket. |
| `blast-mine` | 1 | The Betty: drier and snappier than the grenade, with a bright crack and dirt and gravel thrown up (a whistle of fragments is welcome). | 1.2–2 s | A Bouncing Betty going off. |
| `blast-barrel` | 1 | A fuel drum going up: a big fireball WHUMP with a low body, a roar of flame and a clatter of metal pieces falling. | 2.5–3.5 s | A barrel exploding. |
| `blast-vehicle` | 1 | A car or truck: much bigger and lower than the barrel, in two parts (the first boom, then a secondary fuel whump), a rolling fire roar and crunching metal debris. It has to hold up pitched down about 20%. | 4–5 s | A jeep or truck exploding. |
| `grenade-pin` | 1 | The pin and spoon coming off a grenade: a bright metallic ping and tick. | 0.3–0.6 s | The moment a grenade is thrown. |
| `grenade-bounce` | 3 | A grenade knocking on concrete, stone and metal: a short dull thud with a clink on top. Three different takes, so a bouncing grenade doesn't repeat itself. | 0.15–0.35 s each | Every hard bounce. |
| `mine-pop` | 1 | The Betty's launching charge: a dull thunk of the charge, then a short spring or whirr as the canister leaps. | 0.4–0.7 s | A mine springing. |
| `barrel-hit` | 3 | A bullet striking a steel drum: a hollow metallic bong with a sharp tick at the front. | 0.3–0.6 s each | Every bullet that hits a barrel. |
| `vehicle-hit` | 3 | A bullet striking a car body: a flat sheet-metal thunk with a clank. | 0.25–0.5 s each | Every bullet that hits a jeep or truck. |
| `fire-ignite` | 1 | Fuel catching light: a soft whoomph and a hiss of flame. | 0.8–1.3 s | A barrel or car starting to burn. |

## Nice to have

| Name | Files | What it is | Length | Plays when |
| --- | --- | --- | --- | --- |
| `fire-loop` | 1 | A burning car or drum: a low flame roar with crackles. **Must loop with no click.** | 3–6 s | While a vehicle burns, and for a while after it goes off. Needs a looping player added in code. |
| `debris-rain` | 2 | Bits of metal and masonry falling and skittering after a blast. | 1.5–2.5 s each | About half a second after every blast. |
| `mine-place` | 1 | Setting a mine on the ground: a heavy thunk and a stake or spike pressed in. | 0.3–0.6 s | Setting a Betty (now a button click and a mechanical click). |
| `mine-arm` | 1 | A small mechanical click or short electronic beep. | 0.15–0.3 s | A Betty finishing arming (now a mechanical click). |
| `grenade-throw` | 1 | An arm swing: a short whoosh, with a little effort if it comes with one. | 0.25–0.4 s | The throw. |
| `nuke-boom` | 1 | The biggest sound in the game: a huge, low boom with a long tail, for the Nuke power-up. | 4–6 s | A Nuke (now the large bang pitched down). |
| `blast-ring` | 1 | The ringing in the ears after a very close explosion, fading out. | 2–3 s | Being hurt by a blast at close range. |

## What plays now

| Event | Stand-in (existing clip, pitch) |
| --- | --- |
| Grenade thrown, grenade bounce | `door-metal`, pitched up |
| Grenade, rocket and Betty explosions | `explosion-small` (the rocket pitched down a little) |
| Barrel explosion | `explosion-large` |
| Vehicle explosion | `explosion-large`, pitched down and louder |
| Bullet on a barrel or a vehicle | `door-metal`, pitched down (lower for a vehicle) |
| Betty set, armed | `mechanical-button` and `mechanical-click` |
| Betty springing | `mechanical-button`, pitched down |
| A barrel or car catching fire, burning | nothing |

## Where to look

Search for the names of the sounds on [Freesound](https://freesound.org) with the licence filter set to Creative
Commons 0 (or Attribution), and on [OpenGameArt](https://opengameart.org) with the CC0 licence filter. Terms that
tend to turn up the right thing: `grenade explosion`, `mortar`, `fuel explosion`, `car explosion`, `oil drum hit`,
`metal barrel impact`, `bullet impact car`, `grenade pin`, `grenade bounce`, `fire burning loop`, `debris falling`.
The existing bangs came from "25 CC0 bang / firework SFX" (rubberduck), which is why they read as small.

## Wiring a clip in

Each one is: drop the file in beside the other sources, add a row to `CLIPS` in `scripts/prepare_audio.py` (source,
runtime name, maximum seconds), run it, add the name to `AUDIO_CLIPS` in `src/client/audioClips.ts`, and swap the
stand-in in `src/client/audio.ts` for the new name (with a variant chosen per event where there are several files).
The mix level for each kind is in `MIX` there.

## Pack-a-Punch

The machine (see [pack-a-punch.md](pack-a-punch.md)) plays the game's existing clips as stand-ins. The recordings that would
suit it: a heavy metal clunk with a rising electrical hum for the gun going in; a machine working, looped, a few seconds of
pistons and a low resonant whine; a bright chime with a hiss of steam for the gun being ready; and a solid clack of the tray
for taking it. Same requirements as above.

| Event | Stand-in (existing clip, pitch) |
| --- | --- |
| The gun goes in | `door-metal` pitched down, `mechanical-button` pitched down and `electric-powerup` |
| Working | nothing |
| The gun is ready | `electric-powerup` and `pickup` pitched up |
| The gun is taken | `pickup` and `mechanical-click` |
| Refused (power, second gun, unsupported) | `buy-denied` |
