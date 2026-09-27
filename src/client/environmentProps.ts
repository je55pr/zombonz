import * as THREE from 'three';
import { BUNKER_PROPS, type PropPlacement } from '../maps/bunkerProps.ts';
import { loadModel } from './runtimeAssets.ts';
import { batchStaticMeshes } from './staticBatch.ts';
import { loadEnvironmentTexture, type EnvironmentManifest } from './environmentMaterials.ts';
import { px, pz } from '../maps/bunkerPlan.ts';

export function prepareProp(source: THREE.Object3D, placement: PropPlacement): THREE.Group {
  // Never mutate the cached GLB. Clones share geometry/materials, but not transforms.
  const model = source.clone(true);
  if (placement.asset === 'crowbar') model.rotation.x += Math.PI / 2;
  model.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(model), size = bounds.getSize(new THREE.Vector3());
  const scale = Math.min(placement.size.x / size.x, placement.size.y / size.y, placement.size.z / size.z);
  if (!Number.isFinite(scale) || scale <= 0) throw new Error(`Invalid prop bounds: ${placement.asset}`);
  const centred = new THREE.Group(); centred.add(model);
  centred.position.set(-(bounds.min.x + bounds.max.x) / 2, -bounds.min.y, -(bounds.min.z + bounds.max.z) / 2);
  const scaled = new THREE.Group(); scaled.scale.setScalar(scale); scaled.add(centred);
  const root = new THREE.Group(); root.name = placement.id; root.add(scaled);
  root.position.set(placement.position.x, placement.position.y, placement.position.z); root.rotation.y = placement.yaw;
  root.traverse(object => {
    if (object instanceof THREE.Mesh) {
      // Small clutter and distant vehicles do not need extra moon-shadow draws.
      object.castShadow = !placement.background && placement.solid && placement.size.y > 0.6;
      object.receiveShadow = true;
    }
  });
  return root;
}

export async function buildEnvironmentProps(scene: THREE.Scene): Promise<number> {
  const group = new THREE.Group(); group.name = 'imported-environment-props'; scene.add(group);
  const placeholders = new Map<string, THREE.Mesh>();
  const fallbackMaterial = new THREE.MeshStandardMaterial({ color: 0x69543c, roughness: 1 });
  for (const p of BUNKER_PROPS.filter(p => p.solid)) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(p.size.x, p.size.y, p.size.z), fallbackMaterial);
    mesh.name = `loading-${p.id}`;
    mesh.position.set(p.position.x, p.position.y + p.size.y / 2, p.position.z); mesh.rotation.y = p.yaw;
    placeholders.set(p.id, mesh); group.add(mesh);
  }
  let failures = 0;
  // Load each unique asset once and batch repeated props in spatial cells.
  for (const asset of new Set(BUNKER_PROPS.map(p => p.asset))) {
    try {
      const gltf = await loadModel(`props/${asset}/model.glb`);
      for (const p of BUNKER_PROPS.filter(p => p.asset === asset)) {
        group.add(prepareProp(gltf.scene, p));
        const placeholder = placeholders.get(p.id);
        if (placeholder) { placeholder.removeFromParent(); placeholder.geometry.dispose(); placeholders.delete(p.id); }
      }
    } catch (error) {
      failures++; console.warn(`Environment prop unavailable: ${asset}`, error);
      // Keep the visible loading proxy: no invisible solid obstacles on failure.
    }
  }
  batchStaticMeshes(group);
  if (placeholders.size === 0) fallbackMaterial.dispose();
  return failures;
}

export const DECALS = [
  { asset: 'leaking-grime', x: px(15.6), y: 1.8, z: pz(-2.389), width: 2.6, height: 2.5, yaw: 0 },
  { asset: 'leaking-grime', x: px(-5.989), y: 5.1, z: pz(-6.5), width: 2.5, height: 2.7, yaw: Math.PI / 2 },
  { asset: 'smear-grime', x: px(0.211), y: 1.5, z: pz(5), width: 2.8, height: 2.3, yaw: Math.PI / 2 },
  { asset: 'smear-grime', x: px(-0.211), y: 1.5, z: pz(-8.1), width: 2.5, height: 2.3, yaw: -Math.PI / 2 },
  { asset: 'leaking-grime', x: px(6.8), y: 5.15, z: pz(5.189), width: 3.1, height: 2.5, yaw: Math.PI },
];
/** The colour and opacity maps for one decal set (shared with the start-screen warm-up). */
export function loadDecalTextures(manifest: EnvironmentManifest, id: string): Promise<[THREE.Texture, THREE.Texture]> {
  const maps = manifest.decals[id].maps;
  return Promise.all([loadEnvironmentTexture(maps.basecolor, true, false), loadEnvironmentTexture(maps.opacity, false, false)]);
}

export async function buildEnvironmentDecals(scene: THREE.Scene, manifest: EnvironmentManifest): Promise<number> {
  let failures = 0;
  for (const id of new Set(DECALS.map(d => d.asset))) {
    try {
      const [color, alpha] = await loadDecalTextures(manifest, id);
      const material = new THREE.MeshStandardMaterial({ map: color, alphaMap: alpha, transparent: true,
        depthWrite: false, roughness: 1, opacity: 0.65, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      for (const d of DECALS.filter(d => d.asset === id)) {
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(d.width, d.height), material);
        mesh.name = `decal-${id}`; mesh.position.set(d.x, d.y, d.z); mesh.rotation.y = d.yaw;
        mesh.receiveShadow = true; mesh.renderOrder = 1; scene.add(mesh);
      }
    } catch (error) { failures++; console.warn(`Environment decal unavailable: ${id}`, error); }
  }
  return failures;
}
