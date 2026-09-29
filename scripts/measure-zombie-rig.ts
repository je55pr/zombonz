/**
 * Measures the zombie rigs and writes src/core/zombieRigData.ts, which the core builds hit volumes from.
 *
 * The simulation cannot run an animation, so it uses where the animated body actually is: for each rig this loads the
 * model and its clips exactly as the game does (same in-place clips, same 1.72 m normalisation), samples the key joints
 * through each cycle, and records their positions in the zombie's own frame (feet at the origin, +z the way it faces).
 * The head is measured as the centre of the skull's vertices, carried by the head bone, not as the bone itself.
 *
 *   node --experimental-strip-types scripts/measure-zombie-rig.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { inPlaceClip } from '../src/client/runtimeAssets.ts';

// GLTFLoader wants a browser: give it just enough to skip decoding the (irrelevant) textures.
Object.assign(globalThis, { createImageBitmap: async () => ({ width: 1, height: 1, close() {} }), self: globalThis });

const HEIGHT = 1.72;
const KEYS = ['head', 'neck', 'chest', 'hips', 'shoulderL', 'shoulderR', 'elbowL', 'elbowR', 'handL', 'handR',
  'kneeL', 'kneeR', 'footL', 'footR'] as const;
type Key = typeof KEYS[number];

interface RigSource {
  asset: string;
  clips: string[];
  bones: Record<Key, string>;
  /** Which bone owns the skull's vertices, and the names of the meshes for rigs that come as one mesh per part. */
  headBone: string;
  headMesh?: string;
}

const RIGS: Record<string, RigSource> = {
  soldier: { asset: 'peter_d', clips: ['idle', 'walk', 'run', 'attack'], headBone: 'Head',
    bones: { head: 'Head', neck: 'Neck', chest: 'Spine3', hips: 'Hips', shoulderL: 'LeftArm', shoulderR: 'RightArm',
      elbowL: 'LeftForeArm', elbowR: 'RightForeArm', handL: 'LeftHand', handR: 'RightHand',
      kneeL: 'LeftLeg', kneeR: 'RightLeg', footL: 'LeftFoot', footR: 'RightFoot' } },
  walker: { asset: 'pxltiger', clips: ['idle', 'walk', 'run', 'attack'], headBone: 'Base_HumanHead', headMesh: 'Z_Head',
    bones: { head: 'Base_HumanHead', neck: 'Base_HumanNeck', chest: 'Base_HumanRibcage', hips: 'Base_HumanPelvis',
      shoulderL: 'Base_HumanLArmUpperarm', shoulderR: 'Base_HumanRArmUpperarm', elbowL: 'Base_HumanLArmForearm',
      elbowR: 'Base_HumanRArmForearm', handL: 'Base_HumanLArmPalm', handR: 'Base_HumanRArmPalm',
      kneeL: 'Base_HumanLLegCalf', kneeR: 'Base_HumanRCalf', footL: 'Base_HumanLLegFoot', footR: 'Base_HumanRFoot' } },
};

const round = (n: number) => Math.round(n * 1000) / 1000;

async function load(path: string) {
  const buffer = readFileSync(`public/assets/${path}`);
  return new GLTFLoader().parseAsync(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer, '');
}

