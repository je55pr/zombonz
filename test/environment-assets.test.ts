import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { readAssetGeometry, readAssetJson, assetExists, glbFiles, readGlbJson } from '../scripts/inspect-assets.mjs';
import { BUNKER_PROPS, propCollisionBox } from '../src/maps/bunkerProps.ts';
import { BUNKER_BARRIERS, BUNKER_STAIRS, BUNKER_PLAYER_SPAWN, greyboxCollisionBoxes } from '../src/maps/bunkerLegacy.ts';
import { hasClearNavigationLine } from '../src/core/navigation.ts';
import { prepareProp } from '../src/client/environmentProps.ts';
import { applyPbrMaps, environmentMaterial, bunkerMaterial, MATERIAL_IDS, projectWorldUvs } from '../src/client/environmentMaterials.ts';
import { batchStaticMeshes } from '../src/client/staticBatch.ts';

describe('environment pack integration', () => {
  it('ships no transmissive glass (three.js would redraw the whole scene for it every frame)', () => {
    const files = glbFiles('public/assets');
    expect(files.length).toBeGreaterThan(20);
    const transmissive = files.filter(path => readGlbJson(path).extensionsUsed?.includes('KHR_materials_transmission'));
    expect(transmissive, 'run scripts/weapon-convert/plain-glass.mjs').toEqual([]);
  });

  it('uses only checked-in materials and props from the pack manifests', () => {
    const environment = readAssetJson('public/assets/environment/manifest.json');
    const props = readAssetJson('public/assets/props/manifest.json');
    const paths = new Set(Object.values({ ...props.props, ...props.vehicles }).map((p: any) => p.model));
    for (const id of MATERIAL_IDS) for (const map of ['basecolor', 'normal', 'arm'])
      expect(assetExists(`public${environment.materials[id][map]}`)).toBe(true);
    for (const prop of BUNKER_PROPS) expect(paths.has(`/assets/props/${prop.asset}/model.glb`)).toBe(true);
    expect(new Set(BUNKER_PROPS.map(p => p.id)).size).toBe(BUNKER_PROPS.length);
  });

  it.each([...new Set(BUNKER_PROPS.map(p => p.asset))])('fits %s on its authored floor and inside its collision envelope', async asset => {
    const gltf = await readAssetGeometry(`public/assets/props/${asset}/model.glb`);
    const original = new THREE.Box3().setFromObject(gltf.scene);
    for (const placement of BUNKER_PROPS.filter(p => p.asset === asset)) {
      const prop = prepareProp(gltf.scene, placement), bounds = new THREE.Box3().setFromObject(prop);
      const envelope = propCollisionBox(placement);
      expect(bounds.min.y).toBeCloseTo(placement.position.y);
      for (const axis of ['x', 'y', 'z'] as const) {
        expect(bounds.min[axis]).toBeGreaterThanOrEqual(envelope.min[axis] - 1e-6);
        expect(bounds.max[axis]).toBeLessThanOrEqual(envelope.max[axis] + 1e-6);
      }
      expect(new THREE.Box3().setFromObject(gltf.scene).equals(original)).toBe(true);
    }
  });

  it('keeps spawn, barrier landings and stair centre-lines free of solid dressing', () => {
    const props = BUNKER_PROPS.filter(p => p.solid).map(propCollisionBox);
    for (const point of [BUNKER_PLAYER_SPAWN, ...BUNKER_BARRIERS.map(b => b.insidePoint), ...BUNKER_STAIRS.flatMap(s => s.route)])
      expect(hasClearNavigationLine(point, point, props, 0.34), JSON.stringify(point)).toBe(true);
    for (const prop of props) expect(greyboxCollisionBoxes()).toContainEqual(prop);
  });

  it('shares material instances, uses the packed ARM channels and metre-scaled UVs', () => {
    expect(bunkerMaterial('wall')).toBe(environmentMaterial('weathered-concrete-a'));
    const material = new THREE.MeshStandardMaterial(), color = new THREE.Texture(), normal = new THREE.Texture(), arm = new THREE.Texture();
    applyPbrMaps(material, color, normal, arm);
    expect(material.map).toBe(color); expect(material.normalMap).toBe(normal);
    expect(material.roughnessMap).toBe(arm); expect(material.metalnessMap).toBe(arm); expect(material.aoMap).toBe(arm);
    expect(material.metalness).toBe(1); expect(arm.channel).toBe(0);
    const geometry = new THREE.BoxGeometry(8, 3, 0.4); projectWorldUvs(geometry);
    const uv = geometry.attributes.uv;
    expect(Math.max(...Array.from({ length: uv.count }, (_, i) => uv.getX(i)))).toBe(2);
    expect(Math.min(...Array.from({ length: uv.count }, (_, i) => uv.getX(i)))).toBe(-2);
  });

  it('batches compatible props without merging incompatible indexed / tangent layouts', () => {
    const error = vi.spyOn(console, 'error');
    const group = new THREE.Group(), material = new THREE.MeshStandardMaterial();
    for (let i = 0; i < 2; i++) group.add(new THREE.Mesh(new THREE.BoxGeometry(), material));
    for (let i = 0; i < 2; i++) group.add(new THREE.Mesh(new THREE.BoxGeometry().toNonIndexed(), material));
    const tangentGeometry = new THREE.BoxGeometry(); tangentGeometry.computeTangents();
    group.add(new THREE.Mesh(tangentGeometry, material));
    batchStaticMeshes(group);
    expect(error).not.toHaveBeenCalled(); expect(group.children).toHaveLength(3);
    error.mockRestore();
  });
});
