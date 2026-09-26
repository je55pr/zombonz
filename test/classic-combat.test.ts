import { describe, expect, it } from 'vitest';
import { GameSimulation, addEntity, createInputFrame, createPlayerState, createZombieState,
  damagePlayer, tickPlayerRecovery, PLAYER_HEALTH, firePlayerWeapon, rayFromPlayer,
  meleeAttack, awardCombatPoints, awardRepairPoints, zombieHealthForRound } from '../src/core/index.ts';

const origin = { x: 0, y: 0, z: 0 };
const wall = [{ min: { x: -2, y: 0, z: -0.7 }, max: { x: 2, y: 3, z: -0.5 } }];

describe('classic survival health', () => {
  it('waits five damage-free seconds, then recovers without exceeding max health', () => {
    const player = createPlayerState('e:1', origin);
    damagePlayer(player, 50);
    for (let i = 0; i < PLAYER_HEALTH.recoveryDelayTicks; i++) expect(tickPlayerRecovery(player)).toEqual([]);
    expect(player.health).toBe(50);
    expect(tickPlayerRecovery(player)).toMatchObject([{ type: 'playerHealed', amount: 2, health: 52 }]);
    for (let i = 0; i < 100; i++) tickPlayerRecovery(player);
    expect(player.health).toBe(100);
  });
  it('resets recovery on another hit and never revives a dead player', () => {
    const player = createPlayerState('e:1', origin);
    damagePlayer(player, 20);
    for (let i = 0; i < 290; i++) tickPlayerRecovery(player);
    damagePlayer(player, 20);
    expect(player.recoveryDelayTicks).toBe(300);
    damagePlayer(player, 100);
    for (let i = 0; i < 500; i++) tickPlayerRecovery(player);
    expect(player.health).toBe(0); expect(player.alive).toBe(false);
  });
  it('ramps zombie health through round nine then scales exponentially', () => {
    expect([1, 2, 3, 9, 10, 11].map(zombieHealthForRound)).toEqual([150, 250, 350, 950, 1045, 1150]);
    expect(createZombieState('e:2', origin, 10).health).toBe(1045);
    expect(zombieHealthForRound(10000)).toBe(1_000_000_000);
  });
});

describe('headshots and knife', () => {
  it('classifies body and head impacts and rewards headshot kills once', () => {
    const player = createPlayerState('e:1', origin);
    const target = createZombieState('e:2', { x: 0, y: 0, z: -4 }, 1);
    const events = firePlayerWeapon(player, rayFromPlayer(player, 1.62), [target], []);
    expect(events).toContainEqual(expect.objectContaining({ type: 'weaponHit', hitZone: 'head', damage: 150 }));
    awardCombatPoints(player, events);
    expect(player.points).toBe(600);
    expect(target.alive).toBe(false);
    expect(firePlayerWeapon(player, rayFromPlayer(player, 1.62), [target], [])).toEqual([]);
    const body = createZombieState('e:3', { x: 0, y: 0, z: -4 }, 1);
    player.weapon.cooldownTicks = 0;
    const bodyEvents = firePlayerWeapon(player, { origin: { x: 0, y: 1, z: 0 }, direction: { x: 0, y: 0, z: -1 } }, [body], []);
    expect(body.health).toBe(100);
    expect(bodyEvents).toContainEqual(expect.objectContaining({ type: 'weaponHit', hitZone: 'body' }));
  });
  it('knifes one nearest facing target, cancels reload and respects cooldown', () => {
    const player = createPlayerState('e:1', origin);
    player.weapon.reloadTicksRemaining = 30;
    const near = createZombieState('e:2', { x: 0, y: 0, z: -1 }, 1);
    const far = createZombieState('e:3', { x: 0, y: 0, z: -1.4 }, 1);
    const events = meleeAttack(player, [far, near], []);
    awardCombatPoints(player, events);
    expect(near.alive).toBe(false); expect(far.alive).toBe(true);
    expect(player.points).toBe(630); expect(player.weapon.reloadTicksRemaining).toBe(0);
    expect(meleeAttack(player, [far], [])).toEqual([]);
  });
  it('cannot knife through a wall, behind the player, upstairs or beyond reach', () => {
    const positions = [{ x: 0, y: 0, z: -1 }, { x: 0, y: 0, z: 1 },
      { x: 0, y: 3.4, z: -1 }, { x: 0, y: 0, z: -2 }];
    positions.forEach((position, i) => {
      const player = createPlayerState('e:1', origin), target = createZombieState('e:2', position, 1);
      expect(meleeAttack(player, [target], i === 0 ? wall : [])).toEqual([{ type: 'meleeSwung', playerId: player.id }]);
      expect(target.health).toBe(150);
    });
  });
  it('does not award one player another player’s hit events', () => {
    const player = createPlayerState('e:1', origin);
    expect(awardCombatPoints(player, [{ type: 'zombieDied', playerId: 'e:2', zombieId: 'e:3', method: 'melee' }])).toEqual([]);
    expect(player.points).toBe(500);
  });
});

