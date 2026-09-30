import { describe, expect, it } from 'vitest';
import {
  GameSimulation, ZOMBIE_MELEE, ZOMBIE_MOVEMENT, addEntity, createPlayerState, createZombieState, inMeleeReach, separateZombies,
  swingTiming, tickPlayerRecovery, tickZombieMelee, type CollisionBox, type EntityId, type SimulationEvent, type ZombieGait, type ZombieState,
} from '../src/core/index.ts';
import { BUNKER_BARRIERS, BUNKER_PLAYER_SPAWN, BUNKER_WALK_SURFACES, greyboxCollisionBoxes } from '../src/maps/bunkerLegacy.ts';

const QUIET = { initialWaitTicks: 999999, intermissionTicks: 999999 };
const facing = (from: { x: number; z: number }, to: { x: number; z: number }) => Math.atan2(to.x - from.x, to.z - from.z);

/** A player alone at the origin with `count` zombies of one gait standing round them at `radius`, all facing them. */
function ring(count: number, gait: ZombieGait, radius = 0.95, boxes: CollisionBox[] = []) {
  const sim = new GameSimulation({ seed: 5, playerSpawns: [{ x: 0, y: 0, z: 0 }], roundConfig: QUIET,
    map: { collisionBoxes: boxes, walkSurfaces: [], zombieSpawns: [] } });
  const player = sim.players()[0];
  const zombies: ZombieState[] = [];
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + 0.3;
    const zombie = createZombieState(`e:${20 + i}` as EntityId, { x: Math.sin(angle) * radius, y: 0, z: Math.cos(angle) * radius }, 1, gait);
    zombie.yaw = facing(zombie.position, player.position);
    addEntity(sim.state.world, zombie); zombies.push(zombie);
  }
  return { sim, player, zombies };
}

/** Runs until the player goes down (or the cap), noting when each blow landed. */
function untilDown(count: number, gait: ZombieGait, cap = 1200) {
  const { sim, player } = ring(count, gait);
  const blows: number[] = [];
  let downedAt = -1;
  for (let tick = 1; tick <= cap && downedAt < 0; tick++) {
    const events = sim.tick();
    for (const event of events) {
      if (event.type === 'zombieAttacked') blows.push(tick);
      if (event.type === 'playerDowned') downedAt = tick;
    }
  }
  return { blows, downedAt, player };
}

