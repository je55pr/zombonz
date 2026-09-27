import * as THREE from 'three';
import { getAsset } from './assetStore.ts';
import type { GreyboxBox, GreyboxMaterial } from '../maps/nacht.ts';

export const MATERIAL_IDS = ['weathered-concrete-a', 'weathered-concrete-b', 'cracked-concrete-floor',
  'broken-plaster-brick', 'concrete-rubble', 'cave-rock', 'dirt', 'splintered-wood', 'rusted-metal', 'sofa-upholstery'] as const;
export type EnvironmentMaterialId = typeof MATERIAL_IDS[number];
export interface EnvironmentManifest {
  materials: Record<EnvironmentMaterialId, { basecolor: string; normal: string; arm: string }>;
  decals: Record<string, { maps: { basecolor: string; opacity: string } }>;
}
export const ENVIRONMENT_TEXTURE_SIZE = 1024;
const materials = new Map<EnvironmentMaterialId, THREE.MeshStandardMaterial>();
const pendingTextures = new Map<string, Promise<THREE.Texture>>();
const roles: Record<GreyboxMaterial, EnvironmentMaterialId> = {
  wall: 'weathered-concrete-a', floor: 'cracked-concrete-floor', upperFloor: 'cracked-concrete-floor',
  stair: 'weathered-concrete-b', barrier: 'splintered-wood', metal: 'rusted-metal',
};
export function environmentMaterial(id: EnvironmentMaterialId): THREE.MeshStandardMaterial {
  let material = materials.get(id);
  if (!material) {
    material = new THREE.MeshStandardMaterial({ color: id === 'splintered-wood' ? 0x70523b : 0x77746b, roughness: 0.95 });
    material.name = id; materials.set(id, material);
  }
  return material;
}
export function bunkerMaterial(kind: GreyboxMaterial): THREE.MeshStandardMaterial { return environmentMaterial(roles[kind]); }

// Keep structural concrete on piers/beams; plaster belongs on large vertical wall panels.
export function materialForBox(entry: GreyboxBox): EnvironmentMaterialId {
  if (entry.center.x < -8 && entry.material === 'wall') return 'cave-rock';
  if (entry.material === 'floor' && entry.center.x < -8) return 'dirt';
  if (entry.material !== 'wall') return roles[entry.material];
  if (entry.size.y > 2 && Math.max(entry.size.x, entry.size.z) > 2.4) return 'broken-plaster-brick';
  return entry.size.y < 0.5 ? 'weathered-concrete-b' : 'weathered-concrete-a';
}

export function assetUrl(path: string): string { return `${import.meta.env.BASE_URL}${path.replace(/^\//, '')}`; }
export async function readEnvironmentManifest(): Promise<EnvironmentManifest> {
  const downloaded = getAsset(assetUrl('/assets/environment/manifest.json'));
  if (downloaded) return JSON.parse(await downloaded.text()) as EnvironmentManifest;
  const response = await fetch(assetUrl('/assets/environment/manifest.json'));
  if (!response.ok) throw new Error(`Environment manifest: ${response.status}`);
  return response.json();
}
export function loadEnvironmentTexture(path: string, color = false, repeat = true): Promise<THREE.Texture> {
  const key = `${path}:${color}:${repeat}`;
  let pending = pendingTextures.get(key);
  if (!pending) {
    // Decode at 1K before GPU upload. The original 2K files are preserved on disk.
    // ImageBitmap ignores Texture.flipY, so flip during decoding instead.
    const options: ImageBitmapOptions = { imageOrientation: 'flipY', premultiplyAlpha: 'none',
      colorSpaceConversion: 'none', resizeWidth: ENVIRONMENT_TEXTURE_SIZE, resizeHeight: ENVIRONMENT_TEXTURE_SIZE, resizeQuality: 'high' };
    // Decode the start-screen download directly when there is one.
    const downloaded = getAsset(assetUrl(path));
    const decoding = downloaded ? createImageBitmap(downloaded, options)
      : new THREE.ImageBitmapLoader().setOptions(options).loadAsync(assetUrl(path));
    pending = decoding.then(bitmap => {
      const texture = new THREE.Texture(bitmap);
      texture.name = path; texture.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      texture.wrapS = texture.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
      texture.channel = 0; texture.anisotropy = 4; texture.needsUpdate = true;
      return texture;
    });
    pendingTextures.set(key, pending);
  }
  return pending;
}
export function applyPbrMaps(material: THREE.MeshStandardMaterial, color: THREE.Texture, normal: THREE.Texture, arm: THREE.Texture): void {
  material.color.set(0xffffff); material.map = color; material.normalMap = normal;
  material.normalScale.set(0.65, 0.65);
  material.aoMap = material.roughnessMap = material.metalnessMap = arm;
  material.aoMapIntensity = 0.6; material.roughness = 1; material.metalness = 1;
  material.needsUpdate = true;
}
export async function loadEnvironmentMaterials(manifest: EnvironmentManifest): Promise<number> {
  let failures = 0;
  // Three maps at a time avoids decoding the entire pack in one burst.
  for (const id of MATERIAL_IDS) {
    try {
      const item = manifest.materials[id];
      const maps = await Promise.all([loadEnvironmentTexture(item.basecolor, true), loadEnvironmentTexture(item.normal), loadEnvironmentTexture(item.arm)]);
      applyPbrMaps(environmentMaterial(id), ...maps as [THREE.Texture, THREE.Texture, THREE.Texture]);
    } catch (error) { failures++; console.warn(`Environment material unavailable: ${id}`, error); }
  }
  return failures;
}

// Metre-based projection shared by architecture and procedural detail meshes.
export function projectWorldUvs(geometry: THREE.BufferGeometry, offset = new THREE.Vector3()): void {
  const positions = geometry.attributes.position, normals = geometry.attributes.normal, uv = geometry.attributes.uv;
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i) + offset.x, y = positions.getY(i) + offset.y, z = positions.getZ(i) + offset.z;
    uv.setXY(i, (Math.abs(normals.getX(i)) > 0.5 ? z : x) / 2,
      (Math.abs(normals.getY(i)) > 0.5 ? z : y) / 2);
  }
}
