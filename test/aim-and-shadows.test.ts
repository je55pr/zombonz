import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ADS_ZOOM, HANDGUNS, VIEWMODEL_AIMED_HFOV, VIEWMODEL_HIP_FOV, adsZoom, aimedFov, viewmodelFov } from '../src/client/aim.ts';
import { buildGreybox } from '../src/client/greybox.ts';
import type { GreyboxBox } from '../src/maps/gameMap.ts';
import { WEAPON_DEFINITIONS } from '../src/core/index.ts';

describe('aimed field of view', () => {
  const zoomOf = (hip: number, aimed: number) => Math.tan(hip * Math.PI / 360) / Math.tan(aimed * Math.PI / 360);

  it('narrows the view of a shoulder weapon by 1.74 times (measured from Black Ops screenshots) and leaves a sidearm alone', () => {
    // Zoom is the ratio of the half-angle tangents.
    expect(zoomOf(67, aimedFov(67, 'kar98k'))).toBeCloseTo(ADS_ZOOM.longGun);
    expect(ADS_ZOOM.longGun).toBeCloseTo(1.74, 2);
    expect(aimedFov(67, 'starter-pistol')).toBeCloseTo(67);
    expect(ADS_ZOOM.handgun).toBe(1);
  });

  it('is much tighter than the old fixed 13 degrees off for every shoulder weapon and every field of view setting', () => {
    for (const fov of [55, 67, 90]) {
      for (const id of Object.keys(WEAPON_DEFINITIONS).filter(id => !HANDGUNS.has(id))) {
        expect(aimedFov(fov, id), `${id} at ${fov}`).toBeLessThan(fov - 13);
        expect(aimedFov(fov, id), `${id} at ${fov}`).toBeGreaterThan(20);
      }
    }
    // A wider setting stays wider aimed.
    expect(aimedFov(90, 'kar98k')).toBeGreaterThan(aimedFov(55, 'kar98k'));
  });

  it('gives the sidearms no zoom and every other gun the same', () => {
    for (const id of HANDGUNS) expect(adsZoom(id)).toBe(ADS_ZOOM.handgun);
    for (const id of ['thompson', 'kar98k', 'mp5k', 'spas12']) expect(adsZoom(id)).toBe(ADS_ZOOM.longGun);
  });
});

describe("the gun's own lens", () => {
  it('is the hip lens at rest and magnifies like the world when fully aimed, at any window shape', () => {
    for (const aspect of [1, 4 / 3, 16 / 9, 21 / 9]) {
      expect(viewmodelFov(0, ADS_ZOOM.longGun, aspect)).toBeCloseTo(VIEWMODEL_HIP_FOV);
      const aimed = viewmodelFov(1, ADS_ZOOM.longGun, aspect);
      // Horizontal half-angle: the Black Ops default of 65 degrees, narrowed by the aim zoom, whatever the window's shape.
      expect(Math.tan(aimed * Math.PI / 360) * aspect * ADS_ZOOM.longGun).toBeCloseTo(Math.tan(VIEWMODEL_AIMED_HFOV * Math.PI / 360));
    }
  });

  it('moves smoothly between the two lenses', () => {
    let previous = viewmodelFov(0, 1.74, 16 / 9);
    for (let blend = 0.1; blend <= 1.0001; blend += 0.1) {
      const now = viewmodelFov(blend, 1.74, 16 / 9);
      expect(now).toBeLessThan(previous);
      previous = now;
    }
  });
});

describe('moon shadows', () => {
  const slab = (material: GreyboxBox['material']): GreyboxBox => ({
    center: { x: 0, y: 3, z: 0 }, size: { x: 4, y: 0.24, z: 4 }, material, collides: false, look: 'cracked-concrete-floor' });

  it('lets ceilings, roofs and upper floors block the moon, but not the ground floor', () => {
    const casts = (material: GreyboxBox['material']) => (buildGreybox([slab(material)]).children[0] as THREE.Mesh).castShadow;
    expect(casts('upperFloor')).toBe(true);
    expect(casts('wall')).toBe(true);
    expect(casts('stair')).toBe(true);
    expect(casts('floor')).toBe(false);
  });
});
