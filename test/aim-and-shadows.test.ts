import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ADS_ZOOM, HANDGUNS, adsZoom, aimedFov } from '../src/client/aim.ts';
import { buildGreybox } from '../src/client/greybox.ts';
import type { GreyboxBox } from '../src/maps/gameMap.ts';
import { WEAPON_DEFINITIONS } from '../src/core/index.ts';

describe('aimed field of view', () => {
  it('narrows the view by the weapon\'s zoom, more for a shoulder weapon than a pistol', () => {
    const pistol = aimedFov(67, 'starter-pistol'), rifle = aimedFov(67, 'kar98k');
    expect(rifle).toBeLessThan(pistol);
    // Zoom is the ratio of the half-angle tangents.
    expect(Math.tan(67 * Math.PI / 360) / Math.tan(pistol * Math.PI / 360)).toBeCloseTo(ADS_ZOOM.handgun);
    expect(Math.tan(67 * Math.PI / 360) / Math.tan(rifle * Math.PI / 360)).toBeCloseTo(ADS_ZOOM.longGun);
  });

  it('is much tighter than the old fixed 13 degrees off, for every weapon and every field of view setting', () => {
    for (const fov of [55, 67, 90]) {
      for (const id of Object.keys(WEAPON_DEFINITIONS)) {
        expect(aimedFov(fov, id), `${id} at ${fov}`).toBeLessThan(fov - 13);
        expect(aimedFov(fov, id), `${id} at ${fov}`).toBeGreaterThan(20);
      }
    }
    // A wider setting stays wider aimed.
    expect(aimedFov(90, 'kar98k')).toBeGreaterThan(aimedFov(55, 'kar98k'));
  });

  it('gives the sidearms the smaller zoom', () => {
    for (const id of HANDGUNS) expect(adsZoom(id)).toBe(ADS_ZOOM.handgun);
    expect(adsZoom('thompson')).toBe(ADS_ZOOM.longGun);
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
