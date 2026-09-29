import { describe, expect, it } from 'vitest';
import {
  WEAPON_DEFINITIONS, createPlayerState, createWeaponState, createZombieState, firePlayerWeapon, hitZoneMultiplier,
  rayFromPlayer, zombieHealthForRound, type HitZoneId, type ZombieState,
} from '../src/core/index.ts';

/**
 * WaW `ai_calculate_health` (maps/_zombiemode.gsc): 150 to start, plus 100 a round up to round 9, and from round 10
 * on 10% more than the round before. Written out again here, from the script rather than from the game's own formula.
 */
function wawHealth(round: number): number {
  let health = 150;
  for (let r = 2; r <= round; r++) health = r >= 10 ? health + Math.floor(health * 0.1) : health + 100;
  return health;
}

/** Shots of one weapon, all into the same zone of a fresh zombie, until it dies (a cap stands in for "never"). */
function shotsToKill(weaponId: string, round: number, zone: HitZoneId, cap = 60): number {
  const definition = WEAPON_DEFINITIONS[weaponId];
  const zombie = createZombieState('e:2', { x: 0, y: 0, z: -4 }, round);
  // A gun that shoots through bodies still meets this one first; no one stands behind it.
  const perShot = definition.damage * (definition.pellets ?? 1) * hitZoneMultiplier(definition, zone);
  let shots = 0;
  while (zombie.health > 0 && shots < cap) { zombie.health -= Math.min(zombie.health, Math.round(perShot)); shots++; }
  return zombie.alive && zombie.health > 0 ? Infinity : shots;
}

describe('zombie health by round', () => {
  it('matches the World at War script for every round through 30', () => {
    for (let round = 1; round <= 30; round++) expect(zombieHealthForRound(round), `round ${round}`).toBe(wawHealth(round));
  });
});

describe('the starting pistol', () => {
  it('kills a round-1 zombie in three body shots or two headshots, never one', () => {
    expect(shotsToKill('starter-pistol', 1, 'body')).toBe(3);
    expect(shotsToKill('starter-pistol', 1, 'head')).toBe(2);
  });

  it('takes more shots each round it is used, and loses its edge by round five', () => {
    expect([1, 2, 3, 4, 5].map(round => shotsToKill('starter-pistol', round, 'body'))).toEqual([3, 5, 7, 9, 11]);
    expect([1, 2, 3, 4, 5].map(round => shotsToKill('starter-pistol', round, 'head'))).toEqual([2, 3, 4, 5, 6]);
  });

  it('is beaten by the wall guns, so buying one is worth it', () => {
    for (const other of ['thompson', 'mp40', 'm1-garand', 'kar98k']) {
      expect(shotsToKill(other, 3, 'body'), other).toBeLessThan(shotsToKill('starter-pistol', 3, 'body'));
    }
  });
});

describe('early-round lethality of each class of gun', () => {
  const table: Array<[string, number, HitZoneId, number]> = [
    // Sub-machine guns need two or three body shots on round 1; only the MP40 (75, so exactly 150 to the head) one-shots it.
    ['thompson', 1, 'body', 3], ['thompson', 1, 'head', 2],
    ['mp40', 1, 'body', 2], ['mp40', 1, 'head', 1], ['mp40', 3, 'head', 3],
    ['ppsh41', 1, 'body', 3], ['ppsh41', 1, 'head', 2],
    ['stg44', 1, 'body', 2], ['stg44', 1, 'head', 1], ['stg44', 2, 'head', 2],
    // Semi-automatic rifles take one headshot at first and two body shots.
    ['m1-garand', 1, 'body', 2], ['m1-garand', 1, 'head', 1], ['m1-garand', 3, 'head', 2],
    // The bolt-action rifles: one headshot through round three, but not round four (the WaW behaviour).
    ['kar98k', 1, 'body', 2], ['kar98k', 3, 'head', 1], ['kar98k', 4, 'head', 2],
    // Revolvers hit hard and slowly.
    ['magnum-357', 1, 'body', 1], ['magnum-357', 4, 'head', 1], ['magnum-357', 5, 'head', 2],
    // Shotguns count their pellets: a whole load kills, and the head bonus is small.
    ['double-barrel', 1, 'body', 1], ['trench-gun', 2, 'body', 1],
  ];
  it.each(table)('%s on round %i, %s shots: %i to kill', (weapon, round, zone, expected) => {
    expect(shotsToKill(weapon, round, zone)).toBe(expected);
  });

  it('keeps every class distinct: explosives and wonder weapons out-damage rifles, which out-damage pistols', () => {
    const damage = (id: string) => WEAPON_DEFINITIONS[id].damage;
    expect(damage('starter-pistol')).toBeLessThan(damage('kar98k'));
    expect(damage('kar98k')).toBeLessThan(damage('magnum-357'));
    expect(damage('magnum-357')).toBeLessThan(damage('irrlicht'));
    expect(damage('irrlicht')).toBeLessThan(damage('rpg7'));
  });
});

describe('the table in docs/combat.md', () => {
  // [gun, then body/head shots to kill on rounds 1, 2, 3 and 5]
  const rows: Array<[string, Array<[number, number]>]> = [
    ['starter-pistol', [[3, 2], [5, 3], [7, 4], [11, 6]]],
    ['thompson', [[3, 2], [4, 2], [6, 3], [9, 5]]],
    ['mp40', [[2, 1], [4, 2], [5, 3], [8, 4]]],
    ['m1-garand', [[2, 1], [3, 2], [4, 2], [6, 3]]],
    ['kar98k', [[2, 1], [3, 1], [4, 1], [6, 2]]],
    ['magnum-357', [[1, 1], [2, 1], [2, 1], [3, 2]]],
  ];
  it.each(rows)('%s', (weapon, expected) => {
    const actual = [1, 2, 3, 5].map(round => [shotsToKill(weapon, round, 'body'), shotsToKill(weapon, round, 'head')]);
    expect(actual).toEqual(expected);
  });
});

describe('a real shot', () => {
  function shoot(weaponId: string, round: number, aimHeight: number): ZombieState {
    const player = createPlayerState('e:1', { x: 0, y: 0, z: 0 });
    player.weapon = createWeaponState(weaponId);
    player.aiming = true;
    const zombie = createZombieState('e:2', { x: 0, y: 0, z: -3 }, round);
    const ray = rayFromPlayer(player, aimHeight);
    // Point the shot at the middle of the zombie's head or chest from wherever the eye is.
    const to = { x: 0, y: 1.45, z: -3 };
    const from = ray.origin;
    const length = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
    firePlayerWeapon(player, { origin: from, direction: { x: (to.x - from.x) / length, y: (to.y - from.y) / length, z: (to.z - from.z) / length } },
      [zombie], []);
    return zombie;
  }

  it('does not kill a round-1 zombie with one pistol headshot', () => {
    const zombie = shoot('starter-pistol', 1, 1.62);
    expect(zombie.alive).toBe(true);
    expect(zombie.health).toBe(50);
  });
});
