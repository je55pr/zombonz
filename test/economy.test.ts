import { describe, expect, it } from 'vitest';
import {
  GameSimulation,
  addEntity,
  awardCombatPoints,
  createInputFrame,
  createPlayerState,
  createZombieState,
  spendPoints,
  type WeaponEvent,
} from '../src/core/index.ts';

const customEconomy = { startingPoints: 750, hitReward: 7, killBonus: 31 };

describe('points economy', () => {
  it('uses configured starting points for simulation players', () => {
    const simulation = new GameSimulation({
      seed: 1,
      map: { collisionBoxes: [], walkSurfaces: [], zombieSpawns: [] },
      playerSpawns: [{ x: 0, y: 0, z: 0 }],
      economyConfig: customEconomy,
    });
    expect(simulation.getPlayer(simulation.playerIds[0])?.points).toBe(750);
  });

  it('awards deterministic configurable hit and kill rewards', () => {
    const player = createPlayerState('e:1', { x: 0, y: 0, z: 0 }, 100);
    const weaponEvents: WeaponEvent[] = [
      { type: 'weaponHit', playerId: player.id, weaponId: 'starter-pistol', zombieId: 'e:2', damage: 50, distance: 4 },
      { type: 'zombieDied', zombieId: 'e:2', playerId: player.id },
    ];
    const events = awardCombatPoints(player, weaponEvents, customEconomy);
    expect(events.map((event) => [event.reason, event.amount])).toEqual([
      ['hit', 7], ['kill', 31],
    ]);
    expect(player.points).toBe(138);
  });

  it('spends points and rejects an unaffordable purchase without mutation', () => {
    const player = createPlayerState('e:1', { x: 0, y: 0, z: 0 }, 500);
    expect(spendPoints(player, 300, 'door')).toMatchObject({ type: 'pointsSpent', balance: 200 });
    expect(spendPoints(player, 250, 'wall-weapon')).toMatchObject({ type: 'pointsSpendRejected', balance: 200 });
    expect(player.points).toBe(200);
  });

  it('emits combat economy events from the authoritative simulation tick', () => {
    const simulation = new GameSimulation({
      seed: 2,
      map: { collisionBoxes: [], walkSurfaces: [], zombieSpawns: [] },
      playerSpawns: [{ x: 0, y: 0, z: 0 }],
      roundConfig: { initialWaitTicks: 9999, intermissionTicks: 9999 },
    });
    const playerId = simulation.playerIds[0];
    simulation.getPlayer(playerId)!.pitch = -0.1;
    const target = createZombieState('e:99', { x: 0, y: 0, z: -5 }, 1);
    target.health = 50;
    addEntity(simulation.state.world, target);
    const frame = createInputFrame(0);
    frame.actions.fire = { held: true, pressed: true, released: false, value: 1 };
    const events = simulation.tick({ [playerId]: frame });
    expect(events.filter((event) => event.type === 'pointsAwarded')).toMatchObject([
      { type: 'pointsAwarded', amount: 10, reason: 'hit', balance: 510 },
      { type: 'pointsAwarded', amount: 50, reason: 'kill', balance: 560 },
    ]);
    expect(simulation.getPlayer(playerId)?.points).toBe(560);
  });
});
