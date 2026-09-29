import * as THREE from 'three';

/** How far the fitted shadow camera reaches past the outermost geometry, in metres. */
const MARGIN = 1;
/** The nearest the shadow camera's near plane may come to the light, once the light is pulled back. */
const MIN_NEAR = 1;

/** Puts the moon up and to the north-west of a map's focus, pointing at it. */
export function placeMoon(light: THREE.DirectionalLight, focus: { x: number; z: number }): void {
  light.position.set(focus.x - 12, 22, focus.z - 16);
  light.target.position.set(focus.x, 0, focus.z);
}

export interface ShadowFit {
  /** Size of the fitted view across and up, in metres (the shadow map's texels are this over its resolution). */
  width: number; height: number;
  /** How far the light was pulled back along its direction to clear the geometry nearest it. */
  pulledBack: number;
}

/**
 * Fits a directional light's shadow camera around everything under `root` that casts or receives a shadow.
 *
 * Anything outside the shadow camera's box is treated as lit, so a box that is too small (or that starts
 * behind a corner of the building) lets moonlight through the roofs and walls there. This measures the
 * building in the light's own view space instead, and sizes the box, its near and far planes to it. The
 * light is slid back along its direction if geometry lies behind it, which changes no shading (a
 * directional light only has a direction) but keeps that geometry inside the shadow map.
 *
 * Returns null, leaving the camera alone, if nothing under `root` takes part in shadows.
 */
export function fitShadowCamera(light: THREE.DirectionalLight, root: THREE.Object3D): ShadowFit | null {
  root.updateMatrixWorld(true);
  light.updateMatrixWorld(true); light.target.updateMatrixWorld(true);
  const eye = light.position;
  const forward = light.target.position.clone().sub(eye).normalize();
  let right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0));
  // Looking straight up or down leaves "right" undefined: pick any perpendicular.
  if (right.lengthSq() < 1e-8) right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 0, 1));
  right.normalize();
  const up = new THREE.Vector3().crossVectors(right, forward);

  const bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minD: Infinity, maxD: -Infinity };
  const corner = new THREE.Vector3(), box = new THREE.Box3();
  let found = false;
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh) || !(object.castShadow || object.receiveShadow)) return;
    if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
    box.copy(object.geometry.boundingBox!);
    for (let i = 0; i < 8; i++) {
      corner.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z)
        .applyMatrix4(object.matrixWorld).sub(eye);
      const x = corner.dot(right), y = corner.dot(up), d = corner.dot(forward);
      bounds.minX = Math.min(bounds.minX, x); bounds.maxX = Math.max(bounds.maxX, x);
      bounds.minY = Math.min(bounds.minY, y); bounds.maxY = Math.max(bounds.maxY, y);
      bounds.minD = Math.min(bounds.minD, d); bounds.maxD = Math.max(bounds.maxD, d);
    }
    found = true;
  });
  if (!found) return null;

  // Geometry behind the light, or nearer than the near plane, would never reach the shadow map.
  const pulledBack = Math.max(0, MIN_NEAR + MARGIN - bounds.minD);
  if (pulledBack > 0) light.position.addScaledVector(forward, -pulledBack);
  const camera = light.shadow.camera;
  camera.left = bounds.minX - MARGIN; camera.right = bounds.maxX + MARGIN;
  camera.bottom = bounds.minY - MARGIN; camera.top = bounds.maxY + MARGIN;
  camera.near = bounds.minD + pulledBack - MARGIN; camera.far = bounds.maxD + pulledBack + MARGIN;
  camera.updateProjectionMatrix();
  light.updateMatrixWorld(true);
  return { width: camera.right - camera.left, height: camera.top - camera.bottom, pulledBack };
}
