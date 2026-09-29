import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { deinterleaveGeometry, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { takeAsset } from './assetStore.ts';

export type ZombieAssetId = 'peter_d' | 'pxltiger';
/** The model each zombie look is drawn with: index = `ZombieState.variant` (see core/zombieBody.ts, whose rigs these are). */
export const ZOMBIE_ASSET_IDS: readonly ZombieAssetId[] = ['peter_d', 'pxltiger'];
export const zombieAssetFor = (variant: number): ZombieAssetId => ZOMBIE_ASSET_IDS[variant % ZOMBIE_ASSET_IDS.length];
export type ZombieAnimation = 'idle' | 'walk' | 'run' | 'attack' | 'death';
export interface ZombieAsset { id?: ZombieAssetId; model: THREE.Group; clips: Partial<Record<ZombieAnimation, THREE.AnimationClip>> }
// Every gun's GLB lives in public/assets/weapons/<id>/, except the starter pistol's M1911 folder.
export const WEAPON_ASSETS: Readonly<Record<string, string>> = {
  'starter-pistol': 'm1911',
  ...Object.fromEntries(['kar98k', 'springfield', 'mosin', 'm1-garand', 'm1-carbine', 'm14', 'fal', 'stg44', 'fg42',
    'thompson', 'mp40', 'ppsh41', 'commando', 'ak74u', 'mp5k', 'skorpion', 'bar', 'mg42', 'rpk', 'double-barrel',
    'trench-gun', 'spas12', 'ithaca37', 'magnum-357', 'python', 'rpg7', 'irrlicht', 'molniya'].map(id => [id, id])),
};

const loader = new GLTFLoader();
const models = new Map<string, Promise<GLTF>>();
const normalization = new WeakMap<THREE.Object3D, { scale: number; offset: THREE.Vector3 }>();
export function loadModel(path: string): Promise<GLTF> {
  let pending = models.get(path);
  if (!pending) {
    const url = `${import.meta.env.BASE_URL}assets/${path}`;
    // Parse the start-screen download when there is one; the GLBs are self-contained.
    const downloaded = takeAsset(url);
    pending = downloaded ? downloaded.arrayBuffer().then(buffer => loader.parseAsync(buffer, url.slice(0, url.lastIndexOf('/') + 1)))
      : loader.loadAsync(url);
    models.set(path, pending);
  }
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
    // Peter_D's run export rekeys its coordinate-conversion Root to 0.001 scale
    // and a 90-degree rotation. The model already has the conversion in its bind
    // pose, so those keys shrink/tip the visible mesh while its hitbox stays put.
    if (parsed.nodeName === 'Root' && (parsed.propertyName === 'scale' || parsed.propertyName === 'quaternion')) return false;
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

function zombieClipNames(id: ZombieAssetId): ZombieAnimation[] {
  return ['idle', 'walk', 'run', 'attack', ...(id === 'peter_d' ? ['death' as const] : [])];
}

/** The rig and each clip, relative to assets/; shared with the start-screen preloader. */
export function zombieAssetPaths(id: ZombieAssetId): string[] {
  return [`zombies/${id}/model.glb`, ...zombieClipNames(id).map(name => `zombies/${id}/${name}.glb`)];
}

const zombieAssets = new Map<ZombieAssetId, Promise<ZombieAsset>>();

/** Parsed once per page, so the start screen can unpack it before the game asks for it. */
export function loadZombieAsset(id: ZombieAssetId): Promise<ZombieAsset> {
  let pending = zombieAssets.get(id);
  if (!pending) {
    pending = buildZombieAsset(id);
    zombieAssets.set(id, pending);
    pending.catch(() => zombieAssets.delete(id));
  }
  return pending;
}

async function buildZombieAsset(id: ZombieAssetId): Promise<ZombieAsset> {
  const names = zombieClipNames(id);
  const [model, ...animations] = await Promise.all(zombieAssetPaths(id).map(path => loadModel(path)));
  const clips: ZombieAsset['clips'] = {};
  names.forEach((name, index) => {
    if (animations[index].animations[0]) clips[name] = inPlaceClip(animations[index].animations[0], model.scene);
  });
  prepareZombieModel(model.scene);
  return { id, model: model.scene, clips };
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
      // Zombies take the building's moon shadows but cast none: the shadow map is only redrawn when the
      // building changes (see game.ts).
      object.castShadow = false; object.receiveShadow = true;
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
