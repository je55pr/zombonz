import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { readAssetGeometry } from '../scripts/inspect-assets.mjs';
import { adsZoom, viewmodelFov } from '../src/client/aim.ts';
import { MAX_EYE_RELIEF, MIN_EYE_RELIEF, SIGHT_PERCENT, WEAPON_SIGHTS, adsPose } from '../src/client/weaponSights.ts';
import { gunForModel, prepareWeapon, VIEWMODEL_LENGTHS, WeaponView, type PreparedWeapon } from '../src/client/weaponView.ts';
import { createPlayerState } from '../src/core/index.ts';

const ids = Object.keys(VIEWMODEL_LENGTHS);
const cache = new Map<string, Promise<PreparedWeapon>>();
function prepared(id: string): Promise<PreparedWeapon> {
  let pending = cache.get(id);
  if (!pending) {
    pending = readAssetGeometry(`public/assets/weapons/${id}/model.glb`).then(source => {
      const weapon = prepareWeapon(source.scene, id);
      // Rays must see both faces: the test loader's bare materials are single-sided.
      weapon.root.traverse(object => { if (object instanceof THREE.Mesh) object.material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }); });
      weapon.root.updateMatrixWorld(true);
      return weapon;
    });
    cache.set(id, pending);
  }
  return pending;
}

/** Window shapes from square to 32:9 ultrawide. */
const ASPECTS = [1, 4 / 3, 16 / 9, 21 / 9, 32 / 9];

/** A WeaponView holding a prepared gun, so its real pose maths can be run in a test. */
function viewHolding(weapon: PreparedWeapon, gunId = 'test') {
  const view = new WeaponView(), player = createPlayerState('e:1', { x: 0, y: 0, z: 0 });
  // The view only loads models from the network; hand it this one.
  Object.assign(view as unknown as { id: string; current: PreparedWeapon }, { id: gunId, current: weapon });
  player.weapon.weaponId = gunId;
  const internals = view as unknown as { pose: THREE.Group; camera: THREE.PerspectiveCamera };
  return {
    player, camera: internals.camera, pose: internals.pose, view,
    step: (tick: number) => { view.update(player, tick, 1 / 60); internals.pose.updateMatrixWorld(true); },
    toView: (point: THREE.Vector3) => internals.pose.localToWorld(point.clone()),
  };
}

function aimed(weapon: PreparedWeapon) {
  const held = viewHolding(weapon);
  held.player.aiming = true;
  for (let tick = 0; tick < 240; tick++) held.step(tick);
  return held;
}

