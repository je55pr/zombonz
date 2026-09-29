import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { readAssetGeometry } from '../scripts/inspect-assets.mjs';

// The real models, read from disk: the loader the game uses fetches them over HTTP.
vi.mock('../src/client/runtimeAssets.ts', async importOriginal => {
  const original = await importOriginal<typeof import('../src/client/runtimeAssets.ts')>();
  return { ...original, loadModel: (path: string) => readAssetGeometry(`public/assets/${path}`) };
});

import { ADS_ZOOM, adsZoom, viewmodelFov } from '../src/client/aim.ts';
import { WEAPON_ASSETS } from '../src/client/runtimeAssets.ts';
import { gunClip } from '../src/client/audio.ts';
import { LightPool, LightSource } from '../src/client/lightPool.ts';
import { PACK_A_PUNCH_GLOW, buildPackAPunchMachines } from '../src/client/packAPunchView.ts';
import { WeaponView, applyPackedLook, gunForModel, prepareWeaponModel, readyWeaponModel, type PreparedWeapon } from '../src/client/weaponView.ts';
import { UPGRADE_SPECS, createPlayerState, createWeaponState, upgradeIdFor, PACK_A_PUNCH_RULES } from '../src/core/index.ts';
import { ASYLUM_MAP } from '../src/maps/asylum.ts';
import { BUNKER_MAP } from '../src/maps/bunker.ts';
import { createMatch } from '../src/maps/match.ts';

afterEach(() => vi.unstubAllGlobals());

function stubCanvas(): void {
  vi.stubGlobal('document', { createElement: () => {
    const context = new Proxy({ measureText: () => ({ width: 40 }) } as Record<string | symbol, unknown>,
      { get: (target, key) => target[key] ?? (target[key] = vi.fn()) });
    return { width: 0, height: 0, getContext: () => context };
  } });
}