async function measure(name: string, source: RigSource) {
  const model = await load(`zombies/${source.asset}/model.glb`);
  const clips: Record<string, THREE.AnimationClip> = {};
  for (const clip of source.clips) clips[clip] = inPlaceClip((await load(`zombies/${source.asset}/${clip}.glb`)).animations[0], model.scene);
  // Same normalisation as cloneZombieModel: 1.72 m tall, feet on the floor, centred on the origin.
  model.scene.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(model.scene);
  const scale = HEIGHT / (bounds.max.y - bounds.min.y), centre = bounds.getCenter(new THREE.Vector3());
  const instance = clone(model.scene);
  const body = new THREE.Group(); body.add(instance);
  body.scale.setScalar(scale); instance.position.add(new THREE.Vector3(-centre.x, -bounds.min.y, -centre.z));
  const root = new THREE.Group(); root.add(body); root.updateMatrixWorld(true);

  const node = (bone: string) => {
    const found = instance.getObjectByName(bone);
    if (!found) throw new Error(`${name}: no bone ${bone}`);
    return found;
  };

  // The skull: the vertices the head bone owns most, in the head bone's own frame so they follow it about.
  const headBone = node(source.headBone), skull = new THREE.Box3(), point = new THREE.Vector3();
  instance.traverse(object => {
    const mesh = object as THREE.SkinnedMesh;
    if (!mesh.isSkinnedMesh || (source.headMesh && mesh.name !== source.headMesh)) return;
    const index = mesh.geometry.attributes.skinIndex, weight = mesh.geometry.attributes.skinWeight;
    for (let i = 0; i < mesh.geometry.attributes.position.count; i++) {
      let best = 0, bestWeight = -1;
      for (let k = 0; k < 4; k++) if (weight.getComponent(i, k) > bestWeight) { bestWeight = weight.getComponent(i, k); best = index.getComponent(i, k); }
      if (mesh.skeleton.bones[best].name !== source.headBone) continue;
      mesh.getVertexPosition(i, point); point.applyMatrix4(mesh.matrixWorld);
      skull.expandByPoint(headBone.worldToLocal(point.clone()));
    }
  });
  const skullLocal = skull.getCenter(new THREE.Vector3());
  const skullSize = skull.getSize(new THREE.Vector3());
  // worldToLocal above went through the body's scale, so these are in the head bone's units; convert to metres.
  const boneScale = headBone.getWorldScale(new THREE.Vector3()).x;

  const sample = (): number[] => {
    root.updateMatrixWorld(true);
    return KEYS.flatMap(key => {
      const p = key === 'head' ? headBone.localToWorld(skullLocal.clone()) : node(source.bones[key]).getWorldPosition(new THREE.Vector3());
      return [round(p.x), round(p.y), round(p.z)];
    });
  };
  const cycle = (clip: THREE.AnimationClip, steps: number) => {
    const mixer = new THREE.AnimationMixer(instance), action = mixer.clipAction(clip); action.play();
    const samples: number[][] = [];
    for (let s = 0; s < steps; s++) { mixer.setTime(clip.duration * s / steps); samples.push(sample()); }
    mixer.stopAllAction();
    return samples;
  };
  const mean = (samples: number[][]) => samples[0].map((_, i) => round(samples.reduce((sum, s) => sum + s[i], 0) / samples.length));
  /** Half the vertical travel of the head over the cycle: how far the head bobs. */
  const bob = (samples: number[][]) => {
    const ys = samples.map(s => s[1]);
    return round((Math.max(...ys) - Math.min(...ys)) / 2);
  };

  const idle = cycle(clips.idle, 24), walk = cycle(clips.walk, 32), run = cycle(clips.run, 32);
  const attackSteps = Math.round(clips.attack.duration / 0.05);
  const attack = cycle(clips.attack, attackSteps);
  // One extra sample at the very end, so an interpolated lookup can run the whole clip.
  attack.push(attack[0]);
  return {
    asset: source.asset,
    stand: { points: mean(idle), bob: bob(idle) },
    walk: { points: mean(walk), bob: bob(walk) },
    run: { points: mean(run), bob: bob(run) },
    attack: { duration: round(clips.attack.duration), samples: attack, mean: mean(attack) },
    skull: { size: skullSize.toArray().map(v => round(v * boneScale)) },
  };
}

const header = `// GENERATED by scripts/measure-zombie-rig.ts from public/assets/zombies. Do not edit by hand.
//
// Where each rig's joints are, in metres, in the zombie's own frame (feet at the origin, +z the way it faces, +x its left),
// averaged over a stand, walk and run cycle (with how far the head bobs in each) and sampled through the attack clip. The head is the
// centre of the skull, carried by the head bone. Order of a pose's numbers: x, y, z for each of
// head, neck, chest, hips, shoulderL, shoulderR, elbowL, elbowR, handL, handR, kneeL, kneeR, footL, footR.
`;

const result: Record<string, unknown> = {};
for (const [name, source] of Object.entries(RIGS)) result[name] = await measure(name, source);
const body = `export const RIG_POINT_KEYS = ${JSON.stringify(KEYS)} as const;\n\nexport const RIG_DATA = ${
  JSON.stringify(result, null, 1).replace(/\n\s+(?=[-\d\]])/g, ' ').replace(/\[\s+/g, '[').replace(/\s+\]/g, ']')} as const;\n`;
writeFileSync('src/core/zombieRigData.ts', header + '\n' + body);
console.log('wrote src/core/zombieRigData.ts');
for (const [name, rig] of Object.entries(result) as Array<[string, any]>) {
  console.log(name, 'stand head', rig.stand.points.slice(0, 3), 'bob', rig.stand.bob, '| walk head', rig.walk.points.slice(0, 3), 'bob', rig.walk.bob,
    '| run head', rig.run.points.slice(0, 3), 'bob', rig.run.bob, '| skull size', rig.skull.size, '| attack samples', rig.attack.samples.length);
}
