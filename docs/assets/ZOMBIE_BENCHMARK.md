# Zombie runtime benchmark

Measured 2026-09-19 with a standalone Three.js scene in headless Chrome at 1280x720. Each run rendered 20 cloned, animated zombies for 360 requestAnimationFrame frames after loading the prepared base model and walk clip.

This is a relative asset sanity check, not a production performance promise. Headless Chrome can behave differently from a player's GPU/browser.

| Metric | Peter_D Zombie Soldier | pxltiger Zombie |
|---|---:|---:|
| Animated instances | 20 | 20 |
| Approx. FPS | 59.86 | 60.06 |
| Avg frame time | 16.71 ms | 16.65 ms |
| Draw calls | 20 | 280 |
| Rendered triangles | 143,520 | 96,480 |
| Geometries | 1 | 14 |
| Base load + walk clip | 327.5 ms | 256.2 ms |
| Runtime model errors | none | none |

## Interpretation

Peter_D is the preferred primary zombie body despite drawing more triangles. Its single shared skinned geometry produces roughly one draw call per zombie in this test, while pxltiger's 14-mesh body produces roughly 14 draw calls per zombie. Peter_D therefore gives substantially more headroom as horde size rises.

pxltiger remains useful as a secondary visual variant. Its original animation GLBs duplicated the full skinned mesh and referenced a stale `zombie.psd` path. Those clips were rebuilt as animation-only GLBs and pruned:

| Clip | Clean size |
|---|---:|
| attack | 169.54 KB |
| idle | 315.84 KB |
| run | 218.62 KB |
| walk | 255.76 KB |

All four cleaned clip files pass glTF validation with zero errors and zero warnings. The full-mesh originals and intermediate conversions are retained outside Git under `C:\ChatGPT\Shared\Scratch\ZombonzAssetStage\zombie\runtime-full-clips`.

## In-game integration check (2026-09-19)

The bunker integration uses Peter_D by default. Its full vertex records (including
UVs/normals/skin weights) are deinterleaved and indexed once at load time: 21,528
exported vertices become 4,217 unique vertices, without reducing triangles. Bind-pose
constant animation tracks are removed; cloned rigs share geometry and textures.
The directional shadow map refreshes at 15 Hz; camera, actors and weapon presentation
still render at the display frame rate. Corpses last four seconds with an eight-corpse cap.

In the 1280x720 embedded browser, `/?preview=stress&weapon=bar&perf=1` held about
60 FPS after warm-up with 24 imported soldiers and the BAR viewmodel. An observed
one-second sample showed 5.9 ms average CPU work, 16.6 ms average frame interval and
17.1 ms p95 frame interval. This environment appears limited to 60 Hz; 144 FPS remains
unverified. These are short local smoke measurements, not a cross-hardware guarantee.

The M1911 damage/kill test awarded hit and kill points and removed the corpse; the BAR
shot/reload test changed ammo from 20/140 to 19/140 then 20/139. The three real weapon
models were visually checked for orientation/scale. Automated tests load the actual
GLBs without textures to verify sizing, skeleton independence, clip binding, root
motion, batching, and event-driven muzzle flash/reload behaviour.

The alternate pxltiger rig was also visually checked. Its clip export bakes the FBX
helper transforms into pelvis keys, but the base model retains those helper nodes;
the runtime converts those keys back into local bone space and pins horizontal
root motion. A posed-bounds regression test guards against the resulting sideways
rig if that conversion is removed.
