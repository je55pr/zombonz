import { describe, expect, it } from 'vitest';
import { createPlayerState, createWeaponState, currentSpread, firePlayerWeapon, tickWeaponState,
  PLAYER_MOVEMENT, SPREAD_RULES, WEAPON_DEFINITIONS } from '../src/core/index.ts';

const ray = { origin: { x: 0, y: 1.6, z: 0 }, direction: { x: 0, y: 0, z: -1 } };

describe('WaW-style dynamic spread', () => {
  it('opens up while moving and sprinting, and tightens when aiming', () => {
    const player = createPlayerState('e:1', { x: 0, y: 0, z: 0 });
    const base = WEAPON_DEFINITIONS['starter-pistol'].hipSpreadRadians;
    expect(currentSpread(player)).toBeCloseTo(base);
    player.velocity = { x: PLAYER_MOVEMENT.maxSpeed, y: 0, z: 0 };
    expect(currentSpread(player)).toBeCloseTo(base * (1 + SPREAD_RULES.movingExtra));
    player.sprinting = true;
    expect(currentSpread(player)).toBeCloseTo(base * (1 + SPREAD_RULES.sprintExtra));
    player.sprinting = false; player.velocity = { x: 0, y: 0, z: 0 }; player.aiming = true;
    expect(currentSpread(player)).toBeCloseTo(base * 0.1);
  });

  it('blooms with sustained fire up to a cap, then settles back', () => {
    const player = createPlayerState('e:1', { x: 0, y: 0, z: 0 });
    player.weapon = createWeaponState('mp40');
    const base = WEAPON_DEFINITIONS.mp40.hipSpreadRadians;
    for (let shot = 0; shot < 12; shot++) {
      player.weapon.cooldownTicks = 0;
      firePlayerWeapon(player, ray, [], []);
    }
    expect(player.spreadBloom).toBe(SPREAD_RULES.maxBloom);
    expect(currentSpread(player)).toBeCloseTo(base * (1 + SPREAD_RULES.maxBloom));
    for (let tick = 0; tick < 60; tick++) tickWeaponState(player);
    expect(player.spreadBloom).toBe(0);
    expect(currentSpread(player)).toBeCloseTo(base);
  });
});
