import { describe, expect, it } from 'vitest';
import {
  BODY_CONTACT, PLAYER_MOVEMENT, ZOMBIE_GAIT_SPEEDS, ZOMBIE_GIVE, ZOMBIE_PACE_SPREAD, addEntity, allocateEntityId,
  WEDGE_DEPTH, ZOMBIE_MELEE, blockPlayerByZombies, createPlayerState, createZombieState, separateZombies, tickZombieMelee, type CollisionBox, type GameSimulation, type PlayerState, type ZombieState,
} from '../src/core/index.ts';
import { frameFor, openGround, runChase, runCrowd, runRunUp } from '../src/bench/difficulty.ts';
import { predictPlayerTick } from '../src/net/prediction.ts';

/**
 * Issue #210: pressure should come from positioning, crowds and timing rather than from ineffective contact or from
 * speed. These pin how it feels by running a scripted player against zombies (`src/bench/difficulty.ts`); the numbers
 * behind them are in docs/zombie-difficulty.md.
 */

/** The fastest zombie a horde can hold: the sprinter's speed, and the most its own pace may be over it. */
const FASTEST = ZOMBIE_GAIT_SPEEDS.sprint * (1 + ZOMBIE_PACE_SPREAD);

/** A zombie that stays where it is placed, on open ground. */
function stationary(sim: GameSimulation, x: number, z: number): ZombieState {
  const zombie = createZombieState(allocateEntityId(sim.state.world), { x, y: 0, z }, 15, 'run');
  zombie.moveSpeed = 0;
  addEntity(sim.state.world, zombie);
  return zombie;
}

describe('a chase', () => {
  it('opens the gap on the fastest sprinter by walking alone, and the player is never hit', () => {
    const chase = runChase({ gait: 'sprint', speed: FASTEST, plan: 'walk', seconds: 30 });
    expect(chase.firstHitSecond).toBeNull();
    // Still opening at the end, not settling at some distance the zombie then holds.
    expect(chase.gaps[9]).toBeGreaterThan(chase.gaps[2]);
    expect(chase.gaps[29]).toBeGreaterThan(chase.gaps[9] + 3);
  });

  it('is left far behind when the player sprints, stamina and all', () => {
    const chase = runChase({ gait: 'sprint', speed: FASTEST, plan: 'sprint', seconds: 20 });
    expect(chase.sprintSeconds).toBeGreaterThan(8);
    expect(chase.gaps[9]).toBeGreaterThan(12);
    expect(chase.firstHitSecond).toBeNull();
  });

  it('still catches a player who stops: sprinters are a threat, only not one that cannot be outrun', () => {
    const chase = runChase({ gait: 'sprint', plan: 'stand', startGap: 12, seconds: 10 });
    expect(chase.firstHitSecond).not.toBeNull();
    expect(chase.firstHitSecond!).toBeGreaterThan(3);
    expect(chase.firstHitSecond!).toBeLessThan(6);
  });
});