describe('a zombie’s melee cadence', () => {
  it('does not hit on the first tick in reach: the blow goes live a tenth of the way through the swing, and the next swing is a whole swing later', () => {
    const { sim, zombies } = ring(1, 'walk');
    const [zombie] = zombies, timing = swingTiming(zombie);
    const log: Array<[number, SimulationEvent['type']]> = [];
    for (let tick = 1; tick <= timing.totalTicks * 3; tick++) {
      for (const event of sim.tick()) if (event.type === 'zombieSwung' || event.type === 'zombieAttacked') log.push([tick, event.type]);
    }
    expect(log[0]).toEqual([1, 'zombieSwung']);
    // The blow lands `blowTicks` after the swing began (the arm is drawn coming down later, at `windupTicks`).
    expect(log[1]).toEqual([1 + timing.blowTicks, 'zombieAttacked']);
    const blows = log.filter(([, type]) => type === 'zombieAttacked');
    // The player is not hit again while down, so only one full cycle shows in the blows: check the swings instead.
    const swings = log.filter(([, type]) => type === 'zombieSwung');
    expect(swings.length).toBeGreaterThanOrEqual(2);
    expect(swings[1][0] - swings[0][0]).toBeGreaterThanOrEqual(timing.totalTicks);
    expect(swings[1][0] - swings[0][0]).toBeLessThanOrEqual(timing.totalTicks + ZOMBIE_MELEE.gapTicks + 1);
    expect(blows.length).toBeGreaterThanOrEqual(1);
  });

  it('is quicker for a runner and quicker again for a sprinter, and every zombie has a tempo of its own', () => {
    const wind = (gait: ZombieGait, id: EntityId = 'e:2') => swingTiming({ id, gait }).windupTicks;
    expect(wind('sprint')).toBeLessThan(wind('run'));
    expect(wind('run')).toBeLessThan(wind('walk'));
    const tempos = new Set(Array.from({ length: 30 }, (_, i) => swingTiming({ id: `e:${i + 2}` as EntityId, gait: 'walk' }).windupTicks));
    expect(tempos.size).toBeGreaterThan(5);
    for (const tempo of tempos) {
      expect(tempo).toBeGreaterThanOrEqual(ZOMBIE_MELEE.swing.walk.windupTicks);
      expect(tempo).toBeLessThanOrEqual(ZOMBIE_MELEE.swing.walk.windupTicks + ZOMBIE_MELEE.windupJitterTicks);
    }
  });

  it('takes a lone walker a couple of seconds to put a player down, and two blows to do it', () => {
    const { blows, downedAt } = untilDown(1, 'walk');
    expect(blows).toHaveLength(2);
    expect(downedAt).toBeGreaterThan(120);
    expect(downedAt).toBeLessThan(260);
  });

  it('does not put a player down at once when two zombies arrive together: blows come one at a time', () => {
    for (const gait of ['walk', 'run', 'sprint'] as const) {
      const { blows, downedAt } = untilDown(2, gait);
      expect(blows.length, gait).toBe(2);
      expect(blows[1] - blows[0], gait).toBeGreaterThanOrEqual(ZOMBIE_MELEE.hurtGraceTicks);
      // The first blow only lands once it is live (a tenth of the way through the swing), and the second after the grace.
      const { windupTicks, recoveryTicks } = ZOMBIE_MELEE.swing[gait];
      expect(downedAt, gait).toBeGreaterThanOrEqual(Math.ceil((windupTicks + recoveryTicks) * ZOMBIE_MELEE.liveFrom) + ZOMBIE_MELEE.hurtGraceTicks);
      expect(downedAt, gait).toBeGreaterThan(20);
    }
  });

  it('is still deadly in a crowd: four zombies down a player in about a second and a half', () => {
    for (const gait of ['walk', 'run', 'sprint'] as const) {
      const { blows, downedAt } = untilDown(4, gait);
      expect(downedAt, gait).toBeGreaterThan(0);
      expect(downedAt, gait).toBeLessThan(180);
      for (let i = 1; i < blows.length; i++) expect(blows[i] - blows[i - 1], gait).toBeGreaterThanOrEqual(ZOMBIE_MELEE.hurtGraceTicks);
    }
  });

  it('replays identically', () => {
    expect(untilDown(3, 'run')).toEqual(untilDown(3, 'run'));
  });
});

