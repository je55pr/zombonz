import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { lampFlicker } from '../src/client/atmosphere.ts';
import {
  DEFAULT_ATMOSPHERE, LIGHTING_QUALITY, LightingPipeline, lightingQualityFromSearch,
  resolveAtmosphere, resolveMapLight,
} from '../src/client/lighting.ts';
import { ASYLUM_MAP } from '../src/maps/asylum.ts';
import { BUNKER_MAP } from '../src/maps/bunker.ts';

const renderer = () => ({ toneMapping: 0, toneMappingExposure: 0 }) as unknown as THREE.WebGLRenderer;
const state = (power: boolean, tick = 10) => ({ power: { on: power }, world: { tick } }) as any;

describe('lighting and atmosphere pipeline', () => {
  it('keeps the legacy night grade and practical-light values as the Balanced defaults', () => {
    expect(resolveAtmosphere(undefined)).toMatchObject({
      fogColor: 0x1d2b30,
      fogDensity: 0.027,
      exposure: 1.35,
      ambientSkyColor: 0xaabfc9,
      ambientGroundColor: 0x373026,
      ambientIntensity: 1.4,
      moonColor: 0xb4ced7,
      moonIntensity: 2.4,
      skyIntensity: 0.5,
    });
    expect(DEFAULT_ATMOSPHERE.moonOffset.toArray()).toEqual([-12, 22, -16]);
    expect(resolveMapLight({ x: 1, y: 2, z: 3 }, false)).toMatchObject({
      color: 0xffc38b,
      intensity: 11,
      range: 10,
      decay: 1.6,
      priority: 0,
      flicker: 'fluorescent',
      power: 'always',
      unpoweredLevel: 0.4,
    });
    expect(LIGHTING_QUALITY.balanced).toEqual({
      pointLights: 4,
      smallShadow: 1024,
      largeShadow: 2048,
      shadowRefreshHz: 15,
    });
  });

  it('defines bounded Low/Balanced/High tiers and defaults unknown query values to Balanced', () => {
    expect(LIGHTING_QUALITY.low.pointLights).toBeLessThan(LIGHTING_QUALITY.balanced.pointLights);
    expect(LIGHTING_QUALITY.low.smallShadow).toBeLessThan(LIGHTING_QUALITY.balanced.smallShadow);
    expect(LIGHTING_QUALITY.high.pointLights).toBeGreaterThan(LIGHTING_QUALITY.balanced.pointLights);
    expect(lightingQualityFromSearch('?lighting=low')).toBe('low');
    expect(lightingQualityFromSearch('?lighting=high')).toBe('high');
    expect(lightingQualityFromSearch('?lighting=potato')).toBe('balanced');
    expect(lightingQualityFromSearch('')).toBe('balanced');
  });

  it('applies map atmosphere overrides without changing omitted values', () => {
    const resolved = resolveAtmosphere({
      fogColor: 0x102030,
      fogDensity: 0.04,
      exposure: 1.1,
      moonOffset: { x: 3, y: 18, z: -7 },
    });
    expect(resolved.fogColor).toBe(0x102030);
    expect(resolved.fogDensity).toBe(0.04);
    expect(resolved.exposure).toBe(1.1);
    expect(resolved.ambientIntensity).toBe(1.4);
    expect(resolved.moonOffset.toArray()).toEqual([3, 18, -7]);
  });

  it('keeps Asylum practical lamps at the legacy 40% level before power and full after power', () => {
    const scene = new THREE.Scene();
    const pipeline = new LightingPipeline(renderer(), scene, ASYLUM_MAP, 'balanced');
    const group = new THREE.Group(); scene.add(group);
    const source = pipeline.addPractical(group, ASYLUM_MAP.lights[0], 0);
    const camera = new THREE.PerspectiveCamera(67, 16 / 9, 0.05, 80);
    camera.position.set(ASYLUM_MAP.lights[0].x, ASYLUM_MAP.lights[0].y, ASYLUM_MAP.lights[0].z + 2);
    camera.lookAt(ASYLUM_MAP.lights[0].x, ASYLUM_MAP.lights[0].y, ASYLUM_MAP.lights[0].z);

    pipeline.update(state(false, 10), camera, 0);
    expect(source.intensity).toBeCloseTo(11 * 0.4 * lampFlicker(10, 47));
    pipeline.update(state(true, 10), camera, 1 / 60);
    expect(source.intensity).toBeCloseTo(11 * lampFlicker(10, 47));
  });

  it('supports always, power-only, custom dimming and no-flicker authored practical lights', () => {
    const scene = new THREE.Scene();
    const pipeline = new LightingPipeline(renderer(), scene, ASYLUM_MAP, 'balanced');
    const group = new THREE.Group(); scene.add(group);
    const always = pipeline.addPractical(group, {
      x: 0, y: 2, z: -2, intensity: 7, flicker: 'none', power: 'always',
    }, 0);
    const powered = pipeline.addPractical(group, {
      x: 1, y: 2, z: -2, intensity: 8, flicker: 'none', power: 'power-only',
    }, 1);
    const emergency = pipeline.addPractical(group, {
      x: 2, y: 2, z: -2, intensity: 9, flicker: 'none', power: 'dim-until-power', unpoweredLevel: 0.2,
    }, 2);
    const camera = new THREE.PerspectiveCamera(67, 1, 0.05, 80);

    pipeline.update(state(false), camera, 0);
    expect(always.intensity).toBe(7);
    expect(powered.intensity).toBe(0);
    expect(emergency.intensity).toBeCloseTo(1.8);
    pipeline.update(state(true), camera, 1 / 60);
    expect(powered.intensity).toBe(8);
    expect(emergency.intensity).toBe(9);
  });

  it('keeps gameplay visibility grade identical across quality tiers', () => {
    const values = (['low', 'balanced', 'high'] as const).map(quality => {
      const fake = renderer(), scene = new THREE.Scene();
      const pipeline = new LightingPipeline(fake, scene, ASYLUM_MAP, quality);
      const fog = scene.fog as THREE.FogExp2;
      return {
        exposure: (fake as any).toneMappingExposure,
        fogColor: fog.color.getHex(),
        fogDensity: fog.density,
        ambientSky: pipeline.ambient.color.getHex(),
        ambientGround: pipeline.ambient.groundColor.getHex(),
        ambientIntensity: pipeline.ambient.intensity,
        moonColor: pipeline.moon.color.getHex(),
        moonIntensity: pipeline.moon.intensity,
      };
    });
    expect(values[1]).toEqual(values[0]);
    expect(values[2]).toEqual(values[0]);
  });

  it('chooses tier shadow sizes by map size and exposes cheap F3 metrics', () => {
    const bunker = new LightingPipeline(renderer(), new THREE.Scene(), BUNKER_MAP, 'low');
    expect(bunker.shadowSize).toBe(LIGHTING_QUALITY.low.smallShadow);
    expect(bunker.metrics()).toMatchObject({
      quality: 'low',
      realLights: 2,
      logicalSources: 0,
      shadowSize: 512,
      shadowRefreshHz: 10,
    });

    const asylum = new LightingPipeline(renderer(), new THREE.Scene(), ASYLUM_MAP, 'balanced');
    expect(asylum.shadowSize).toBe(LIGHTING_QUALITY.balanced.largeShadow);
    expect(asylum.metrics().realLights).toBe(4);
  });
});