describe('zombies are solid to the player', () => {
  it('holds a player out of every zombie, however they come at a crowd', () => {
    for (const approach of ['dash', 'weave'] as const) for (const zombies of [1, 3, 6, 12]) for (const seed of [1, 2, 3, 4]) {
      const result = runCrowd({ approach, zombies, seed, seconds: 6 });
      expect(result.closest, `${approach}, ${zombies} zombies, seed ${seed}`).toBeGreaterThan(BODY_CONTACT - 0.01);
    }
  });

  it('stops a player between two zombies too close together for a body, and lets one through where a body fits', () => {
    const dashBetween = (spacing: number): number => {
      const sim = openGround({ x: 0, y: 0, z: 6 });
      const player = sim.getPlayer(sim.playerIds[0])!;
      stationary(sim, -spacing / 2, 0); stationary(sim, spacing / 2, 0);
      for (let tick = 0; tick < 240; tick++) sim.tick({ [player.id]: frameFor(tick, ['moveForward', 'sprint']) });
      return player.position.z;
    };
    // Bodies are 0.66 across: the middles must be 1.32 apart to leave room.
    expect(dashBetween(1.0)).toBeGreaterThan(0);
    expect(dashBetween(1.2)).toBeGreaterThan(0);
    expect(dashBetween(1.6)).toBeLessThan(-3);
  });

  it('slides a player round a lone zombie rather than stopping them dead', () => {
    const sim = openGround({ x: 0.1, y: 0, z: 6 });
    const player = sim.getPlayer(sim.playerIds[0])!;
    stationary(sim, 0, 0);
    for (let tick = 0; tick < 240; tick++) sim.tick({ [player.id]: frameFor(tick, ['moveForward', 'sprint']) });
    expect(player.position.z).toBeLessThan(-3);
  });

  it('predicts being stopped as the host does, so a co-op player is not pulled back', () => {
    const sim = openGround({ x: 0, y: 0, z: 6 });
    const host = sim.getPlayer(sim.playerIds[0])!;
    stationary(sim, 0, 0);
    const predicted = createPlayerState('e:1', { x: 0, y: 0, z: 6 });
    const world = { collision: () => [], walkSurfaces: [], shotBlockers: [], zombies: () => sim.zombies() };
    for (let tick = 0; tick < 180; tick++) {
      const frame = frameFor(tick, ['moveForward', 'sprint']);
      sim.tick({ [host.id]: frame });
      predictPlayerTick(predicted, frame, world, tick);
    }
    expect(host.position.z).toBeGreaterThan(0.3);
    expect(Math.hypot(host.position.x - predicted.position.x, host.position.z - predicted.position.z)).toBeLessThan(0.1);
  });
});

describe('blockPlayerByZombies', () => {
  /** A player at the origin heading -z at 4 m/s, and a zombie `gap` metres ahead. */
  function meeting(gap: number, attackTicks = 0) {
    const player = createPlayerState('e:1', { x: 0, y: 0, z: 0 });
    player.velocity = { x: 0, y: 0, z: -4 };
    const zombie = createZombieState('e:9', { x: 0, y: 0, z: -gap }, 1, 'run');
    zombie.attackTicks = attackTicks;
    return { player, zombie };
  }
  const distance = (a: { position: { x: number; z: number } }, b: { position: { x: number; z: number } }) =>
    Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z);

  it('holds against a swinging zombie all the way, and takes off the speed that carried the player in', () => {
    const { player, zombie } = meeting(0.5, 5);
    blockPlayerByZombies(player, { ...player.position }, [zombie], []);
    expect(distance(player, zombie)).toBeCloseTo(BODY_CONTACT, 6);
    expect(player.velocity.z).toBeCloseTo(0, 9);
  });

  it('lets a zombie that is free give way by a share, and keeps that share of the speed', () => {
    const { player, zombie } = meeting(0.5);
    blockPlayerByZombies(player, { ...player.position }, [zombie], []);
    expect(distance(player, zombie)).toBeCloseTo(BODY_CONTACT - (BODY_CONTACT - 0.5) * ZOMBIE_GIVE, 6);
    expect(player.velocity.z).toBeCloseTo(-4 * ZOMBIE_GIVE, 6);
  });

  it('keeps the speed that runs along a zombie, and asks nothing of a zombie that is not touched', () => {
    const { player, zombie } = meeting(0.5, 5);
    player.velocity = { x: 3, y: 0, z: -4 };
    blockPlayerByZombies(player, { ...player.position }, [zombie], []);
    expect(player.velocity.x).toBeCloseTo(3, 9);
    const clear = meeting(BODY_CONTACT + 0.01, 5);
    const before = { ...clear.player.position };
    blockPlayerByZombies(clear.player, { ...clear.player.position }, [clear.zombie], []);
    expect(clear.player.position).toEqual(before);
    expect(clear.player.velocity.z).toBe(-4);
  });

  it('cannot push a player through a wall', () => {
    const { player, zombie } = meeting(0.4, 5);
    const wall: CollisionBox = { min: { x: -5, y: 0, z: 0.5 }, max: { x: 5, y: 3, z: 1.5 } };
    blockPlayerByZombies(player, { ...player.position }, [zombie], [wall]);
    // Pushed as far as the wall's face, grown by the player's radius, and no further.
    expect(player.position.z).toBeGreaterThan(0.1);
    expect(player.position.z).toBeLessThanOrEqual(0.5 - PLAYER_MOVEMENT.radius + 1e-3);
  });

  it('ignores what it should: the dead, a zombie in a window, another floor, a downed or noclipping player', () => {
    const cases: Array<(scene: ReturnType<typeof meeting>) => void> = [
      ({ zombie }) => { zombie.alive = false; },
      ({ zombie }) => { zombie.entry = { barrierId: 'b' } as unknown as ZombieState['entry']; },
      ({ zombie }) => { zombie.position.y = 3; },
      ({ player }) => { player.downed = { bleedoutTicks: 100 } as unknown as PlayerState['downed']; },
      ({ player }) => { player.noclip = true; },
    ];
    for (const change of cases) {
      const scene = meeting(0.5, 5);
      change(scene);
      const before = { ...scene.player.position };
      blockPlayerByZombies(scene.player, { ...scene.player.position }, [scene.zombie], []);
      expect(scene.player.position).toEqual(before);
    }
  });

  it('stops a player who runs into a wedge of swinging zombies where they were, rather than leaving them inside one', () => {
    // Two zombies ahead a body apart and one closed in behind: no spot within reach clears all three, so the player is
    // put back at `from` (and eased off whatever there overlaps) and loses their speed.
    const player = createPlayerState('e:1', { x: 0, y: 0, z: 0.05 });
    const zombies = [[-0.45, -0.25], [0.45, -0.25], [0, 0.6]].map(([x, z], i) => {
      const zombie = createZombieState(`e:${i + 2}`, { x, y: 0, z }, 1, 'run');
      zombie.attackTicks = 5;
      return zombie;
    });
    const from = { x: 0, y: 0, z: 0.15 };
    player.velocity = { x: 0, y: 0, z: -6 };
    blockPlayerByZombies(player, from, zombies, []);
    expect(distance(player, { position: from })).toBeLessThan(0.3);
    expect(player.velocity.z).toBe(0);
  });

  it('gets a player out of a crowd it has closed round, without pushing any one body through another', () => {
    const player = createPlayerState('e:1', { x: 0, y: 0, z: 0 });
    const zombies = [[0.4, 0], [-0.4, 0.1], [0, 0.45], [0.05, -0.4]].map(([x, z], i) => {
      const zombie = createZombieState(`e:${i}`, { x, y: 0, z }, 1, 'run');
      zombie.attackTicks = 3;
      return zombie;
    });
    blockPlayerByZombies(player, { ...player.position }, zombies, []);
    for (const zombie of zombies) expect(distance(player, zombie)).toBeGreaterThan(BODY_CONTACT - 0.12);
  });
});