describe('repair economy and deterministic integration', () => {
  it('caps repair rewards per player per round, with a new allowance next round', () => {
    const player = createPlayerState('e:1', origin), other = createPlayerState('e:2', origin);
    for (let i = 0; i < 20; i++) awardRepairPoints(player, 1);
    expect(player.points).toBe(540);
    expect(awardRepairPoints(player, 1)).toEqual([]);
    awardRepairPoints(other, 1); expect(other.points).toBe(510);
    awardRepairPoints(player, 2); expect(player.points).toBe(550);
    expect(player.repairPointsEarned).toBe(10);
  });
  it('replays mixed combat and recovery exactly and clears state on restart', () => {
    const run = () => {
      const sim = new GameSimulation({ seed: 45, map: { collisionBoxes: [], walkSurfaces: [], zombieSpawns: [] },
        playerSpawns: [origin], roundConfig: { initialWaitTicks: 9999, intermissionTicks: 9999 } });
      const player = sim.getPlayer(sim.playerIds[0])!;
      addEntity(sim.state.world, createZombieState('e:99', { x: 0, y: 0, z: -1.2 }, 1));
      damagePlayer(player, 50);
      const frame = createInputFrame(0); frame.actions.melee = { held: true, pressed: true, released: false, value: 1 };
      const events = [sim.tick({ [player.id]: frame })];
      for (let i = 0; i < 400; i++) events.push(sim.tick());
      expect(player.health).toBe(100); expect(player.points).toBe(630);
      expect(player.meleeCooldownTicks).toBe(0);
      return { sim, events };
    };
    const a = run(), b = run();
    expect(a.sim.state).toEqual(b.sim.state); expect(a.events).toEqual(b.events);
    expect(JSON.parse(JSON.stringify(a.sim.state))).toEqual(a.sim.state);
    a.sim.restart(45);
    expect(a.sim.getPlayer(a.sim.playerIds[0])).toMatchObject({ health: 100, recoveryDelayTicks: 0, meleeCooldownTicks: 0, repairPointsEarned: 0 });
  });
  it('reclaims dead zombie state after the visual death interval', () => {
    const sim = new GameSimulation({ seed: 42,
      map: { collisionBoxes: [], walkSurfaces: [], zombieSpawns: [] }, playerSpawns: [origin],
      roundConfig: { initialWaitTicks: 9999, intermissionTicks: 9999 } });
    const corpse = createZombieState('e:99', { x: 0, y: 0, z: -1 }, 1);
    corpse.alive = false; addEntity(sim.state.world, corpse);
    for (let i = 0; i < 299; i++) sim.tick();
    expect(sim.state.world.entities['e:99']).toBe(corpse);
    sim.tick();
    expect(sim.state.world.entities['e:99']).toBeUndefined();
  });
});
