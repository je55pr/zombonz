import { describe, expect, it } from 'vitest';
import {
  GameSimulation,
  WEAPON_DEFINITIONS,
  addEntity,
  createInputFrame,
  createPlayerState,
  createZombieState,
  firePlayerWeapon,
  rayFromPlayer,
  resolveHitscan,
  spreadHitscanRay,
  createWeaponState,
  wantsToFire,
} from '../src/core/index.ts';

const ray = {
  origin: { x: 0, y: 1.62, z: 0 },
  direction: { x: 0, y: 0, z: -1 },
};

function zombie(id: `e:${number}`, z: number) {
  return createZombieState(id, { x: 0, y: 0, z }, 1);
}

describe('hitscan weapons', () => {
  it('does not drop short automatic trigger presses between fixed ticks', () => {
    const player = createPlayerState('e:1', { x: 0, y: 0, z: 0 });
    player.weapon = createWeaponState('bar');
    expect(wantsToFire(player, true, false)).toBe(true);
    expect(wantsToFire(player, false, true)).toBe(true);
    expect(wantsToFire(player, false, false)).toBe(false);
  });
  it('uses data-driven starter weapon stats', () => {
    expect(WEAPON_DEFINITIONS['starter-pistol']).toMatchObject({
      damage: 50, range: 60, fireIntervalTicks: 12, trigger: 'semi',
    });
  });

  it('makes ADS ten times steadier than hip-fire with repeatable shot spread', () => {
    const target = zombie('e:2', -50);
    const hip = Array.from({ length: 20 }, (_, seed) =>
      resolveHitscan(spreadHitscanRay(ray, WEAPON_DEFINITIONS.bar.hipSpreadRadians, seed + 1),
        [target], [], 80).kind === 'zombie');
    const aimed = Array.from({ length: 20 }, (_, seed) =>
      resolveHitscan(spreadHitscanRay(ray, WEAPON_DEFINITIONS.bar.hipSpreadRadians * 0.1, seed + 1),
        [target], [], 80).kind === 'zombie');
    expect(aimed.filter(Boolean).length).toBe(20);
    expect(hip.filter(Boolean).length).toBeLessThan(10);
    expect(spreadHitscanRay(ray, 0.035, 42)).toEqual(spreadHitscanRay(ray, 0.035, 42));
    expect(spreadHitscanRay(ray, 0.035, 42)).not.toEqual(spreadHitscanRay(ray, 0.035, 43));
  });

  it('hits the nearest zombie before a farther zombie', () => {
    const near = zombie('e:2', -5);
    const far = zombie('e:3', -10);
    expect(resolveHitscan(ray, [far, near], [], 60)).toMatchObject({
      kind: 'zombie', zombieId: 'e:2',
    });
  });

  it('lets world collision block a zombie', () => {
    const target = zombie('e:2', -8);
    const wall = [{
      min: { x: -2, y: 0, z: -4.5 },
      max: { x: 2, y: 3, z: -4 },
    }];
    expect(resolveHitscan(ray, [target], wall, 60).kind).toBe('world');
  });

  it('does not hit zombies beyond weapon range', () => {
    expect(resolveHitscan(ray, [zombie('e:2', -70)], [], 60).kind).toBe('none');
  });

  it('applies damage exactly once and enforces fire cadence', () => {
    const player = createPlayerState('e:1', { x: 0, y: 0, z: 0 });
    const target = zombie('e:2', -5);
    player.pitch = -0.1; // Body shot: eye-level shots now correctly hit the head.
    const first = firePlayerWeapon(player, rayFromPlayer(player, 1.62), [target], []);
    expect(target.health).toBe(100);
    expect(first.filter((event) => event.type === 'weaponHit')).toHaveLength(1);

    const blockedByCooldown = firePlayerWeapon(player, rayFromPlayer(player, 1.62), [target], []);
    expect(blockedByCooldown).toEqual([]);
    expect(target.health).toBe(100);
  });

  it('starts a reload on the last shot only when reserve ammo remains', () => {
    const player = createPlayerState('e:1', { x: 0, y: 0, z: 0 });
    player.weapon.magazineAmmo = 1;
    const events = firePlayerWeapon(player, ray, [], []);
    expect(events.map((event) => event.type)).toEqual(['weaponFired', 'weaponReloadStarted']);
    expect(player.weapon.reloadTicksRemaining).toBe(WEAPON_DEFINITIONS['starter-pistol'].reloadTicks);

    const dry = createPlayerState('e:2', { x: 0, y: 0, z: 0 });
    dry.weapon.magazineAmmo = 1;
    dry.weapon.reserveAmmo = 0;
    expect(firePlayerWeapon(dry, ray, [], []).map((event) => event.type)).toEqual(['weaponFired']);
    expect(dry.weapon.reloadTicksRemaining).toBe(0);
  });

  it('fires through GameSimulation from authoritative input', () => {
    const simulation = new GameSimulation({
      seed: 99,
      map: { collisionBoxes: [], walkSurfaces: [], zombieSpawns: [] },
      playerSpawns: [{ x: 0, y: 0, z: 0 }],
      roundConfig: { initialWaitTicks: 9999, intermissionTicks: 9999 },
    });
    const playerId = simulation.playerIds[0];
    simulation.getPlayer(playerId)!.pitch = -0.1;
    const target = zombie('e:99', -5);
    addEntity(simulation.state.world, target);
    const frame = createInputFrame(0);
    frame.actions.fire = { held: true, pressed: true, released: false, value: 1 };
    const events = simulation.tick({ [playerId]: frame });
    expect(events.some((event) => event.type === 'weaponHit')).toBe(true);
    expect(target.health).toBe(100);
  });
});
