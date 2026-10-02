import * as THREE from 'three';
import { getAssetAsync } from './assetStore.ts';
import { assetUrl, type EnvironmentManifest } from './environmentMaterials.ts';

/** How bright the night sky is drawn against the scene. */
const SKY_INTENSITY = 0.5;

/**
 * The night sky behind the fog: a moonlit panorama (its lower half already faded to the fog colour),
 * turned so the moon hangs where the moonlight comes from.
 */
export async function applySky(scene: THREE.Scene, manifest: EnvironmentManifest, moonlight: THREE.DirectionalLight,
  intensity = SKY_INTENSITY): Promise<void> {
  const sky = manifest.sky;
  if (!sky) return;
  const options: ImageBitmapOptions = { imageOrientation: 'flipY', premultiplyAlpha: 'none', colorSpaceConversion: 'none' };
  const downloaded = await getAssetAsync(assetUrl(sky.image));
  const bitmap = downloaded ? await createImageBitmap(downloaded, options)
    : await new THREE.ImageBitmapLoader().setOptions(options).loadAsync(assetUrl(sky.image));
  const texture = new THREE.Texture(bitmap);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  scene.background = texture;
  scene.backgroundIntensity = intensity;
  // A panorama direction at longitude θ reads u = θ / 2π + 0.5; turning the background by α about
  // the vertical shifts what shows at θ to θ - α. Solve for the moon's u to show toward the light.
  const toLight = moonlight.position.clone().sub(moonlight.target.position);
  const lightLongitude = Math.atan2(toLight.z, toLight.x), moonLongitude = (sky.moon.u - 0.5) * Math.PI * 2;
  scene.backgroundRotation.set(0, lightLongitude - moonLongitude, 0);
}