describe('a queue behind a fight', () => {
  const zombie = (id: string, z: number, attackTicks = 0) => {
    const body = createZombieState(id as `e:${number}`, { x: 0, y: 0, z }, 1, 'run');
    body.attackTicks = attackTicks; body.stall = 179; body.anchorX = 0; body.anchorZ = z;
    return body;
  };

  it('is held, not taken for stuck, so it is never put down through the crowd', () => {
    const player = createPlayerState('e:1', { x: 0, y: 0, z: 0 });
    // A fighter against the player, and three more pressed in a line behind it.
    const line = [zombie('e:2', -0.7, 5), zombie('e:3', -1.28), zombie('e:4', -1.86), zombie('e:5', -2.44)];
    separateZombies(line, [player], [], []);
    for (const body of line) expect(body.stall, body.id).toBe(0);
  });

  it('is not held when nobody in the jam is fighting: a jam on a corner still recovers', () => {
    const player = createPlayerState('e:1', { x: 0, y: 0, z: 0 });
    const line = [zombie('e:2', -6), zombie('e:3', -6.58), zombie('e:4', -7.16)];
    separateZombies(line, [player], [], []);
    for (const body of line) expect(body.stall, body.id).toBe(179);
  });
});

describe('a zombie that reads where the player is going', () => {
  /** A zombie at the origin facing +z, and a player at (0, z) moving with (vx, vz). */
  function scene(z: number, vx = 0, vz = 0, x = 0) {
    const zombie = createZombieState('e:2', { x: 0, y: 0, z: 0 }, 1, 'run');
    zombie.yaw = 0;
    const player = createPlayerState('e:1', { x, y: 0, z });
    player.velocity = { x: vx, y: 0, z: vz };
    return { zombie, player };
  }

  it('starts its swing before a player running at it is in reach, so the blow lands as they arrive', () => {
    const { zombie, player } = scene(5, 0, -4.2);
    let beganAt: number | null = null, hit = false;
    for (let tick = 0; tick < 240 && !hit; tick++) {
      player.position.z = Math.max(BODY_CONTACT, player.position.z - 4.2 / 60);
      const events = tickZombieMelee(zombie, [player]);
      if (beganAt === null && zombie.attackTicks > 0) beganAt = player.position.z;
      hit = events.some(event => event.type === 'zombieAttacked');
    }
    expect(beganAt).not.toBeNull();
    // Well before the 1.1 m a swing used to need, and not so far off that it is guessing.
    expect(beganAt!).toBeGreaterThan(ZOMBIE_MELEE.reach.startRange + 1);
    expect(beganAt!).toBeLessThan(ZOMBIE_MELEE.reach.strikeRange + ZOMBIE_MELEE.anticipation.maxLeadMetres + 0.3);
    expect(hit).toBe(true);
  });

  it('holds off for a player who is standing, backing away, or crossing well in front of it', () => {
    for (const [z, vx, vz] of [[2, 0, 0], [2, 0, 4.2], [3, 4.2, 0], [3, -4.2, 0]]) {
      const { zombie, player } = scene(z, vx, vz);
      for (let tick = 0; tick < 30; tick++) tickZombieMelee(zombie, [player]);
      expect(zombie.attackTicks, `player at ${z} m going (${vx}, ${vz})`).toBe(0);
    }
  });

  it('misses a player who stops short, or turns away, once the swing has begun', () => {
    for (const away of [false, true]) {
      const { zombie, player } = scene(5, 0, -4.2);
      let hit = false, swung = false;
      for (let tick = 0; tick < 240; tick++) {
        if (!swung) player.position.z -= 4.2 / 60;
        else { player.velocity = { x: 0, y: 0, z: away ? 4.2 : 0 }; if (away) player.position.z += 4.2 / 60; }
        if (tickZombieMelee(zombie, [player]).some(event => event.type === 'zombieAttacked')) hit = true;
        if (zombie.attackTicks > 0) swung = true;
      }
      expect(swung).toBe(true);
      expect(hit, away ? 'turned away' : 'stopped short').toBe(false);
    }
  });
});

