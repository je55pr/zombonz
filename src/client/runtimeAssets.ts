import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { deinterleaveGeometry, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

export type ZombieAssetId = 'peter_d' | 'pxltiger';
export type ZombieAnimation = 'idle' | 'walk' | 'run' | 'attack' | 'death';
export interface ZombieAsset { model: THREE.Group; clips: Partial<Record<ZombieAnimation, THREE.AnimationClip>> }
export const WEAPON_ASSETS: Readonly<Record<string, string>> = {
  'starter-pistol': 'm1911', kar98k: 'kar98k', bar: 'bar',
};

const loader = new GLTFLoader();
const models = new Map<string, Promise<GLTF>>();
const normalization = new WeakMap<THREE.Object3D, { scale: number; offset: THREE.Vector3 }>();
export function loadModel(path: string): Promise<GLTF> {
  let pending = models.get(path);
  if (!pending) { pending = loader.loadAsync(`${import.meta.env.BASE_URL}assets/${path}`); models.set(path, pending); }
  return pending;
}

// Source rigs use Z-up hips under a coordinate-conversion parent. Keep horizontal
// root motion at the bind pose; the simulation alone moves zombies through walls/doors.
export function inPlaceClip(source: THREE.AnimationClip, model: THREE.Object3D): THREE.AnimationClip {
  model.updateMatrixWorld(true);
  const clip = source.clone();
  clip.tracks = clip.tracks.filter(track => {
    const parsed = THREE.PropertyBinding.parseTrackName(track.name);
    const node = model.getObjectByName(parsed.nodeName);
    if (!node) return false;
    // pxltiger's animation export bakes its FBX helper chain into pelvis keys,
    // while the model retains that chain. Convert back to the bone's local space
    // instead of applying the helper transform twice (which tips the rig sideways).
    if (parsed.nodeName === 'Base_HumanPelvis' && node.parent) {
      const parent = node.parent.matrixWorld;
      if (parsed.propertyName === 'position') {
        const inverse = parent.clone().invert(), point = new THREE.Vector3();
        const bindOrigin = new THREE.Vector3().setFromMatrixPosition(parent);
        for (let i = 0; i < track.values.length; i += 3) {
          point.set(bindOrigin.x, track.values[i + 1], bindOrigin.z).applyMatrix4(inverse);
          point.toArray(track.values, i);
        }
      } else if (parsed.propertyName === 'quaternion') {
        const inverse = node.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
        const rotation = new THREE.Quaternion();
        for (let i = 0; i < track.values.length; i += 4) {
          rotation.fromArray(track.values, i).premultiply(inverse).normalize().toArray(track.values, i);
        }
      }
    }
    if (parsed.nodeName === 'Hips' && parsed.propertyName === 'position') {
      for (let i = 0; i < track.values.length; i += 3) {
        track.values[i] = node.position.x; track.values[i + 1] = node.position.y;
      }
    }
    // Exporters key every bone's scale and translation even when unchanged. Drop
    // bind-pose constants rather than evaluating thousands of redundant tracks.
    const property = parsed.propertyName;
    if (property === 'scale' || property === 'position') {
      const value = node[property];
      if (Array.from(track.values).every((sample, index) => Math.abs(sample - value.getComponent(index % 3)) < 1e-4)) return false;
    }
    return true;
  });
  clip.optimize();
  return clip;
}

export async function loadZombieAsset(id: ZombieAssetId): Promise<ZombieAsset> {
  const names: ZombieAnimation[] = ['idle', 'walk', 'run', 'attack', ...(id === 'peter_d' ? ['death' as const] : [])];
  const [model, ...animations] = await Promise.all([
    loadModel(`zombies/${id}/model.glb`), ...names.map(name => loadModel(`zombies/${id}/${name}.glb`)),
  ]);
  const clips: ZombieAsset['clips'] = {};
  names.forEach((name, index) => {
    if (animations[index].animations[0]) clips[name] = inPlaceClip(animations[index].animations[0], model.scene);
  });
  prepareZombieModel(model.scene);
  return { model: model.scene, clips };
}

function prepareZombieModel(model: THREE.Object3D): { scale: number; offset: THREE.Vector3 } {
  let transform = normalization.get(model);
  if (!transform) {
    model.traverse(object => {
      if (object instanceof THREE.Mesh) {
        // FBX exports repeat each corner: weld identical full vertex records,
        // including weights/UV seams, so the GPU skins each unique vertex once.
        const original = object.geometry;
        deinterleaveGeometry(original);
        object.geometry = mergeVertices(original);
        original.dispose();
      }
    });
    model.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(model);
    const center = bounds.getCenter(new THREE.Vector3());
    if (!Number.isFinite(bounds.max.y - bounds.min.y) || bounds.max.y <= bounds.min.y) throw new Error('Zombie model has no usable geometry');
    transform = { scale: 1.72 / (bounds.max.y - bounds.min.y), offset: new THREE.Vector3(-center.x, -bounds.min.y, -center.z) };
    normalization.set(model, transform);
  }
  return transform;
}

export function cloneZombieModel(asset: ZombieAsset): { body: THREE.Group; model: THREE.Object3D } {
  const transform = prepareZombieModel(asset.model);
  const model = clone(asset.model);
  const body = new THREE.Group(); body.add(model);
  body.scale.setScalar(transform.scale);
  model.position.add(transform.offset);
  model.traverse(object => {
    if (object instanceof THREE.Mesh) {
      object.castShadow = true; object.receiveShadow = true;
      if (object instanceof THREE.SkinnedMesh) {
        // Conservative fixed animated bounds: cull off-camera actors without a
        // CPU skinning pass over every vertex to recompute bounds every frame.
        if (!object.geometry.boundingSphere) object.geometry.computeBoundingSphere();
        object.boundingSphere = object.geometry.boundingSphere!.clone();
        object.boundingSphere.radius *= 2;
        object.frustumCulled = true;
      }
    }
  });
  return { body, model };
}
