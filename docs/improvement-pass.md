# Solo gameplay improvement pass

## Direction and boundaries

WaW / BO1-inspired, not a claim of frame-exact emulation. Preserve the Nacht
geometry, imported assets, deterministic core and refresh-rate-independent renderer.
User decisions: polish solo play and atmosphere first; perks and Pack-a-Punch later.
Keep work in focused local commits; no remote pushes without approval.

## Audit (2026-09-26)

Baseline: 145 tests pass; typecheck and production build pass. One existing bundle-size warning.

Working: fixed-tick seeded simulation, rounds and spawn director, exterior approaches,
board tearing/repair/vaulting, stair navigation, collision, doors, wall purchases,
five gun definitions, imported animated zombies and three gun models, environment
materials/props, one fixed box, canvas HUD, restart, debug controls, performance overlay.

Clear gaps found in code:

- Zombie health is always 150; surviving longer barely changes weapon effectiveness.
- Damage is permanent, with no recovery or useful damage feedback.
- No headshot classification, knife, or repair points.
- Only one carried gun. Purchases silently replace it; buying full ammo still charges.
- Mystery box instantly grants a gun, with no roll, owner, claim or expiration.
- No combat audio/hit marker; no useful reload/empty-ammo feedback.
- Focus loss does not release input, risking stuck movement/firing.
- No sprint/ADS, grenades, power-up drops, perks, Pack-a-Punch, pause/settings or co-op.
- Network code is a transport contract/loopback, not playable online multiplayer.
- Dead simulation entities remain forever even after corpse visuals disappear.

## Selected milestones

1. Survival/combat: delayed health recovery, scaling zombie health, headshots,
   short-range knife, capped repair rewards; deterministic tests.
2. Acquisition: two carried weapons, deliberate switching, safe wall-ammo purchase,
   seeded box roll/claim/timeout with visible state; deterministic tests.
3. Feedback/reliability: hit/kill/damage/reload/purchase feedback, original synthesized
   audio, focus-loss input release, bounded corpse-state retention; browser smoke
   checks and repeatable performance check.

## Later backlog

Sprint/ADS and weapon handling tuning; grenade/power-up loop; more authentic weapon
roster and animations; directional/spatial ambience; settings/pause; solo perks and
Pack-a-Punch; then revive/networked co-op. Do not introduce services or buy assets.

## Reference notes

Community references used to cross-check classic design (not authoritative engine specs):
[classic points](https://www.callofdutyzombies.com/topic/145335-everything-you-need-to-know-about-points/),
[box lifecycle](https://callofduty.fandom.com/wiki/Mystery_Box),
[health progression](https://callofduty.neoseeker.com/wiki/Black_Ops_Zombie_Survival_Guide).
Exact weapon balance/regen timings are explicit prototype tuning, not asserted originals.

## Progress

- Audit and baseline complete. User chose solo polish first and perks/Pack-a-Punch later.
- Survival/combat complete: scaling health, delayed recovery, headshots, knife,
  capped repair points, corpse-state cleanup and deterministic coverage.
- Acquisition complete: two carried guns, switching, reserve-only wall refills,
  seeded three-second box roll, buyer-only ten-second claim and expiration.
- Feedback/reliability complete: hit/kill and damage HUD cues, ammo/reload status,
  box label/state, synthesized local sounds with M mute, focus-loss input release.
- Browser smoke checks: box roll/claim, Q switch and BAR headshot visibly worked;
  imported assets loaded, with no console warnings/errors on the checked views.
- `npm run benchmark` on this machine: 24-zombie route, mean 2.71 ms/tick,
  p95 4.69 ms/tick, max 9.80 ms.
- One default full-suite run timed out an existing GLB test under simultaneous
  browser stress. The 8-worker rerun passed all 166 tests. With the browser
  closed, the standard `npm run check` passed: typecheck, 166 tests, production build.
  The build retains the existing large-chunk warning (about 698 kB main bundle).

## Rendering follow-up

The first browser stress run showed roughly 24–33 FPS. A temporary development
render bypass reached 60 FPS; world and weapon rendering without the HUD also
reached 60 FPS. This isolated the regression to `CanvasHud`: it compared a new
feedback object by identity every frame, forcing a full 1600×900 HUD redraw and
texture upload even when no displayed value changed. The final implementation
compares the feedback fields and snapshots their values. The renderer performance
test now covers fresh but equal feedback objects over 144 render frames.

After the fix, the complete 24-zombie stress view held 60 FPS in the in-app
browser, with about 4.5 ms CPU per frame and no console errors. The render
bypass also held 60 FPS, establishing this browser/display path's current cap.
Actual 144 Hz presentation still needs a 144 Hz-capable test surface.
