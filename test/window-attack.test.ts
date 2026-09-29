import { describe, expect, it } from 'vitest';
import {
  BARRIER_RULES, GameSimulation, LIMB, WINDOW_ATTACK, ZOMBIE_MELEE, awardRepairPoints, createBarrier,
  createPlayerState, createZombieEntry, createZombieState, swingTiming, tickPlayerRecovery, tickWindowAttack,
  type SimulationEvent,
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

  /** Ticks the window swipe until `stop` says so, passing back each tick's events. */
  function swipeFor(zombie: ReturnType<typeof zombieAtWindow>, barrier: ReturnType<typeof createBarrier>['state'],
    players: ReturnType<typeof createPlayerState>[], ticks: number) {
    const log: Array<{ tick: number; type: string }> = [];
    for (let tick = 1; tick <= ticks; tick++) {
      for (const player of players) tickPlayerRecovery(player);
      for (const event of tickWindowAttack(zombie, barrier, players).events) log.push({ tick, type: event.type });
    }
    return log;
  }

  it('swipes a player at the window once a board is gone: a wind-up, one blow, a recovery, and then again', () => {
    const barrier = createBarrier(definition, 'e:10').state;
    barrier.boards = BUNKER_WINDOW_BOARDS - 1;
    const player = createPlayerState('e:1', inward(0.7));
    player.health = 1000;
    const zombie = zombieAtWindow();
    const first = tickWindowAttack(zombie, barrier, [player]);
    expect(first.engaged).toBe(true);
    expect(first.events.map(event => event.type)).toEqual(['zombieSwung']);
    expect(player.health).toBe(1000);
    const { windupTicks, totalTicks } = swingTiming(zombie);
    const log = swipeFor(zombie, barrier, [player], totalTicks * 2 + 20);
    const blows = log.filter(event => event.type === 'zombieAttacked');
    // The wind-up is a visible pause: the blow lands only after it, not on the first tick in reach.
    expect(blows[0].tick).toBe(windupTicks);
    expect(player.health).toBe(1000 - ZOMBIE_MELEE.damage * blows.length);
    // And the next one is a whole swing later, not the very next tick.
    expect(blows.length).toBeGreaterThanOrEqual(2);
    expect(blows[1].tick - blows[0].tick).toBeGreaterThanOrEqual(totalTicks);
    expect(blows[1].tick - blows[0].tick).toBeLessThanOrEqual(totalTicks + ZOMBIE_MELEE.gapTicks + 2);
    expect(log.filter(event => event.type === 'zombieSwung')).toHaveLength(blows.length);
  });

  it('swipes at arm’s length through the opening, not across the room and not from beside the window', () => {
    const barrier = createBarrier(definition, 'e:10').state;
    barrier.boards = 0;
    const at = (inside: number, along: number) => {
      const spot = inward(inside);
      return createPlayerState('e:1', { x: spot.x + definition.outward.z * along, y: spot.y, z: spot.z - definition.outward.x * along });
    };
    const swings = (player: ReturnType<typeof createPlayerState>) => tickWindowAttack(zombieAtWindow(), barrier, [player]).engaged;
    expect(swings(at(0.5, 0))).toBe(true);
    expect(swings(at(WINDOW_ATTACK.reach - 0.05, 0))).toBe(true);
    expect(swings(at(WINDOW_ATTACK.reach + 0.1, 0))).toBe(false);
    // Standing against the wall well to one side of the opening, a zombie in it cannot reach.
    expect(swings(at(0.5, definition.width / 2 + WINDOW_ATTACK.sideMargin - 0.05))).toBe(true);
    expect(swings(at(0.5, definition.width / 2 + WINDOW_ATTACK.sideMargin + 0.2))).toBe(false);
  });

  it('cannot swipe from a crawler’s arms, and a swing is dropped if the window is boarded up again first', () => {
    const barrier = createBarrier(definition, 'e:10').state;
    barrier.boards = 3;
    const crawler = zombieAtWindow('e:3');
    crawler.limbs = LIMB.legL;
    expect(tickWindowAttack(crawler, barrier, [createPlayerState('e:1', inward(0.6))])).toEqual({ engaged: false, events: [] });
    const player = createPlayerState('e:1', inward(0.6));
    const zombie = zombieAtWindow();
    expect(tickWindowAttack(zombie, barrier, [player]).events.map(event => event.type)).toEqual(['zombieSwung']);
    barrier.boards = barrier.maxBoards;
    expect(tickWindowAttack(zombie, barrier, [player])).toEqual({ engaged: false, events: [] });
    expect(zombie.attackTicks).toBe(0);
    expect(player.health).toBe(100);
  });

  it('lands two zombies’ blows one after the other, not together', () => {
    const barrier = createBarrier(definition, 'e:10').state;
    barrier.boards = 0;
    const player = createPlayerState('e:1', inward(0.7));
    player.health = 1000;
    const one = zombieAtWindow('e:2'), two = zombieAtWindow('e:3');
    const log: Array<{ tick: number; who: string }> = [];
    for (let tick = 1; tick <= 400; tick++) {
      tickPlayerRecovery(player);
      for (const zombie of [one, two]) {
        for (const event of tickWindowAttack(zombie, barrier, [player]).events) if (event.type === 'zombieAttacked') log.push({ tick, who: zombie.id });
      }
    }
    expect(log.length).toBeGreaterThan(3);
    for (let i = 1; i < log.length; i++) {
      expect(log[i].tick - log[i - 1].tick, `blow ${i}`).toBeGreaterThanOrEqual(ZOMBIE_MELEE.hurtGraceTicks);
    }
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

    // Out of reach, it finishes the swing it began, and then goes back to the boards.
    player.position = inward(WINDOW_ATTACK.reach + 1);
    for (let guard = 0; zombie.attackTicks > 0 && guard < 500; guard++) sim.tick();
    expect(zombie.attackTicks).toBe(0);
    expect(barrier.boards).toBe(BUNKER_WINDOW_BOARDS - 1);
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
