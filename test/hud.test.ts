import { describe, expect, it } from 'vitest';
import { buildHudSnapshot } from '../src/client/hud.ts';
import {
  GameSimulation,
  type WallWeaponDefinition,
} from '../src/core/index.ts';

const wall: WallWeaponDefinition = {
  id: 'hud-wall',
  position: { x: 0, y: 0, z: -1 },
  weaponId: 'kar98k',
  weaponCost: 200,
  ammoCost: 100,
  prompt: 'Press E: Kar98k [200] / Ammo [100]',
};

function simulation() {
  return new GameSimulation({
    seed: 3,
    map: { collisionBoxes: [], walkSurfaces: [], zombieSpawns: [], wallWeapons: [wall] },
    playerSpawns: [{ x: 0, y: 0, z: 0 }],
    roundConfig: { initialWaitTicks: 9999, intermissionTicks: 9999 },
  });
}
describe('gameplay HUD snapshot', () => {
  it('contains every required authoritative gameplay value', () => {
    const sim = simulation();
    const playerId = sim.playerIds[0];
    expect(buildHudSnapshot(sim, playerId)).toEqual({
      health: 100,
      points: 500,
      round: 1,
      weapon: 'starter-pistol',
      magazineAmmo: 8,
      reserveAmmo: 32,
      holsteredWeapon: null,
      reloadTicksRemaining: 0,
      grenadeCharges: 2,
      roundPhase: 'waiting',
      interactionPrompt: 'Press E: Kar98k [200] / Ammo [100]',
      nearbyPowerup: null,
      bonusStatus: null,
      instaKillStatus: null,
      gameOver: false,
      paused: false,
      godMode: false,
      noclip: false,
      sprinting: false,
      aiming: false,
    });
  });

  it('reads current state directly rather than caching stale values', () => {
    const sim = simulation();
    const playerId = sim.playerIds[0];
    const player = sim.getPlayer(playerId)!;
    player.health = 65;
    player.points = 730;
    player.weapon.magazineAmmo = 3;
    player.weapon.reserveAmmo = 17;
    sim.state.round.round = 4;
    expect(buildHudSnapshot(sim, playerId)).toMatchObject({
      health: 65,
      points: 730,
      round: 4,
      magazineAmmo: 3,
      reserveAmmo: 17,
    });
  });

  it('surfaces game over state for the canvas overlay', () => {
    const sim = simulation();
    const playerId = sim.playerIds[0];
    sim.state.round.phase = 'gameOver';
    expect(buildHudSnapshot(sim, playerId)?.gameOver).toBe(true);
  });

  it('drops the interaction prompt when the player is no longer facing the target', () => {
    const sim = simulation();
    const playerId = sim.playerIds[0];
    sim.getPlayer(playerId)!.yaw = Math.PI;
    expect(buildHudSnapshot(sim, playerId)?.interactionPrompt).toBeNull();
  });

  it('shows nearby drops and updates Double Points at one-second resolution', () => {
    const sim = simulation(), playerId = sim.playerIds[0];
    sim.state.powerups.drops.push({ id: 'p:1', kind: 'doublePoints',
      position: { x: 0, y: 0, z: -3 }, ticksRemaining: 900 });
    sim.state.powerups.doublePointsTicksRemaining = 1799;
    expect(buildHudSnapshot(sim, playerId)).toMatchObject({
      nearbyPowerup: 'DOUBLE POINTS', bonusStatus: '2X POINTS  30s',
    });
    sim.state.powerups.doublePointsTicksRemaining = 1740;
    expect(buildHudSnapshot(sim, playerId)?.bonusStatus).toBe('2X POINTS  29s');
    sim.state.powerups.drops = [];
    expect(buildHudSnapshot(sim, playerId)?.nearbyPowerup).toBeNull();
  });
});
