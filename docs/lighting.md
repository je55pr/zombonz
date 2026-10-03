# Lighting and atmosphere

Lighting is presentation-only. The simulation exposes state such as whether power is on; the renderer may react to it, but lighting never feeds back into deterministic gameplay.

## Runtime pipeline

`src/client/lighting.ts` owns the map grade and expensive lighting budget: ACES exposure, exponential fog, hemisphere ambient light, the directional moon and its shadow map, practical-light power/flicker behavior, the fixed shared point-light pool, and lighting diagnostics.

Perk machines, traps, Pack-a-Punch, the mystery box and explosions still own their object-specific animation and glow. Their logical `LightSource`s share the same bounded pool as map practical lights. Point lights do not cast cubemap shadows; the fitted moon light remains the scene's shadow-casting light.

## Quality tiers

The default is **Balanced**. Development and benchmarking can select a tier before startup with `?lighting=low`, `?lighting=balanced`, or `?lighting=high`.

| Tier | Real point lights | Small-map shadow | Large-map shadow | Dirty-shadow refresh cap |
| --- | ---: | ---: | ---: | ---: |
| Low | 2 | 512² | 1024² | 10 Hz |
| Balanced | 4 | 1024² | 2048² | 15 Hz |
| High | 6 | 2048² | 2048² | 30 Hz |

Balanced is the renderer budget used before this pipeline existed. The tiers alter only expensive rendering knobs. Fog, exposure, sky/ambient/moon grade, emissive states and authored light intensity remain identical, so Low must not make navigation or interactables harder to read.

The eventual player-facing graphics control belongs with the settings/accessibility work. The query parameter exists now so the tiers can be tested and profiled independently.

## Map atmosphere

`presentation.atmosphere` is optional. Omitting it preserves the legacy Zombonz night grade. Every field is optional:

- `fogColor`, `fogDensity`
- `exposure`
- `ambientSkyColor`, `ambientGroundColor`, `ambientIntensity`
- `moonColor`, `moonIntensity`, `moonOffset`
- `skyIntensity`

Colours are 24-bit RGB integers. `moonOffset` is relative to the map focus. The panorama is still rotated so its authored moon aligns with the directional moon light.

Legacy defaults are fog `0x1d2b30 / 0.027`, exposure `1.35`, ambient `0xaabfc9 / 0x373026 / 1.4`, moon `0xb4ced7 / 2.4`, sky intensity `0.5`, and moon offset `(-12, 22, -16)`.

## Practical lights

Every `presentation.lights` entry contains `x`, `y`, `z`. Existing bare coordinate entries remain valid and retain the old warm-fluorescent look. Optional fields are:

| Field | Legacy/default |
| --- | --- |
| `color` | `0xffc38b` |
| `intensity` | `11` |
| `range` | `10` metres |
| `decay` | `1.6` |
| `priority` | `0` |
| `flicker` | `fluorescent` (`none` also supported) |
| `power` | `dim-until-power` on maps with a switch, otherwise `always` |
| `unpoweredLevel` | `0.4` |

`power` accepts `always`, `dim-until-power`, or `power-only`. This preserves Asylum's existing 40% practical-light level before power and Bunker's always-on lamps.

Example:

```json
{
  "x": 4, "y": 2.7, "z": -8,
  "color": 11776947, "intensity": 8, "range": 7,
  "flicker": "none", "power": "power-only"
}
```

## Godot authoring

The Godot map editor deliberately keeps neutral authoring lighting. The browser renderer is the source of truth for final mood.

Imported practical lights appear under the **Lighting** group as coloured gizmos. Their Inspector exposes colour, intensity, range, decay, priority, flicker, power behavior and unpowered level. **Add selected object → Light** creates another practical light.

Select the map root to edit Atmosphere values. Untouched legacy maps do not gain redundant atmosphere or default light fields on export. The shared TypeScript validator checks both imported and exported values.

Use **Export and play in browser** for final lighting checks.

## Profiling

F3 reports the normal CPU/GPU timings plus the selected lighting tier, logical light-source count, real/shining pooled lights, moon-shadow resolution and dirty-shadow refresh cap.

Use a representative route or `?preview=stress&perf=1&lighting=<tier>`, allow shaders/assets to warm, then compare p95 scene/CPU/GPU measurements. The tier limits themselves are regression-tested so an innocent map edit cannot silently create an unbounded number of real lights.

## Readability

Horror lighting can be dark, but map authors should keep player spawns and navigation-critical stairs/doors silhouette-readable before power; nearby interactables readable even with their powered emissive off; and powered/unpowered state visually distinct. Quality tiers may not alter these visibility conditions.
