import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { readAssetGeometry } from '../scripts/inspect-assets.mjs';
import { mountWallWeapon, WallWeaponDisplays } from '../src/client/mapDetails.ts';
import { prepareWeapon } from '../src/client/weaponView.ts';
import { GameSimulation, createInputFrame } from '../src/core/index.ts';

describe('wall weapon display', () => {
  it('mounts the real gun in front of its outline without taking the equipped model', async () => {
    const source = await readAssetGeometry('public/assets/weapons/kar98k/model.glb');
    const prepared = prepareWeapon(source.scene, 'kar98k');
    const sign = new THREE.Group();
    mountWallWeapon(sign, prepared, new THREE.MeshBasicMaterial(), new THREE.MeshBasicMaterial());

    const mounted = sign.getObjectByName('wall-weapon-model');
    expect(mounted).toBeDefined();
    expect(mounted!.visible).toBe(false);
    expect(sign.children.filter(child => child !== mounted)).toHaveLength(2);
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

  it('shows a wall model only after purchase and hides it on match restart', () => {
    const simulation = new GameSimulation({ seed: 2,
      map: { collisionBoxes: [], walkSurfaces: [], zombieSpawns: [], wallWeapons: [{
        id: 'test-kar98k', position: { x: 0, y: 0, z: -1 }, weaponId: 'kar98k', weaponCost: 200, ammoCost: 100,
      }] },
      playerSpawns: [{ x: 0, y: 0, z: 0 }],
      economyConfig: { startingPoints: 500, hitReward: 10, killBonus: 50 },
    });
    const displays = new WallWeaponDisplays();
    const model = new THREE.Group();
    displays.add('test-kar98k', model);
    expect(model.visible).toBe(false);
    expect(displays.update(simulation.state.wallWeapons)).toBe(false);

    const input = createInputFrame(0);
    input.actions.interact = { held: true, pressed: true, released: false, value: 1 };
    simulation.tick({ [simulation.playerIds[0]]: input });
    expect(displays.update(simulation.state.wallWeapons)).toBe(true);
    expect(model.visible).toBe(true);
    expect(displays.update(simulation.state.wallWeapons)).toBe(false);

    const lateModel = new THREE.Group();
    displays.add('test-kar98k', lateModel);
    expect(lateModel.visible).toBe(true);
    simulation.restart();
    expect(displays.update(simulation.state.wallWeapons)).toBe(true);
    expect(lateModel.visible).toBe(false);
  });
});
