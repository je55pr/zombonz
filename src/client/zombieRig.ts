import * as THREE from 'three';
import { LIMB, type LimbId } from '../core/zombieBody.ts';
import type { ZombieAssetId } from './runtimeAssets.ts';

/**
 * How each zombie model is put together, for what the view does to a body: taking limbs off, closing the stumps, and bending a
 * crawler over. (Where the parts are for a shot is the core's business: see core/zombieBody.ts.)
 */
export interface LimbSpec {
  /** For a model that is one skinned mesh: the bones whose vertices are this limb. A limb is cut at the elbow, the knee, the neck. */
  owns?: (bone: string) => boolean;
  /** For a model built one mesh per part: the meshes that are this limb. */
  meshes?: readonly string[];
  /** The bone a stump is closed off on, and how wide the limb is there, in metres. */
  capBone: string;
  capRadius: number;
}

export interface RigSpec {
  hips: string;
  spine: readonly string[];
  neck: string;
  head: string;
  /** Upper arm, forearm, hand; thigh, calf, foot. */
  arms: { L: readonly [string, string, string]; R: readonly [string, string, string] };
  legs: { L: readonly [string, string, string]; R: readonly [string, string, string] };
  limbs: Record<LimbId, LimbSpec>;
}

const starts = (...prefixes: string[]) => (bone: string) => prefixes.some(prefix => bone.startsWith(prefix));

export const RIGS: Readonly<Record<ZombieAssetId, RigSpec>> = {
  // A Mixamo-style skeleton, drawn as one skinned mesh.
  peter_d: {
    hips: 'Hips', spine: ['Spine', 'Spine1', 'Spine2', 'Spine3'], neck: 'Neck', head: 'Head',
    arms: { L: ['LeftArm', 'LeftForeArm', 'LeftHand'], R: ['RightArm', 'RightForeArm', 'RightHand'] },
    legs: { L: ['LeftUpLeg', 'LeftLeg', 'LeftFoot'], R: ['RightUpLeg', 'RightLeg', 'RightFoot'] },
    limbs: {
      head: { owns: bone => bone === 'Head', capBone: 'Head', capRadius: 0.055 },
      armL: { owns: starts('LeftForeArm', 'LeftHand'), capBone: 'LeftForeArm', capRadius: 0.045 },
      armR: { owns: starts('RightForeArm', 'RightHand'), capBone: 'RightForeArm', capRadius: 0.045 },
      legL: { owns: bone => bone === 'LeftLeg' || bone.startsWith('LeftFoot') || bone.startsWith('LeftToe'), capBone: 'LeftLeg', capRadius: 0.07 },
      legR: { owns: bone => bone === 'RightLeg' || bone.startsWith('RightFoot') || bone.startsWith('RightToe'), capBone: 'RightLeg', capRadius: 0.07 },
    },
  },
  // Its own skeleton, drawn as a mesh for each part.
  pxltiger: {
    hips: 'Base_HumanPelvis', spine: ['Base_HumanSpine1', 'Base_HumanSpine2', 'Base_HumanRibcage'], neck: 'Base_HumanNeck', head: 'Base_HumanHead',
    arms: { L: ['Base_HumanLArmUpperarm', 'Base_HumanLArmForearm', 'Base_HumanLArmPalm'], R: ['Base_HumanRArmUpperarm', 'Base_HumanRArmForearm', 'Base_HumanRArmPalm'] },
    legs: { L: ['Base_HumanLLegThigh', 'Base_HumanLLegCalf', 'Base_HumanLLegFoot'], R: ['Base_HumanRThigh', 'Base_HumanRCalf', 'Base_HumanRFoot'] },
    limbs: {
      head: { meshes: ['Z_Head'], capBone: 'Base_HumanHead', capRadius: 0.055 },
      armL: { meshes: ['Z_L_Forearm', 'Z_L_ArmPalm'], capBone: 'Base_HumanLArmForearm', capRadius: 0.045 },
      armR: { meshes: ['Z_R_Forearm', 'Z_R_ArmPalm'], capBone: 'Base_HumanRArmForearm', capRadius: 0.045 },
      legL: { meshes: ['Z_L_LegCalf'], capBone: 'Base_HumanLLegCalf', capRadius: 0.07 },
      legR: { meshes: ['Z_R_LegCalf'], capBone: 'Base_HumanRCalf', capRadius: 0.07 },
    },
  },
};

export const LIMB_IDS = Object.keys(LIMB) as LimbId[];