describe('running up to a zombie and away again', () => {
  const variants = [0, 1, 2, 3, 4, 5];

  it('connects when the player gets right up to it, at a walk or a sprint', () => {
    for (const plan of ['walk', 'sprint'] as const) for (const variant of variants) {
      expect(runRunUp({ turnAt: 0.7, plan, variant }).hits, `${plan}, tempo ${variant}`).toBeGreaterThanOrEqual(1);
    }
  });

  it('can still be dodged by turning away early enough', () => {
    for (const plan of ['walk', 'sprint'] as const) for (const variant of variants) {
      expect(runRunUp({ turnAt: 2.5, plan, variant }).hits, `${plan}, tempo ${variant}`).toBe(0);
    }
  });

  it('begins the swing well before the player is in reach', () => {
    for (const variant of variants) {
      const { swingBeganAt } = runRunUp({ turnAt: 0.7, variant });
      expect(swingBeganAt).not.toBeNull();
      expect(swingBeganAt!).toBeGreaterThan(2);
    }
  });
});

describe('what a crowd costs', () => {
  it('makes running into the middle of a group cost blows, though steering round it stays free', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      expect(runCrowd({ approach: 'dash', zombies: 6, seed, seconds: 8 }).hits, `dash, seed ${seed}`).toBeGreaterThanOrEqual(1);
      expect(runCrowd({ approach: 'weave', zombies: 12, seed, seconds: 8 }), `weave, seed ${seed}`).toMatchObject({ hits: 0 });
      expect(runCrowd({ approach: 'weave', zombies: 12, seed, seconds: 8 }).seconds, `weave, seed ${seed}`).not.toBeNull();
    }
  });

  it('leaves a lone zombie something a player can run past, as an escape route', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      expect(runCrowd({ approach: 'dash', zombies: 1, seed, seconds: 8 }).seconds, `seed ${seed}`).not.toBeNull();
    }
  });
});
