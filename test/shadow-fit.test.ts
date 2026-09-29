import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { fitShadowCamera, placeMoon } from '../src/client/shadowFit.ts';
import { buildGreybox } from '../src/client/greybox.ts';
import { ASYLUM_MAP } from '../src/maps/asylum.ts';
import { BUNKER_MAP } from '../src/maps/bunkerLegacy.ts';

function moon(focus = { x: 0, z: 0 }): THREE.DirectionalLight {
  const light = new THREE.DirectionalLight(0xffffff, 1);
  placeMoon(light, focus);
  return light;
}
function block(x: number, y: number, z: number, sx: number, sy: number, sz: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), new THREE.MeshBasicMaterial());
  mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true;
  return mesh;
}
/** Where a world point lands in the shadow camera's clip space: inside the map only within -1..1 on every axis. */
function clip(light: THREE.DirectionalLight, point: THREE.Vector3): THREE.Vector3 {
  const camera = light.shadow.camera;
  camera.position.copy(light.position); camera.lookAt(light.target.position);
  camera.updateMatrixWorld(true);
  return point.clone().applyMatrix4(camera.matrixWorldInverse).applyMatrix4(camera.projectionMatrix);
}
/** Every corner of every box that takes part in shadows. */
function corners(root: THREE.Object3D): THREE.Vector3[] {
  root.updateMatrixWorld(true);
  const points: THREE.Vector3[] = [];
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh) || !(object.castShadow || object.receiveShadow)) return;
    object.geometry.computeBoundingBox();
    const box = object.geometry.boundingBox!;
    for (let i = 0; i < 8; i++) {
      points.push(new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z)
        .applyMatrix4(object.matrixWorld));
    }
  });
  return points;
}

describe('fitting the moon\'s shadow camera', () => {
  it('reaches every corner of a building far bigger than the old fixed box', () => {
    const root = new THREE.Group(), light = moon();
    root.add(block(0, 2, 0, 90, 4, 12), block(-40, 2, 30, 8, 4, 8), block(45, 8, -30, 6, 16, 6));
    const fit = fitShadowCamera(light, root)!;
    expect(fit.width).toBeGreaterThan(90);
    for (const point of corners(root)) {
      const c = clip(light, point);
      for (const axis of [c.x, c.y, c.z]) expect(Math.abs(axis)).toBeLessThanOrEqual(1 + 1e-6);
    }
  });

  it('slides the light back, keeping its direction, when geometry lies behind it', () => {
    const root = new THREE.Group(), light = moon();
    // A chimney tall enough to poke past the light's own height, on the light's side of the building.
    root.add(block(0, 2, 0, 20, 4, 20), block(-12, 30, -16, 2, 20, 2));
    const before = light.position.clone().sub(light.target.position).normalize();
    const fit = fitShadowCamera(light, root)!;
    expect(fit.pulledBack).toBeGreaterThan(0);
    expect(light.position.clone().sub(light.target.position).normalize().distanceTo(before)).toBeLessThan(1e-9);
    expect(light.shadow.camera.near).toBeGreaterThan(0);
    for (const point of corners(root)) expect(clip(light, point).z).toBeGreaterThanOrEqual(-1 - 1e-6);
  });

  it('leaves the light where it was when nothing is behind it, and ignores meshes that take no part', () => {
    const root = new THREE.Group(), light = moon();
    const decoration = block(500, 500, 500, 1, 1, 1); decoration.castShadow = decoration.receiveShadow = false;
    root.add(block(0, 1, 0, 6, 2, 6), decoration);
    const at = light.position.clone();
    const fit = fitShadowCamera(light, root)!;
    expect(fit.pulledBack).toBe(0);
    expect(light.position.equals(at)).toBe(true);
    expect(fit.width).toBeLessThan(30);
  });

  it('does nothing without anything to shadow', () => {
    const light = moon(), near = light.shadow.camera.near;
    expect(fitShadowCamera(light, new THREE.Group())).toBeNull();
    expect(light.shadow.camera.near).toBe(near);
  });

  for (const [name, map] of [['Bunker', BUNKER_MAP], ['Asylum', ASYLUM_MAP]] as const) {
    it(`covers all of ${name}'s walls, roofs and floors, so no moonlight leaks in past the box's edge`, () => {
      const greybox = buildGreybox(map.greybox, map.prisms), light = moon(map.focus);
      expect(fitShadowCamera(light, greybox)).not.toBeNull();
      const points = corners(greybox);
      expect(points.length).toBeGreaterThan(100);
      for (const point of points) {
        const c = clip(light, point);
        expect(Math.max(Math.abs(c.x), Math.abs(c.y)), `${point.toArray()}`).toBeLessThanOrEqual(1 + 1e-6);
        expect(c.z).toBeGreaterThanOrEqual(-1 - 1e-6);
        expect(c.z).toBeLessThanOrEqual(1 + 1e-6);
      }
    });
  }
});
