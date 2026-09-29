import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { assetExists, readAssetGeometry } from '../scripts/inspect-assets.mjs';
import { cloneZombieModel, inPlaceClip, WEAPON_ASSETS, type ZombieAsset } from '../src/client/runtimeAssets.ts';
import { prepareWeapon, VIEWMODEL_LENGTHS, WeaponView } from '../src/client/weaponView.ts';
import { SkinnedZombieView, zombieAnimation } from '../src/client/skinnedZombieView.ts';
import { zombieLook } from '../src/client/zombieLooks.ts';
import { createPlayerState, createZombieState, createWeaponState, WEAPON_DEFINITIONS } from '../src/core/index.ts';
import { BrowserInput } from '../src/client/input.ts';

describe('runtime GLB integration', () => {
  it.each(Object.keys(VIEWMODEL_LENGTHS))('prepares %s as a compact, correctly scaled non-skinned viewmodel', async id => {
    const asset = await readAssetGeometry(`public/assets/weapons/${id}/model.glb`);
    const before = new THREE.Box3().setFromObject(asset.scene);
    const weapon = prepareWeapon(asset.scene, id);
    const box = new THREE.Box3().setFromObject(weapon.root), size = box.getSize(new THREE.Vector3());
    expect(size.z).toBeCloseTo(VIEWMODEL_LENGTHS[id]);
    // Catches detached-magazine exports; drums, side magazines and bipods are genuinely wider.
    expect(size.x).toBeLessThan(['mg42', 'ppsh41', 'thompson', 'fg42', 'rpg7'].includes(id) ? 0.2 : 0.12);
    expect(box.max.z).toBeCloseTo(0);
    let meshes = 0;
    weapon.root.traverse(object => { if (object instanceof THREE.Mesh) { meshes++; expect(object).not.toBeInstanceOf(THREE.SkinnedMesh); } });
    // One draw per source material; only one viewmodel renders at a time (the Thompson has 12).
    expect(meshes).toBeLessThanOrEqual(12);
    expect(new THREE.Box3().setFromObject(asset.scene).equals(before)).toBe(true);
    // Aiming puts the sight line on the camera axis: it must lie on the gun, with the rear sight behind the muzzle.
    expect(Math.abs(weapon.sight.height)).toBeLessThan(id === 'rpg7' ? 0.06 : 0.04);
    expect(Math.abs(weapon.sight.x)).toBeLessThan(id === 'rpg7' ? 0.09 : 0.04);
    expect(weapon.sight.rearZ).toBeLessThanOrEqual(0);
    expect(weapon.sight.rearZ).toBeGreaterThan(-VIEWMODEL_LENGTHS[id] * 0.8);
  });

  it.each(['peter_d', 'pxltiger'])('binds %s animations, clones independent skeletons and pins root motion', async id => {
    const [model, walk] = await Promise.all([readAssetGeometry(`public/assets/zombies/${id}/model.glb`),
      readAssetGeometry(`public/assets/zombies/${id}/walk.glb`)]);
    const clip = inPlaceClip(walk.animations[0], model.scene);
    expect(clip.tracks.length).toBeGreaterThan(30);
    expect(clip.tracks.length).toBeLessThanOrEqual(walk.animations[0].tracks.length);
    const asset: ZombieAsset = { model: model.scene, clips: { walk: clip } };
    const first = cloneZombieModel(asset), second = cloneZombieModel(asset);
    expect(new THREE.Box3().setFromObject(first.body).getSize(new THREE.Vector3()).y).toBeCloseTo(1.72);
    const skin = (root: THREE.Object3D) => { let result!: THREE.SkinnedMesh; root.traverse(object => { if (object instanceof THREE.SkinnedMesh) result = object; }); return result; };
    expect(skin(first.model).skeleton).not.toBe(skin(second.model).skeleton);
    expect(skin(first.model).geometry).toBe(skin(second.model).geometry);
    if (id === 'peter_d') expect(skin(first.model).geometry.getAttribute('position').count).toBeLessThan(10000);
    const rootTrack = clip.tracks.find(track => track.name === 'Hips.position');
    if (rootTrack) {
      const hips = model.scene.getObjectByName('Hips')!;
      for (let i = 0; i < rootTrack.values.length; i += 3) {
        expect(rootTrack.values[i]).toBeCloseTo(hips.position.x);
        expect(rootTrack.values[i + 1]).toBeCloseTo(hips.position.y);
      }
    }
    const mixer = new THREE.AnimationMixer(first.model); mixer.clipAction(clip).play(); mixer.update(0.5);
    first.body.updateMatrixWorld(true);
    const animatedBounds = new THREE.Box3();
    first.model.traverse(object => {
      if (object instanceof THREE.SkinnedMesh) {
        object.computeBoundingBox(); animatedBounds.union(object.boundingBox!.clone().applyMatrix4(object.matrixWorld));
      }
    });
    const poseSize = animatedBounds.getSize(new THREE.Vector3());
    expect(poseSize.y).toBeGreaterThan(1.2); // catches a double-applied pelvis helper rotation
    expect(poseSize.z).toBeLessThan(1.2);
  });

  it.each(['peter_d', 'pxltiger'])('keeps %s running mesh aligned with the fixed-height hitbox', async id => {
    const [model, run] = await Promise.all([readAssetGeometry(`public/assets/zombies/${id}/model.glb`),
      readAssetGeometry(`public/assets/zombies/${id}/run.glb`)]);
    const clip = inPlaceClip(run.animations[0], model.scene);
    if (id === 'peter_d') {
      expect(clip.tracks.some(track => track.name === 'Root.scale' || track.name === 'Root.quaternion')).toBe(false);
    }
    const instance = cloneZombieModel({ model: model.scene, clips: { run: clip } });
    const mixer = new THREE.AnimationMixer(instance.model);
    mixer.clipAction(clip).play();
    for (const time of [0, 0.2, 0.4, 0.6]) {
      mixer.setTime(time);
      instance.body.updateMatrixWorld(true);
      const bounds = new THREE.Box3();
      instance.model.traverse(object => {
        if (object instanceof THREE.SkinnedMesh) {
          object.computeBoundingBox();
          bounds.union(object.boundingBox!.clone().applyMatrix4(object.matrixWorld));
        }
      });
      expect(bounds.min.y).toBeGreaterThan(-0.12);
      expect(bounds.max.y).toBeGreaterThan(1.4);
      expect(bounds.max.y).toBeLessThan(1.9);
    }
  });

  it('selects attack/walk/death from simulation state and expires corpses', () => {
    const zombie = createZombieState('e:2', { x: 1, y: 0, z: 1 }, 1);
    expect(zombieAnimation(zombie)).toBe('idle');
    zombie.velocity.x = 1; expect(zombieAnimation(zombie)).toBe('walk');
    zombie.attackTicks = 5; expect(zombieAnimation(zombie)).toBe('attack');
    zombie.alive = false; expect(zombieAnimation(zombie)).toBe('death');
    const model = new THREE.Group(); model.add(new THREE.Mesh(new THREE.BoxGeometry()));
    const view = new SkinnedZombieView({ model, clips: {} }, zombieLook(zombie));
    view.update(zombie, 10); expect(view.expired(200)).toBe(false); expect(view.expired(251)).toBe(true);
    expect(zombie.position).toEqual({ x: 1, y: 0, z: 1 }); view.dispose();
  });

  it('maps existing gameplay weapons to real assets without substituting unrelated guns', () => {
    expect(WEAPON_ASSETS['starter-pistol']).toBe('m1911');
    // Every gun now has a licensed model; none falls back to the placeholder.
    expect(Object.keys(WEAPON_DEFINITIONS).filter(id => !WEAPON_ASSETS[id])).toEqual([]);
    for (const [id, asset] of Object.entries(WEAPON_ASSETS)) {
      expect(WEAPON_DEFINITIONS[id], id).toBeDefined();
      expect(assetExists(`public/assets/weapons/${asset}/model.glb`), asset).toBe(true);
    }
  });

  it('shows recoil/flash only after an authoritative shot, and lowers the gun during reload', () => {
    const player = createPlayerState('e:1', { x: 0, y: 0, z: 0 }); player.weapon = createWeaponState('thompson');
    const view = new WeaponView(), renderer = { clearDepth: vi.fn(), render: vi.fn() };
    view.update(player, 60); view.render(renderer as unknown as THREE.WebGLRenderer, 16 / 9);
    const scene = renderer.render.mock.calls[0][0] as THREE.Scene;
    const pose = scene.getObjectByName('weapon-pose')!, flash = scene.getObjectByName('muzzle-flash')!;
    const restY = pose.position.y, restZ = pose.position.z;
    expect(flash.visible).toBe(false);
    view.events([{ type: 'weaponFired', playerId: player.id, weaponId: 'thompson' }], player.id, 61);
    view.update(player, 61); expect(flash.visible).toBe(true); expect(pose.position.z).toBeGreaterThan(restZ);
    player.weapon.reloadTicksRemaining = 60; view.update(player, 120);
    expect(pose.position.y).toBeLessThan(restY); expect(flash.visible).toBe(false);
    view.events([{ type: 'matchRestarted', previousSeed: 1, seed: 2 }], player.id, 0);
    view.update(player, 0); expect(flash.visible).toBe(false);
  });

  it('centres the weapon while aiming and lowers it while sprinting', () => {
    const player = createPlayerState('e:1', { x: 0, y: 0, z: 0 });
    const view = new WeaponView(), renderer = { clearDepth: vi.fn(), render: vi.fn() };
    view.update(player, 0); view.render(renderer as unknown as THREE.WebGLRenderer, 16 / 9);
    const scene = renderer.render.mock.calls[0][0] as THREE.Scene;
    const pose = scene.getObjectByName('weapon-pose')!;
    const restX = pose.position.x, restY = pose.position.y;
    player.aiming = true;
    for (let i = 0; i < 20; i++) view.update(player, i, 1 / 60);
    expect(pose.position.x).toBeLessThan(restX * 0.1);
    expect(pose.position.y).toBeGreaterThan(restY);
    player.aiming = false; player.sprinting = true;
    for (let i = 20; i < 40; i++) view.update(player, i, 1 / 60);
    expect(pose.position.y).toBeLessThan(restY);
  });

  it('enables the keyboard firing harness only when explicitly configured for previews', () => {
    for (const enabled of [true, false]) {
      const target = new EventTarget(), pointer = new EventTarget();
      const input = new BrowserInput({ pointerElement: pointer as HTMLElement, previewFireKey: enabled }, target as Window);
      target.dispatchEvent(Object.assign(new Event('keydown'), { code: 'KeyP', repeat: false }));
      expect(!!input.consume().actions.fire?.pressed).toBe(enabled); input.dispose();
    }
  });
});