describe('iron sight alignment', () => {
  it('has the sights of every gun, and only guns that exist', () => {
    expect(Object.keys(WEAPON_SIGHTS).sort()).toEqual([...ids].sort());
  });

  it.each(ids)('%s: aiming puts the rear sight, the front sight and the eye on the centre of the screen at every window shape', async id => {
    const weapon = await prepared(id);
    const { toView, camera } = aimed(weapon);
    const rear = toView(weapon.sights.rear), front = toView(weapon.sights.front);
    expect(rear.z).toBeCloseTo(-weapon.sights.relief, 4);
    expect(front.z).toBeLessThan(rear.z);
    for (const point of [rear, front]) {
      expect(point.x).toBeCloseTo(0, 4);
      expect(point.y).toBeCloseTo(0, 4);
      // Through the weapon camera, whatever the shape of the window (its vertical field of view is fixed).
      for (const aspect of ASPECTS) {
        const shaped = camera.clone();
        shaped.aspect = aspect; shaped.updateProjectionMatrix(); shaped.updateMatrixWorld(true);
        const ndc = point.clone().project(shaped);
        expect(ndc.x, `${id} at ${aspect}`).toBeCloseTo(0, 4);
        expect(ndc.y, `${id} at ${aspect}`).toBeCloseTo(0, 4);
      }
    }
  });

  it.each(ids)('%s: the eye sees the front sight along a clear line, with nothing of the gun in the way', async id => {
    const weapon = await prepared(id);
    const { pose } = aimed(weapon);
    // From the eye (the view origin) toward the tip of the front sight, in gun space. The last centimetre is the
    // front sight itself: the ray meets the back of the post a little before its tip.
    const eye = pose.worldToLocal(new THREE.Vector3(0, 0, 0)), tip = weapon.sights.front;
    const direction = tip.clone().sub(eye), distance = direction.length();
    const hits = new THREE.Raycaster(eye, direction.normalize(), 0, distance + 0.01).intersectObject(weapon.root.children[0], true);
    const blocked = hits.find(hit => hit.distance < distance - 0.010);
    expect(blocked ? `${id}: blocked ${((distance - blocked.distance) * 1000).toFixed(1)} mm short of the front sight` : 'clear').toBe('clear');
  });

  it.each(ids)('%s: turns the gun by no more than a few degrees to line the sights up, and keeps it level', async id => {
    const weapon = await prepared(id);
    const angle = 2 * Math.acos(Math.min(1, Math.abs(weapon.ads.quaternion.w))) * 180 / Math.PI;
    expect(angle, `${id} is turned ${angle.toFixed(2)} degrees`).toBeLessThan(2.5);
    // No roll: the gun's side-to-side axis stays horizontal.
    expect(Math.abs(new THREE.Vector3(1, 0, 0).applyQuaternion(weapon.ads.quaternion).y)).toBeLessThan(1e-6);
  });

  it.each(ids)('%s: the eye is 13 to 150 cm behind the rear sight', async id => {
    const { relief } = (await prepared(id)).sights;
    expect(relief).toBeGreaterThanOrEqual(MIN_EYE_RELIEF - 1e-9);
    expect(relief).toBeLessThanOrEqual(MAX_EYE_RELIEF + 1e-9);
  });

  // A sight of width w at depth d across a window spans w / d / (2 tan(half horizontal angle)) of its width.
  function percentOfWindow(weapon: PreparedWeapon, gunId: string, point: THREE.Vector3, width: number, aspect: number) {
    const { toView } = aimed(weapon);
    const depth = -toView(point).z;
    const halfHorizontal = Math.tan(viewmodelFov(1, adsZoom(gunId), aspect) * Math.PI / 360) * aspect;
    return 100 * (width / depth) / (2 * halfHorizontal);
  }

  // Black Ops screenshots (1280 wide, same room, aimed) put the Kar98k's front ring at about 3.1% of the window's width.
  // Every other gun is sized to 2.8%, unless its eye relief runs into a limit.
  it.each(ids)('%s: the sight it is sized by is 2.8%% of the window width aimed (3.1%% for the Kar98k) at every window shape', async id => {
    const weapon = await prepared(id);
    const { size, relief } = weapon.sights;
    const point = size.at === 'front' ? weapon.sights.front : weapon.sights.rear;
    const target = size.percent ?? SIGHT_PERCENT;
    for (const aspect of [1, 4 / 3, 16 / 9, 21 / 9, 32 / 9]) {
      const percent = percentOfWindow(weapon, gunForModel(id), point, size.width / 1000, aspect);
      const label = `${id} ${size.at} ${size.width} mm at ${aspect}: ${percent.toFixed(2)}%`;
      if (relief <= MIN_EYE_RELIEF + 1e-9) expect(percent, label).toBeLessThanOrEqual(target + 0.05);
      else if (relief >= MAX_EYE_RELIEF - 1e-9) expect(percent, label).toBeGreaterThanOrEqual(target - 0.05);
      else expect(Math.abs(percent - target), label).toBeLessThan(0.05);
      // A gun that cannot reach the target still shows its sight at a usable size.
      expect(percent, label).toBeGreaterThan(2.4);
    }
  });

  it('the Kar98k is 3.1% and the starting pistol 2.8%, as asked', async () => {
    const kar = await prepared('kar98k'), pistol = await prepared('m1911');
    expect(percentOfWindow(kar, 'kar98k', kar.sights.front, 0.016, 16 / 9)).toBeCloseTo(3.1, 1);
    expect(percentOfWindow(pistol, 'starter-pistol', pistol.sights.rear, 0.0206, 16 / 9)).toBeCloseTo(2.8, 1);
  });

  it('a longer eye relief moves the aimed gun forward but leaves the hip pose where it was', async () => {
    const weapon = await prepared('kar98k');
    const rest = (held: PreparedWeapon) => { const view = viewHolding(held); for (let tick = 0; tick < 60; tick++) view.step(tick); return view.pose.position.clone(); };
    const longer: PreparedWeapon = { ...weapon, sights: { ...weapon.sights, relief: weapon.sights.relief + 0.1 } };
    longer.ads = adsPose(longer.sights);
    expect(rest(longer).distanceTo(rest(weapon))).toBeLessThan(1e-9);
    expect(longer.ads.position.z - weapon.ads.position.z).toBeCloseTo(-0.1, 6);
  });

  it.each(['kar98k', 'm1911', 'double-barrel'])('%s: raising the gun settles onto the sights without overshooting', async id => {
    const weapon = await prepared(id);
    const held = viewHolding(weapon);
    for (let tick = 0; tick < 60; tick++) held.step(tick);
    const hip = held.toView(weapon.sights.rear);
    expect(Math.hypot(hip.x, hip.y)).toBeGreaterThan(0.05);
    held.player.aiming = true;
    let previous = Infinity;
    for (let tick = 60; tick < 200; tick++) {
      held.step(tick);
      const rear = held.toView(weapon.sights.rear), off = Math.hypot(rear.x, rear.y);
      expect(off, `${id} at tick ${tick}`).toBeLessThanOrEqual(previous + 1e-9);
      previous = off;
    }
    expect(previous).toBeLessThan(1e-4);
  });

  it.each([['kar98k', 'kar98k'], ['m1911', 'starter-pistol']])("%s: the weapon camera is drawn with the aim lens, narrowed by the gun's own zoom", async (folder, gunId) => {
    const weapon = await prepared(folder);
    const held = viewHolding(weapon, gunId);
    const renderer = { clearDepth: () => {}, render: () => {} } as unknown as THREE.WebGLRenderer;
    const view = held.view as unknown as { render: (renderer: THREE.WebGLRenderer, aspect: number) => void };
    for (const aspect of [4 / 3, 16 / 9, 21 / 9]) {
      held.player.aiming = false;
      for (let tick = 0; tick < 240; tick++) held.step(tick);
      view.render(renderer, aspect);
      expect(held.camera.fov).toBeCloseTo(viewmodelFov(0, adsZoom(gunId), aspect), 4);
      held.player.aiming = true;
      for (let tick = 0; tick < 240; tick++) held.step(tick);
      view.render(renderer, aspect);
      expect(held.camera.fov).toBeCloseTo(viewmodelFov(1, adsZoom(gunId), aspect), 4);
      expect(held.camera.aspect).toBeCloseTo(aspect);
    }
    // Aimed, the horizontal half angle is the 65 degree lens divided by the gun's zoom: 1.74 for the Kar98k, 1.3 for the pistol.
    expect(Math.tan(held.camera.fov * Math.PI / 360) * held.camera.aspect * adsZoom(gunId)).toBeCloseTo(Math.tan(65 * Math.PI / 360), 4);
  });

  it('a gun with no listed sights is still aimed, along the top of its model', () => {
    const source = new THREE.Group();
    source.add(new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.2, 1), new THREE.MeshBasicMaterial()));
    const weapon = prepareWeapon(source, 'no-such-gun');
    const { toView } = aimed(weapon);
    for (const point of [weapon.sights.rear, weapon.sights.front]) {
      const inView = toView(point);
      expect(inView.x).toBeCloseTo(0, 4);
      expect(inView.y).toBeCloseTo(0, 4);
    }
  });
});
