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