describe('a blow needs a real chance to land', () => {
  it('misses a player who steps out of reach before the blow is live, and the zombie carries on with the swing', () => {
    const { sim, player, zombies } = ring(1, 'walk', 1);
    const [zombie] = zombies, { windupTicks, totalTicks } = swingTiming(zombie);
    sim.tick();
    expect(zombie.attackTicks).toBeGreaterThan(0);
    // Out of reach for the whole swing: the zombie closes a metre or so while it swings, and they are further than that.
    player.position = { x: 0, y: 0, z: -4 };
    zombie.position = { x: 0, y: 0, z: 1 };
    const events: SimulationEvent[] = [];
    for (let tick = 0; tick < totalTicks; tick++) events.push(...sim.tick());
    expect(events.filter(event => event.type === 'zombieAttacked')).toEqual([]);
    expect(player.health).toBe(100);
    expect(windupTicks).toBeLessThan(totalTicks);
    // The swing is over: it goes after the player again rather than standing there.
    for (let tick = 0; tick < 60; tick++) sim.tick();
    expect(zombie.position.z).toBeLessThan(1);
  });

  it('lands the blow on a player who was within the lunge when it began, not only the start distance', () => {
    const { sim, player, zombies } = ring(1, 'walk', 1);
    const [zombie] = zombies;
    sim.tick();
    // A step back to 1.2 m: past where a swing starts, inside where a blow still lands.
    const dx = player.position.x - zombie.position.x, dz = player.position.z - zombie.position.z, d = Math.hypot(dx, dz);
    player.position = { x: zombie.position.x + dx / d * 1.2, y: 0, z: zombie.position.z + dz / d * 1.2 };
    const events: SimulationEvent[] = [];
    for (let tick = 0; tick < swingTiming(zombie).windupTicks + 1; tick++) events.push(...sim.tick());
    expect(events.filter(event => event.type === 'zombieAttacked')).toHaveLength(1);
  });

  it('does not start a swing at a player behind it, until it has turned round', () => {
    const { sim, zombies } = ring(1, 'walk');
    const [zombie] = zombies;
    zombie.yaw += Math.PI;
    zombie.moveSpeed = 0;
    let started = -1;
    for (let tick = 1; tick <= 60 && started < 0; tick++) {
      sim.tick();
      if (zombie.attackTicks > 0) started = tick;
    }
    // A half turn takes about a third of a second at 9 rad/s.
    expect(started).toBeGreaterThan(8);
    expect(started).toBeLessThan(40);
  });

  it('does not reach through a wall, or to another floor', () => {
    const wall: CollisionBox = { min: { x: -2, y: 0, z: 0.4 }, max: { x: 2, y: 3, z: 0.6 } };
    const { sim: walled, player, zombies } = ring(1, 'walk', 0.95, [wall]);
    zombies[0].position = { x: 0, y: 0, z: 0.95 }; zombies[0].yaw = Math.PI;
    for (let tick = 0; tick < 400; tick++) walled.tick();
    expect(player.health).toBe(100);
    const above = ring(1, 'walk');
    above.zombies[0].position.y = 3.4;
    for (let tick = 0; tick < 400; tick++) above.sim.tick();
    expect(above.player.health).toBe(100);
  });

  it('cannot hit a player from outside a fully boarded window, however close', () => {
    const window = BUNKER_BARRIERS[0];
    const sim = new GameSimulation({ seed: 5, playerSpawns: [BUNKER_PLAYER_SPAWN], roundConfig: QUIET,
      map: { collisionBoxes: greyboxCollisionBoxes(), walkSurfaces: BUNKER_WALK_SURFACES, zombieSpawns: [], barriers: [window] } });
    const player = sim.players()[0];
    // As close to the window on the inside as a player can get, and a zombie standing loose on the outside.
    const inside = { x: window.position.x - window.outward.x * 0.6, y: window.position.y, z: window.position.z - window.outward.z * 0.6 };
    player.position = inside;
    const outside = { x: window.position.x + window.outward.x * 0.65, y: window.position.y, z: window.position.z + window.outward.z * 0.65 };
    const zombie = createZombieState('e:30', outside, 1);
    zombie.yaw = facing(outside, inside);
    expect(inMeleeReach(zombie, player, sim.collisionBoxes(), ZOMBIE_MELEE.reach.strikeRange)).toBe(false);
    zombie.moveSpeed = 0;
    addEntity(sim.state.world, zombie);
    for (let tick = 0; tick < 600; tick++) sim.tick();
    expect(player.health).toBe(100);
    expect(zombie.attackTicks).toBe(0);
  });

  it('is measured across the floor: a zombie 1.05 m off starts a swing, one 2.1 m off walks closer first', () => {
    const near = ring(1, 'walk', 1.05), far = ring(1, 'walk', 2.1);
    near.zombies[0].moveSpeed = 0; far.zombies[0].moveSpeed = 0;
    near.sim.tick(); far.sim.tick();
    expect(near.zombies[0].attackTicks).toBeGreaterThan(0);
    expect(far.zombies[0].attackTicks).toBe(0);
    expect(ZOMBIE_MELEE.reach.startRange).toBeLessThan(ZOMBIE_MELEE.reach.strikeRange);
  });

  it('gives a downed player no blows, and forgets the grace when they are back up', () => {
    const player = createPlayerState('e:1', { x: 0, y: 0, z: 0 });
    const zombie = createZombieState('e:2', { x: 0, y: 0, z: 1 }, 1);
    zombie.yaw = Math.PI;
    player.hurtGraceTicks = 5;
    for (let i = 0; i < 5; i++) tickPlayerRecovery(player);
    expect(player.hurtGraceTicks).toBe(0);
    player.downed = { lostPerks: [], selfRevive: false, bleedTicks: 100, reviveTicks: 0 } as never;
    expect(tickZombieMelee(zombie, [player], [])).toEqual([]);
  });
});

