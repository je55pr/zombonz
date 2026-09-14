import { describe, expect, it } from 'vitest';
import {
  GameSimulation,
  WEAPON_DEFINITIONS,
  beginReload,
  createInputFrame,
  createPlayerState,
  firePlayerWeapon,
  rayFromPlayer,
  tickWeaponState,
} from '../src/core/index.ts';

const pistol = WEAPON_DEFINITIONS['starter-pistol'];
const emptyRay = { origin: { x: 0, y: 1.62, z: 0 }, direction: { x: 0, y: 0, z: -1 } };

function player() {
  return createPlayerState('e:1', { x: 0, y: 0, z: 0 });
}

describe('ammo and reload state', () => {
  it('starts with classic 8 + 32 starter pistol ammo', () => {
    const subject = player();
    expect(subject.weapon.magazineAmmo).toBe(8);
    expect(subject.weapon.reserveAmmo).toBe(32);
    expect(pistol.magazineSize).toBe(8);
  });
  it('cannot fire with an empty magazine', () => {
    const subject = player();
    subject.weapon.magazineAmmo = 0;
    expect(firePlayerWeapon(subject, emptyRay, [], [])).toEqual([]);
    expect(subject.weapon.magazineAmmo).toBe(0);
  });

  it('blocks firing while a reload is in progress', () => {
    const subject = player();
    subject.weapon.magazineAmmo = 2;
    expect(beginReload(subject)[0]).toMatchObject({ type: 'weaponReloadStarted' });
    expect(subject.weapon.reloadTicksRemaining).toBe(pistol.reloadTicks);
    expect(firePlayerWeapon(subject, rayFromPlayer(subject, 1.62), [], [])).toEqual([]);
    expect(subject.weapon.magazineAmmo).toBe(2);
  });

  it('does not start reloads for full magazines, no reserve, or duplicate requests', () => {
    const subject = player();
    expect(beginReload(subject)).toEqual([]);
    subject.weapon.magazineAmmo = 4;
    subject.weapon.reserveAmmo = 0;
    expect(beginReload(subject)).toEqual([]);
    subject.weapon.reserveAmmo = 8;
    expect(beginReload(subject)).toHaveLength(1);
    expect(beginReload(subject)).toEqual([]);
  });
  it('completes on the configured tick and transfers only available reserve ammo', () => {
    const subject = player();
    subject.weapon.magazineAmmo = 2;
    subject.weapon.reserveAmmo = 3;
    beginReload(subject);
    for (let tick = 0; tick < pistol.reloadTicks - 1; tick += 1) {
      expect(tickWeaponState(subject)).toEqual([]);
    }
    expect(subject.weapon.reloadTicksRemaining).toBe(1);
    expect(subject.weapon.magazineAmmo).toBe(2);
    const completed = tickWeaponState(subject);
    expect(completed[0]).toMatchObject({ type: 'weaponReloadCompleted', loaded: 3 });
    expect(subject.weapon).toMatchObject({ magazineAmmo: 5, reserveAmmo: 0, reloadTicksRemaining: 0 });
  });

  it('fills the magazine and deducts the matching reserve amount', () => {
    const subject = player();
    subject.weapon.magazineAmmo = 2;
    beginReload(subject);
    for (let tick = 0; tick < pistol.reloadTicks; tick += 1) tickWeaponState(subject);
    expect(subject.weapon.magazineAmmo).toBe(8);
    expect(subject.weapon.reserveAmmo).toBe(26);
  });
  it('runs reload timing through GameSimulation and keeps state renderer-readable', () => {
    const simulation = new GameSimulation({
      seed: 7,
      map: { collisionBoxes: [], walkSurfaces: [], zombieSpawns: [] },
      playerSpawns: [{ x: 0, y: 0, z: 0 }],
      roundConfig: { initialWaitTicks: 9999, intermissionTicks: 9999 },
    });
    const id = simulation.playerIds[0];
    const subject = simulation.getPlayer(id)!;
    subject.weapon.magazineAmmo = 0;
    const reload = createInputFrame(0);
    reload.actions.reload = { held: true, pressed: true, released: false, value: 1 };
    const started = simulation.tick({ [id]: reload });
    expect(started.some((event) => event.type === 'weaponReloadStarted')).toBe(true);
    expect(subject.weapon.reloadTicksRemaining).toBe(pistol.reloadTicks);

    let finalEvents = [] as ReturnType<typeof simulation.tick>;
    for (let tick = 0; tick < pistol.reloadTicks; tick += 1) finalEvents = simulation.tick();
    expect(finalEvents.some((event) => event.type === 'weaponReloadCompleted')).toBe(true);
    expect(subject.weapon).toMatchObject({ magazineAmmo: 8, reserveAmmo: 24, reloadTicksRemaining: 0 });
    expect(JSON.parse(JSON.stringify(subject.weapon))).toEqual(subject.weapon);
  });
});