/** What is known about one model's geometry: which vertices and triangles are each limb. Worked out once per model. */
export interface LimbData {
  /** For a one-mesh model: the triangles (as offsets into the geometry's own index) whose three vertices are all in each limb. */
  triangles: Map<LimbId, Uint32Array>;
}

const limbData = new WeakMap<THREE.BufferGeometry, LimbData>();

/**
 * Gives a one-mesh model's geometry a per-vertex `aLimb` attribute (the bit of the limb the vertex belongs to, or 0), and lists
 * each limb's triangles. The vertex's limb is the one that owns the bone it follows most.
 */
export function prepareLimbs(mesh: THREE.SkinnedMesh, spec: RigSpec): LimbData {
  const geometry = mesh.geometry;
  const existing = limbData.get(geometry);
  if (existing) return existing;
  const count = geometry.attributes.position.count, skinIndex = geometry.attributes.skinIndex, skinWeight = geometry.attributes.skinWeight;
  const bits = new Float32Array(count);
  const owner = new Map<number, LimbId | null>();
  const bones = mesh.skeleton.bones;
  for (let i = 0; i < count; i++) {
    let best = 0, bestWeight = -1;
    for (let k = 0; k < 4; k++) if (skinWeight.getComponent(i, k) > bestWeight) { bestWeight = skinWeight.getComponent(i, k); best = skinIndex.getComponent(i, k); }
    if (!owner.has(best)) owner.set(best, LIMB_IDS.find(limb => spec.limbs[limb].owns?.(bones[best].name)) ?? null);
    const limb = owner.get(best);
    bits[i] = limb ? LIMB[limb] : 0;
  }
  geometry.setAttribute('aLimb', new THREE.BufferAttribute(bits, 1));
  const index = geometry.index!, triangles = new Map<LimbId, number[]>(LIMB_IDS.map(limb => [limb, []]));
  for (let t = 0; t < index.count; t += 3) {
    const a = bits[index.getX(t)], b = bits[index.getX(t + 1)], c = bits[index.getX(t + 2)];
    for (const limb of LIMB_IDS) {
      const bit = LIMB[limb];
      if (a === bit && b === bit && c === bit) triangles.get(limb)!.push(t);
    }
  }
  const data: LimbData = { triangles: new Map([...triangles].map(([limb, list]) => [limb, Uint32Array.from(list)])) };
  limbData.set(geometry, data);
  return data;
}

/**
 * Makes a material hide the limbs named by `uniform.value` (a bitmask, see LIMB) on a mesh prepared by `prepareLimbs`. Every
 * zombie's material shares one program and differs only in its uniform.
 */
export function installLimbMask(material: THREE.Material, uniform: { value: number }): void {
  material.onBeforeCompile = shader => {
    shader.uniforms.uLimbMask = uniform;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aLimb;\nflat varying float vLimb;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLimb = aLimb;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uLimbMask;\nflat varying float vLimb;')
      .replace('void main() {', 'void main() {\n  if (vLimb > 0.5 && mod(floor(uLimbMask / vLimb), 2.0) > 0.5) discard;');
  };
  material.customProgramCacheKey = () => 'zombie-limb-mask';
  material.needsUpdate = true;
}

const worldQuaternion = new THREE.Quaternion(), parentQuaternion = new THREE.Quaternion(), delta = new THREE.Quaternion();
const from = new THREE.Vector3(), to = new THREE.Vector3();

/** Turns a bone by `rotation`, given in world space, whatever its own axes are; its children go with it. */
export function rotateBoneWorld(bone: THREE.Object3D, rotation: THREE.Quaternion): void {
  bone.updateWorldMatrix(true, false);
  bone.getWorldQuaternion(worldQuaternion);
  bone.parent?.getWorldQuaternion(parentQuaternion);
  bone.quaternion.copy(parentQuaternion.invert()).multiply(worldQuaternion.premultiply(rotation)).normalize();
  bone.updateMatrixWorld(true);
}

/** Turns `bone` (about its own joint) so that the line to `child` points along `direction` (a world-space unit vector). */
export function aimBone(bone: THREE.Object3D, child: THREE.Object3D, direction: THREE.Vector3, weight = 1): void {
  bone.updateWorldMatrix(true, true);
  bone.getWorldPosition(from); child.getWorldPosition(to);
  to.sub(from).normalize();
  delta.setFromUnitVectors(to, direction);
  if (weight < 1) delta.slerp(new THREE.Quaternion(), 1 - weight);
  rotateBoneWorld(bone, delta);
}

