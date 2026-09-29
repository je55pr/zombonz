import { describe, expect, it } from 'vitest';
import {
  BARRIER_RULES, GameSimulation, WINDOW_ATTACK, ZOMBIE_MOVEMENT, awardRepairPoints, createBarrier,
  createPlayerState, createZombieEntry, createZombieState, tickWindowAttack,
} from '../src/core/index.ts';
import { BUNKER_BARRIERS, BUNKER_WINDOW_BOARDS } from '../src/maps/bunkerLegacy.ts';

const definition = BUNKER_BARRIERS[0];

function inward(distance: number) {
  return { x: definition.position.x - definition.outward.x * distance, y: definition.position.y,
    z: definition.position.z - definition.outward.z * distance };
}

function zombieAtWindow(id: `e:${number}` = 'e:2') {
  const zombie = createZombieState(id, definition.approachPath.at(-1)!, 1);
  zombie.entry = createZombieEntry(definition.id, 0);
  zombie.entry.phase = 'breaking';
  return zombie;
}

describe('window attacks', () => {
  it('uses six boards per Bunker window', () => {
    expect(BUNKER_BARRIERS.every(barrier => barrier.maxBoards === BUNKER_WINDOW_BOARDS)).toBe(true);
    expect(BUNKER_WINDOW_BOARDS).toBe(6);
  });

  it('cannot reach through a fully boarded window', () => {
    const barrier = createBarrier(definition, 'e:10').state;
    const player = createPlayerState('e:1', inward(0.9));
    expect(tickWindowAttack(zombieAtWindow(), barrier, [player])).toEqual({ engaged: false, events: [] });
    expect(player.health).toBe(100);
  });

  it('swipes a player at the window once a board is gone, then waits for its cooldown', () => {
    const barrier = createBarrier(definition, 'e:10').state;
    barrier.boards = BUNKER_WINDOW_BOARDS - 1;
    const player = createPlayerState('e:1', inward(0.9));
    const zombie = zombieAtWindow();
    const first = tickWindowAttack(zombie, barrier, [player]);
    expect(first.engaged).toBe(true);
    expect(first.events.map(event => event.type)).toEqual(['zombieAttacked', 'playerDamaged']);
    expect(player.health).toBe(100 - ZOMBIE_MOVEMENT.attackDamage);
    for (let i = 0; i < ZOMBIE_MOVEMENT.attackCooldownTicks - 1; i++) {
      expect(tickWindowAttack(zombie, barrier, [player])).toEqual({ engaged: true, events: [] });
    }
    expect(tickWindowAttack(zombie, barrier, [player]).events.map(event => event.type))
      .toEqual(['zombieAttacked', 'playerDamaged', 'playerDowned']);
  });

  it('leaves players out of reach, outside, or on another floor alone', () => {
    const barrier = createBarrier(definition, 'e:10').state;
    barrier.boards = 0;
    const back = createPlayerState('e:1', inward(WINDOW_ATTACK.reach + 0.2));
    const outside = createPlayerState('e:3', inward(-0.9));
    const above = createPlayerState('e:4', { ...inward(0.9), y: 3.4 });
    expect(tickWindowAttack(zombieAtWindow(), barrier, [back, outside, above])).toEqual({ engaged: false, events: [] });
  });

  it('pauses tearing while swiping, so repairing up close is risky but not free', () => {
    const sim = new GameSimulation({ seed: 7,
      map: { collisionBoxes: [], walkSurfaces: [], zombieSpawns: [], barriers: [definition] },
      playerSpawns: [inward(0.9)], roundConfig: { initialWaitTicks: 99999, intermissionTicks: 1 } });
    const player = sim.getPlayer(sim.playerIds[0])!;
    player.health = 100000;
    const barrier = sim.state.barriers[0];
    barrier.boards = BUNKER_WINDOW_BOARDS - 1;
    const zombie = zombieAtWindow('e:50');
    sim.state.world.entities[zombie.id] = zombie;
    for (let i = 0; i < BARRIER_RULES.tearTicks * 3; i++) sim.tick();
    expect(barrier.boards).toBe(BUNKER_WINDOW_BOARDS - 1);
    expect(player.health).toBeLessThan(100000);

    player.position = inward(WINDOW_ATTACK.reach + 1);
    for (let i = 0; i < BARRIER_RULES.tearTicks + 1; i++) sim.tick();
    expect(barrier.boards).toBe(BUNKER_WINDOW_BOARDS - 2);
  });
});

describe('repair rewards', () => {
  it('follow the economy config', () => {
    const player = createPlayerState('e:1', { x: 0, y: 0, z: 0 }, 0);
    const config = { startingPoints: 0, hitReward: 10, killBonus: 50,
      repairReward: 25, repairCapPerRound: 50, repairCapMax: 60 };
    expect(awardRepairPoints(player, 1, 1, config)).toMatchObject([{ amount: 25 }]);
    expect(awardRepairPoints(player, 1, 1, config)).toMatchObject([{ amount: 25 }]);
    expect(awardRepairPoints(player, 1, 1, config)).toEqual([]);
    player.repairRewardRound = 0;
    for (let i = 0; i < 3; i++) awardRepairPoints(player, 9, 1, config);
    expect(player.repairPointsEarned).toBe(60);
  });
});