describe('zombies keep out of each other and their target', () => {
  it('pushes zombies dropped on one point apart, and walls still hold', () => {
    const zombies = [0, 1, 2, 3].map(i => createZombieState(`e:${40 + i}` as EntityId, { x: 3, y: 0, z: 3 }, 1));
    const wall: CollisionBox = { min: { x: 2.2, y: 0, z: -5 }, max: { x: 2.4, y: 3, z: 5 } };
    for (let tick = 0; tick < 60; tick++) separateZombies(zombies, [], [wall], []);
    for (let i = 0; i < zombies.length; i++) {
      expect(zombies[i].position.x, `zombie ${i}`).toBeGreaterThan(2.4 + ZOMBIE_MOVEMENT.radius - 1e-6);
      for (let j = i + 1; j < zombies.length; j++) {
        const d = Math.hypot(zombies[i].position.x - zombies[j].position.x, zombies[i].position.z - zombies[j].position.z);
        expect(d, `${i}-${j}`).toBeGreaterThan(ZOMBIE_MOVEMENT.radius * 2 * 0.85);
      }
    }
  });

  it('spreads a crowd round a player who stands still: none inside them, none on top of each other', () => {
    const { sim, player, zombies } = ring(6, 'run', 6);
    for (const zombie of zombies) zombie.moveSpeed = 2.2;
    for (let tick = 0; tick < 300; tick++) sim.tick();
    // Somebody is hit meanwhile; what matters is the geometry.
    for (const zombie of zombies) {
      expect(Math.hypot(zombie.position.x - player.position.x, zombie.position.z - player.position.z), zombie.id).toBeGreaterThan(0.55);
    }
    for (let i = 0; i < zombies.length; i++) for (let j = i + 1; j < zombies.length; j++) {
      expect(Math.hypot(zombies[i].position.x - zombies[j].position.x, zombies[i].position.z - zombies[j].position.z), `${i}-${j}`)
        .toBeGreaterThan(ZOMBIE_MOVEMENT.radius * 2 * 0.8);
    }
  });

  it('does not shove a zombie that is mid-swing, or one coming through a window', () => {
    const swinging = createZombieState('e:50', { x: 0, y: 0, z: 0 }, 1), free = createZombieState('e:51', { x: 0.1, y: 0, z: 0 }, 1);
    swinging.attackTicks = 5;
    separateZombies([swinging, free], [], [], []);
    expect(swinging.position.x).toBe(0);
    expect(free.position.x).toBeGreaterThan(0.3);
    const entering = createZombieState('e:52', { x: 0, y: 0, z: 0 }, 1);
    entering.entry = { barrierId: 'w', phase: 'vaulting', waypointIndex: 1, phaseTicks: 0, lane: 0, vaultStart: null };
    const other = createZombieState('e:53', { x: 0.1, y: 0, z: 0 }, 1);
    separateZombies([entering, other], [], [], []);
    expect(entering.position.x).toBe(0);
  });
});
