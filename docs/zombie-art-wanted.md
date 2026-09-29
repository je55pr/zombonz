# Zombie art wanted

The zombie systems (a look per zombie, limbs that come off, crawlers, hit volumes measured from the rig) take new models
and animations as data. What is missing is the art. Two models are in play today: Peter_D's
[Zombie Soldier](https://sketchfab.com/3d-models/zombie-soldier-176e930e63d144cc8f615b8dd3a8c74f) and pxltiger's
[Zombie](https://sketchfab.com/3d-models/zombie-73ef58af341e46afba1da53366ed79cf), each with an idle, a walk, a run and an
attack (the soldier also a death). Everything else in the game is done by bending, scrubbing or hiding those.

Anything added has to be **CC0 or CC BY** (credited in `public/assets/ATTRIBUTION.txt` and the F2 panel), skinned to a humanoid
rig, and free to be re-encoded (textures go to WebP, animation clips are separated into their own GLBs; see
`scripts/weapon-convert`). A model should stand about 1.72 m tall in its bind pose with its feet on the floor.

## Models (most wanted first)

1. **Asylum patients and staff**: a nurse or orderly, and gowned patients (two builds), so the Asylum stops sharing soldiers.
2. **Civilians**: a woman in a dress, a man in shirtsleeves, a child at about 1.2 m (the hit volumes assume 1.72 m, so a small
   model needs its own rig in the measure script).
3. **Burnt and bloated variants** of either existing model (only the texture and a shape key need change).
4. **Soldiers of other kinds**: a helmeted one (the head-pop code already treats the head as one part), an officer.

## Animations, for each model, in the model's own rig

1. **Crawl** (and a crawler's attack, idle and death). Today a crawler is the skeleton bent over by code.
2. **Walks**: at least three, one hunched or shambling, one dragging a leg; **runs** and a true **sprint**; two more **idles**.
3. **Attacks**: two or three more swings (a slam, a claw, a lunge), each with the blow's moment marked, so it can land on the
   tick the rules say. The soldier's is 1.05 s into its clip; the walker's two swipes are at 0.2 and 0.65 s
   (`ATTACK_WINDOWS` in `src/core/zombieBody.ts`).
4. **Hit reactions**: a flinch for a head hit and a torso hit, and a stagger from a blast, played over the locomotion.
5. **Deaths**: forward, backward, from a headshot, from a blast; the walker has none at all.
6. **Barrier**: tearing a board from a low, middle and high slot, climbing over a sill, and climbing a wall.

When a clip is added, run `node --experimental-strip-types scripts/measure-zombie-rig.ts` so the hit volumes follow it.