describe('an upgraded gun in the client', () => {
  it('is drawn with its base gun\'s model, and each base gun\'s model is still found by the base gun', () => {
    for (const base of Object.keys(UPGRADE_SPECS)) {
      expect(WEAPON_ASSETS[`${base}-pap`], base).toBe(WEAPON_ASSETS[base]);
      expect(gunForModel(WEAPON_ASSETS[base]), base).toBe(base);
    }
  });

  it('sounds like its base gun, a little heavier', () => {
    expect(gunClip('kar98k-pap')).toEqual({ clip: gunClip('kar98k').clip, rate: 0.94 });
    expect(gunClip('starter-pistol-pap').clip).toBe(gunClip('starter-pistol').clip);
    expect(gunClip('kar98k').rate).toBe(1);
    expect(gunClip('rpg7-pap').rate).toBeLessThan(gunClip('rpg7').rate);
    // No upgraded gun falls back to the pistol's clip.
    for (const base of Object.keys(UPGRADE_SPECS)) expect(gunClip(`${base}-pap`).clip, base).toBe(gunClip(base).clip);
  });

  it('tints a copy of the model, and never writes to the base gun\'s own materials', () => {
    const material = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0.4 });
    const root = new THREE.Group(); root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material));
    const weapon = { root, magazine: new THREE.Group() } as unknown as PreparedWeapon;
    applyPackedLook(weapon);
    const packed = (root.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial;
    expect(packed).not.toBe(material);
    expect(material.emissiveIntensity).toBe(1);
    expect(material.emissive.getHex()).toBe(0x000000);
    expect(material.color.getHex()).toBe(0xffffff);
    expect(packed.emissive.getHex()).not.toBe(0x000000);
    expect(packed.color.b).toBeGreaterThan(packed.color.r);
    expect(packed.metalness).toBe(1);
  });

  it('keeps a prepared model of its own, apart from the base gun\'s, made from the same file', async () => {
    const base = await prepareWeaponModel('kar98k')!, packed = await prepareWeaponModel('kar98k-pap')!;
    expect(packed).not.toBe(base);
    expect(readyWeaponModel('kar98k')).toBe(base);
    expect(readyWeaponModel('kar98k-pap')).toBe(packed);
    // The same gun, the same sights and lens: only the look differs.
    expect(packed.sights.rear.toArray()).toEqual(base.sights.rear.toArray());
    expect(packed.sights.relief).toBe(base.sights.relief);
    const glow = (weapon: PreparedWeapon) => { let strongest = 0; weapon.root.traverse(object => {
      if (object instanceof THREE.Mesh && object.material instanceof THREE.MeshStandardMaterial) strongest = Math.max(strongest, object.material.emissiveIntensity * object.material.emissive.r
        + object.material.emissiveIntensity * object.material.emissive.b); }); return strongest; };
    expect(glow(base)).toBe(0);
    expect(glow(packed)).toBeGreaterThan(0);
    expect(prepareWeaponModel('kar98k-pap')).toBe(prepareWeaponModel('kar98k-pap'));
  });

  it('is held with its base gun\'s lens, hip pose and zoom', async () => {
    const weapon = await prepareWeaponModel('starter-pistol-pap')!;
    const view = new WeaponView(), player = createPlayerState('e:1', { x: 0, y: 0, z: 0 });
    Object.assign(view as unknown as { id: string; current: PreparedWeapon }, { id: 'starter-pistol-pap', current: weapon });
    player.weapon = createWeaponState('starter-pistol-pap'); player.aiming = true;
    for (let tick = 0; tick < 240; tick++) view.update(player, tick, 1 / 60);
    const camera = (view as unknown as { camera: THREE.PerspectiveCamera }).camera;
    view.render({ clearDepth: () => {}, render: () => {} } as unknown as THREE.WebGLRenderer, 16 / 9);
    expect(adsZoom('starter-pistol')).toBe(ADS_ZOOM.handgun);
    expect(camera.fov).toBeCloseTo(viewmodelFov(1, ADS_ZOOM.handgun, 16 / 9), 4);
  });
});

