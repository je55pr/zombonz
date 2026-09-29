import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { readAssetGeometry } from '../scripts/inspect-assets.mjs';
import { mountWallWeapon } from '../src/client/mapDetails.ts';
import { prepareWeapon } from '../src/client/weaponView.ts';

describe('wall weapon display', () => {
  it('mounts the real gun in front of its outline without taking the equipped model', async () => {
    const source = await readAssetGeometry('public/assets/weapons/kar98k/model.glb');
    const prepared = prepareWeapon(source.scene, 'kar98k');
    const sign = new THREE.Group();
    mountWallWeapon(sign, prepared, new THREE.MeshBasicMaterial(), new THREE.MeshBasicMaterial());

    const mounted = sign.getObjectByName('wall-weapon-model');
    expect(mounted).toBeDefined();
    expect(mounted).not.toBe(prepared.root);
    const bounds = new THREE.Box3().setFromObject(mounted!);
    const size = bounds.getSize(new THREE.Vector3());
    expect(bounds.min.z).toBeGreaterThan(0.02);
    expect(size.x).toBeGreaterThan(0.8);
    expect(size.y).toBeGreaterThan(0.05);
    let meshes = 0;
    mounted!.traverse(object => { if (object instanceof THREE.Mesh) { meshes++; expect(object.castShadow).toBe(true); } });
    expect(meshes).toBeGreaterThan(0);

    const equipped = new THREE.Group();
    equipped.add(prepared.root);
    expect(mounted!.parent).toBe(sign);
    expect(prepared.root.parent).toBe(equipped);
  });
});
