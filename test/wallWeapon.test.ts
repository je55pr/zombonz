import { describe, expect, it } from 'vitest';
import {
  GameSimulation,
  WEAPON_DEFINITIONS,
  createInputFrame,
  type WallWeaponDefinition,
} from '../src/core/index.ts';

const wall: WallWeaponDefinition = {
  id: 'test-kar98k',
  position: { x: 0, y: 0, z: -1 },
  weaponId: 'kar98k',
  weaponCost: 200,
  ammoCost: 100,
  prompt: 'Press E: Kar98k [200] / Ammo [100]',
};

function simulation(startingPoints = 500) {
  return new GameSimulation({
    seed: 2,
    map: { collisionBoxes: [], walkSurfaces: [], zombieSpawns: [], wallWeapons: [wall] },
    playerSpawns: [{ x: 0, y: 0, z: 0 }],
    economyConfig: { startingPoints, hitReward: 10, killBonus: 50 },
    roundConfig: { initialWaitTicks: 9999, intermissionTicks: 9999 },
  });
}
function interactFrame(sequence = 0) {
  const frame = createInputFrame(sequence);
  frame.actions.interact = { held: true, pressed: true, released: false, value: 1 };
  return frame;
}

describe('wall weapon purchases', () => {
  it('defines the Kar98k-style wall weapon and exposes both prices', () => {
    expect(WEAPON_DEFINITIONS.kar98k).toMatchObject({
      damage: 100, magazineSize: 5, startingReserveAmmo: 50,
    });
    const sim = simulation();
    expect(sim.interactionCandidate(sim.playerIds[0])?.prompt)
      .toBe('Press E: Kar98k [200] / Ammo [100]');
  });

  it('rejects first purchase when funds are insufficient', () => {
    const sim = simulation(100);
    const playerId = sim.playerIds[0];
    const events = sim.tick({ [playerId]: interactFrame() });
    expect(events.some((event) => event.type === 'pointsSpendRejected')).toBe(true);
    expect(sim.getPlayer(playerId)?.weapon.weaponId).toBe('starter-pistol');
    expect(sim.getPlayer(playerId)?.points).toBe(100);
  });
  it('purchases and equips the wall weapon with full starting ammo', () => {
    const sim = simulation(500);
    const playerId = sim.playerIds[0];
    const events = sim.tick({ [playerId]: interactFrame() });
    const player = sim.getPlayer(playerId)!;
    expect(events.some((event) => event.type === 'wallWeaponPurchased')).toBe(true);
    expect(events.some((event) => event.type === 'pointsSpent')).toBe(true);
    expect(player.points).toBe(300);
    expect(player.weapon).toMatchObject({
      weaponId: 'kar98k', magazineAmmo: 5, reserveAmmo: 50,
      reloadTicksRemaining: 0,
    });
  });

  it('defines repeat purchase as an ammo refill at the lower ammo price', () => {
    const sim = simulation(500);
    const playerId = sim.playerIds[0];
    sim.tick({ [playerId]: interactFrame() });
    const player = sim.getPlayer(playerId)!;
    player.weapon.magazineAmmo = 1;
    player.weapon.reserveAmmo = 0;

    const events = sim.tick({ [playerId]: interactFrame(1) });
    expect(events.some((event) => event.type === 'wallWeaponAmmoPurchased')).toBe(true);
    expect(player.points).toBe(200);
    expect(player.weapon).toMatchObject({ weaponId: 'kar98k', magazineAmmo: 1, reserveAmmo: 50 });
  });
});
