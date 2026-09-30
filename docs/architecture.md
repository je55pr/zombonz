# Zombonz architecture invariants

These rules are intentionally small and difficult to accidentally violate.

## Authority

`game-core` is the authoritative simulation. It owns gameplay state and rules. Three.js, audio, UI, and networking adapters consume core state but do not become sources of gameplay truth.

## Determinism

Gameplay advances on a fixed simulation tick. Gameplay randomness comes only from the seeded RNG service. Core code must not depend on render frame pacing, wall-clock timestamps, DOM state, or `Math.random()`.

## Renderer boundary

Core modules must not import Three.js or browser APIs. Rendering may interpolate/present authoritative state, but changing a scene object must never itself change gameplay state.

## Input boundary

Physical devices map to serializable gameplay actions. Core systems consume actions, not keyboard/mouse events directly.

## Audio boundary

Audio is presentation-only. `GameAudio` translates authoritative simulation events into clip choices; `SpatialAudioManager` owns browser Web Audio routing. Positional world SFX use listener-relative pan and distance falloff, while UI and music/ambience are non-positional buses. SFX, UI and music buses sit beneath one master gain/soft ceiling and may be adjusted independently without entering simulation state. One-shot `AudioBufferSourceNode`s are necessarily single-use, but gain/panner voice chains are pooled and reused. Audio context creation/resume happens only from a user pointer/key gesture so browser autoplay policy cannot become a gameplay dependency.

## Networking boundary

Multiplayer transports are adapters around core commands/state/events. WebRTC is the first planned transport, not an assumption embedded in gameplay systems.

## Player count

Core collections are dynamic and keyed by stable entity/player identifiers. Never encode a four-player maximum into authoritative data structures.

## Visible UI

The game exposes one visible HTML canvas. World rendering, HUD, menus, prompts and other visible game UI are rendered into that canvas rather than DOM overlays.

The start menu is drawn on its own 2D canvas so the page can open without loading Three.js or the map. The game's WebGL canvas stays hidden until Solo is chosen, and the menu canvas is removed before the game canvas is shown, so only one canvas is ever visible.
