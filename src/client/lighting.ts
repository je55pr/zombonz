import * as THREE from 'three';
import type { SimulationState } from '../core/simulation.ts';
import type { GameMap, MapAtmosphere, MapLightDefinition, MapLightFlicker, MapLightPower } from '../maps/gameMap.ts';
import { lampFlicker } from './atmosphere.ts';
import { LightPool, LightSource } from './lightPool.ts';
import { placeMoon } from './shadowFit.ts';

export type LightingQuality = 'low' | 'balanced' | 'high';

export interface LightingQualityProfile {
  pointLights: number;
  smallShadow: number;
  largeShadow: number;
  shadowRefreshHz: number;
}

export const LIGHTING_QUALITY: Readonly<Record<LightingQuality, LightingQualityProfile>> = {
  low: { pointLights: 2, smallShadow: 512, largeShadow: 1024, shadowRefreshHz: 10 },
  balanced: { pointLights: 4, smallShadow: 1024, largeShadow: 2048, shadowRefreshHz: 15 },
  high: { pointLights: 6, smallShadow: 2048, largeShadow: 2048, shadowRefreshHz: 30 },
};

export const DEFAULT_ATMOSPHERE: Required<Omit<MapAtmosphere, 'moonOffset'>> & { moonOffset: THREE.Vector3 } = {
  fogColor: 0x1d2b30,
  fogDensity: 0.027,
  exposure: 1.35,
  ambientSkyColor: 0xaabfc9,
  ambientGroundColor: 0x373026,
  ambientIntensity: 1.4,
  moonColor: 0xb4ced7,
  moonIntensity: 2.4,
  skyIntensity: 0.5,
  moonOffset: new THREE.Vector3(-12, 22, -16),
};

export interface ResolvedAtmosphere {
  fogColor: number;
  fogDensity: number;
  exposure: number;
  ambientSkyColor: number;
  ambientGroundColor: number;
  ambientIntensity: number;
  moonColor: number;
  moonIntensity: number;
  skyIntensity: number;
  moonOffset: THREE.Vector3;
}

export interface ResolvedMapLight {
  position: THREE.Vector3;
  color: number;
  intensity: number;
  range: number;
  decay: number;
  priority: number;
  flicker: MapLightFlicker;
  power: MapLightPower;
  unpoweredLevel: number;
}

export interface LightingMetrics {
  quality: LightingQuality;
  realLights: number;
  logicalSources: number;
  shiningSources: number;
  shadowSize: number;
  shadowRefreshHz: number;
}

export function lightingQualityFromSearch(search: string): LightingQuality {
  const value = new URLSearchParams(search).get('lighting');
  return value === 'low' || value === 'high' ? value : 'balanced';
}

export function resolveAtmosphere(value: MapAtmosphere | undefined): ResolvedAtmosphere {
  const source = value ?? {};
  const offset = source.moonOffset;
  return {
    fogColor: source.fogColor ?? DEFAULT_ATMOSPHERE.fogColor,
    fogDensity: source.fogDensity ?? DEFAULT_ATMOSPHERE.fogDensity,
    exposure: source.exposure ?? DEFAULT_ATMOSPHERE.exposure,
    ambientSkyColor: source.ambientSkyColor ?? DEFAULT_ATMOSPHERE.ambientSkyColor,
    ambientGroundColor: source.ambientGroundColor ?? DEFAULT_ATMOSPHERE.ambientGroundColor,
    ambientIntensity: source.ambientIntensity ?? DEFAULT_ATMOSPHERE.ambientIntensity,
    moonColor: source.moonColor ?? DEFAULT_ATMOSPHERE.moonColor,
    moonIntensity: source.moonIntensity ?? DEFAULT_ATMOSPHERE.moonIntensity,
    skyIntensity: source.skyIntensity ?? DEFAULT_ATMOSPHERE.skyIntensity,
    moonOffset: offset
      ? new THREE.Vector3(offset.x, offset.y, offset.z)
      : DEFAULT_ATMOSPHERE.moonOffset.clone(),
  };
}

