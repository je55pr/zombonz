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

## Networking boundary

Multiplayer transports are adapters around core commands/state/events. WebRTC is the first planned transport, not an assumption embedded in gameplay systems.

## Player count

Core collections are dynamic and keyed by stable entity/player identifiers. Never encode a four-player maximum into authoritative data structures.

## Visible UI

The game exposes one visible HTML canvas. World rendering, HUD, menus, prompts and other visible game UI are rendered into that canvas rather than DOM overlays.