describe('the machine on screen', () => {
  function machineOn(map: typeof BUNKER_MAP, power: boolean) {
    stubCanvas();
    const scene = new THREE.Scene(), group = new THREE.Group(); scene.add(group);
    const view = buildPackAPunchMachines(group, map, new LightPool(scene));
    const sim = createMatch(map, 1, 1);
    sim.state.power.on = power;
    const light = (() => { let found: LightSource | undefined; group.traverse(object => { if (object instanceof LightSource) found = object; }); return found!; })();
    const display = group.getObjectByName('pack-a-punch-display')!;
    return { group, view, sim, machine: sim.state.packAPunch[0], light, display };
  }

  it('is built for each machine of a map, and none for a map without any', () => {
    stubCanvas();
    const scene = new THREE.Scene(), group = new THREE.Group();
    buildPackAPunchMachines(group, { ...BUNKER_MAP, packAPunch: undefined }, new LightPool(scene));
    expect(group.children).toHaveLength(0);
    buildPackAPunchMachines(group, BUNKER_MAP, new LightPool(scene));
    expect(group.children).toHaveLength(1);
    const root = group.children[0];
    expect(root.position.x).toBeCloseTo(BUNKER_MAP.packAPunch![0].position.x);
    expect(root.position.y).toBeCloseTo(BUNKER_MAP.packAPunch![0].position.y);
    expect(root.position.z).toBeCloseTo(BUNKER_MAP.packAPunch![0].position.z);
  });

  it('is dark without the power, glows cool while it waits, hot while it works and green when the gun is out', () => {
    const dark = machineOn(ASYLUM_MAP, false);
    dark.view.update(dark.sim.state);
    expect(dark.light.intensity).toBe(0);
    const { view, sim, machine, light } = machineOn(BUNKER_MAP, true);
    view.update(sim.state);
    expect(light.intensity).toBeGreaterThan(0);
    expect(light.color.getHex()).toBe(PACK_A_PUNCH_GLOW.idle);
    const idle = light.intensity;
    Object.assign(machine, { phase: 'upgrading', ownerId: sim.playerIds[0], weaponId: 'kar98k-pap', cooldownTicks: PACK_A_PUNCH_RULES.upgradeTicks / 2 });
    view.update(sim.state);
    expect(light.color.getHex()).toBe(PACK_A_PUNCH_GLOW.upgrading);
    expect(light.intensity).toBeGreaterThan(idle);
    Object.assign(machine, { phase: 'ready', cooldownTicks: PACK_A_PUNCH_RULES.collectTicks });
    view.update(sim.state);
    expect(light.color.getHex()).toBe(PACK_A_PUNCH_GLOW.ready);
    Object.assign(machine, { phase: 'idle', ownerId: null, weaponId: null, cooldownTicks: 0 });
    view.update(sim.state);
    expect(light.color.getHex()).toBe(PACK_A_PUNCH_GLOW.idle);
  });

  it('shows the gun that went in, then the upgraded one, and says when the scene changed', async () => {
    await prepareWeaponModel('kar98k'); await prepareWeaponModel('kar98k-pap');
    const { view, sim, machine, display } = machineOn(BUNKER_MAP, true);
    const owner = sim.playerIds[0];
    view.update(sim.state);
    expect(view.update(sim.state), 'an idle machine changes nothing').toBe(false);
    expect(display.visible).toBe(false);
    const total = PACK_A_PUNCH_RULES.upgradeTicks;
    const holding = () => display.children.filter(child => child.visible);
    const glowOf = (object: THREE.Object3D) => { let glow = 0; object.traverse(child => {
      if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial) glow = Math.max(glow, child.material.emissiveIntensity * (child.material.emissive.r + child.material.emissive.g + child.material.emissive.b)); }); return glow; };
    // The gun goes in: the plain one, sliding into the front.
    Object.assign(machine, { phase: 'upgrading', ownerId: owner, weaponId: 'kar98k-pap', cooldownTicks: total - 6 });
    expect(view.update(sim.state)).toBe(true);
    expect(display.visible).toBe(true);
    expect(holding()).toHaveLength(1);
    expect(glowOf(holding()[0])).toBe(0);
    const outside = display.position.z;
    // Inside the machine, nothing shows.
    machine.cooldownTicks = total / 2;
    expect(view.update(sim.state)).toBe(true);
    expect(display.visible).toBe(false);
    // Coming out: the upgraded one, pushed from the front.
    machine.cooldownTicks = 20;
    view.update(sim.state);
    expect(display.visible).toBe(true);
    expect(glowOf(holding()[0])).toBeGreaterThan(0);
    expect(display.position.z).toBeLessThan(outside);
    // Ready: it hovers out in front, and nothing changed that needs the shadows redrawn from one tick to the next.
    Object.assign(machine, { phase: 'ready', cooldownTicks: PACK_A_PUNCH_RULES.collectTicks });
    expect(view.update(sim.state)).toBe(true);
    expect(display.position.z, 'fully out').toBeGreaterThan(outside);
    expect(view.update(sim.state)).toBe(false);
    // Taken (or lost): it is gone.
    Object.assign(machine, { phase: 'idle', ownerId: null, weaponId: null, cooldownTicks: 0 });
    expect(view.update(sim.state)).toBe(true);
    expect(display.visible).toBe(false);
  });
});

describe('every gun\'s upgrade has a model to show', () => {
  it.each(Object.keys(UPGRADE_SPECS))('%s', async base => {
    const id = upgradeIdFor(base)!;
    const weapon = await prepareWeaponModel(id)!;
    expect(weapon, id).not.toBeNull();
    expect(readyWeaponModel(id), id).toBe(weapon);
  });
});