export function resolveMapLight(light: MapLightDefinition, hasPowerSwitch: boolean): ResolvedMapLight {
  return {
    position: new THREE.Vector3(light.x, light.y, light.z),
    color: light.color ?? 0xffc38b,
    intensity: light.intensity ?? 11,
    range: light.range ?? 10,
    decay: light.decay ?? 1.6,
    priority: light.priority ?? 0,
    flicker: light.flicker ?? 'fluorescent',
    power: light.power ?? (hasPowerSwitch ? 'dim-until-power' : 'always'),
    unpoweredLevel: light.unpoweredLevel ?? 0.4,
  };
}

function powerLevel(definition: ResolvedMapLight, powerOn: boolean): number {
  if (definition.power === 'always') return 1;
  if (definition.power === 'power-only') return powerOn ? 1 : 0;
  return powerOn ? 1 : definition.unpoweredLevel;
}

/**
 * Renderer-owned lighting/atmosphere pipeline. It reads authoritative power state but never feeds
 * presentation values back into simulation.
 */
export class LightingPipeline {
  readonly quality: LightingQuality;
  readonly profile: LightingQualityProfile;
  readonly atmosphere: ResolvedAtmosphere;
  readonly moon: THREE.DirectionalLight;
  readonly ambient: THREE.HemisphereLight;
  readonly lightPool: LightPool;
  readonly shadowSize: number;
  private readonly practical: Array<{ source: LightSource; definition: ResolvedMapLight; offset: number }> = [];

  constructor(
    renderer: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
    private readonly map: GameMap,
    quality: LightingQuality = 'balanced',
  ) {
    this.quality = quality;
    this.profile = LIGHTING_QUALITY[quality];
    this.atmosphere = resolveAtmosphere(map.atmosphere);

    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = this.atmosphere.exposure;
    scene.background = new THREE.Color(this.atmosphere.fogColor);
    scene.fog = new THREE.FogExp2(this.atmosphere.fogColor, this.atmosphere.fogDensity);

    this.ambient = new THREE.HemisphereLight(
      this.atmosphere.ambientSkyColor,
      this.atmosphere.ambientGroundColor,
      this.atmosphere.ambientIntensity,
    );
    scene.add(this.ambient);

    this.moon = new THREE.DirectionalLight(this.atmosphere.moonColor, this.atmosphere.moonIntensity);
    placeMoon(this.moon, map.focus);
    this.moon.position.set(
      map.focus.x + this.atmosphere.moonOffset.x,
      this.atmosphere.moonOffset.y,
      map.focus.z + this.atmosphere.moonOffset.z,
    );
    this.moon.target.position.set(map.focus.x, 0, map.focus.z);
    scene.add(this.moon.target);
    this.moon.castShadow = true;
    this.shadowSize = map.focus.radius > 24 ? this.profile.largeShadow : this.profile.smallShadow;
    this.moon.shadow.mapSize.set(this.shadowSize, this.shadowSize);
    this.moon.shadow.bias = -0.0006;
    scene.add(this.moon);

    this.lightPool = new LightPool(scene, this.profile.pointLights);
  }

  addPractical(parent: THREE.Object3D, light: MapLightDefinition, index: number): LightSource {
    const definition = resolveMapLight(light, !!this.map.powerSwitch);
    const source = this.lightPool.add(new LightSource(
      definition.color,
      definition.intensity,
      definition.range,
      definition.decay,
    ));
    source.priority = definition.priority;
    source.position.copy(definition.position);
    parent.add(source);
    this.practical.push({ source, definition, offset: index * 137 + 47 });
    return source;
  }

  update(state: SimulationState, camera: THREE.Camera, dtSeconds: number): void {
    const powerOn = !this.map.powerSwitch || state.power.on;
    for (const practical of this.practical) {
      const flicker = practical.definition.flicker === 'fluorescent'
        ? lampFlicker(state.world.tick, practical.offset)
        : 1;
      practical.source.intensity = practical.definition.intensity
        * powerLevel(practical.definition, powerOn)
        * flicker;
    }
    this.lightPool.update(camera, dtSeconds);
  }

  metrics(): LightingMetrics {
    return {
      quality: this.quality,
      realLights: this.lightPool.capacity,
      logicalSources: this.lightPool.sourceCount,
      shiningSources: this.lightPool.shining().length,
      shadowSize: this.shadowSize,
      shadowRefreshHz: this.profile.shadowRefreshHz,
    };
  }

  dispose(): void {
    this.scene.remove(this.ambient, this.moon, this.moon.target);
  }
}
