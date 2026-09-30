import { describe, expect, it } from 'vitest';
import {
  BODY_CONTACT, PLAYER_MOVEMENT, ZOMBIE_GAIT_SPEEDS, ZOMBIE_GIVE, ZOMBIE_PACE_SPREAD, addEntity, allocateEntityId,
  WEDGE_DEPTH, ZOMBIE_MELEE, swingTiming, updateZombiePursuit, blockPlayerByZombies, createPlayerState, createZombieState, separateZombies, tickZombieMelee, type CollisionBox, type GameSimulation, type PlayerState, type ZombieGait, type ZombieState,
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
/** How fast the player walks. */
const WALK = PLAYER_MOVEMENT.maxSpeed;

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
    // A sprinter covers the 12 m in about three and a half seconds, and its blow lands as it arrives.
    expect(chase.firstHitSecond!).toBeGreaterThan(2);
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

describe('a blow has a window, not one tick', () => {
  const { beforeTicks, afterTicks } = ZOMBIE_MELEE.hitWindow;
  /**
   * One swing at a player 1 m in front of a zombie that does not move, or 2 m if the script says so: `z(offset)` is the
   * player's distance on the swing tick `offset` ticks from the moment of contact (`elapsed` counts real ticks, which run on
   * while a held arm's swing tick does not). Gives the offsets the blow landed on.
   */
  function swing(z: (offset: number, elapsed: number) => number, options: { grace?: number; gait?: ZombieGait; calls?: number[] } = {}): number[] {
    const zombie = createZombieState('e:2', { x: 0, y: 0, z: 0 }, 1, options.gait ?? 'run');
    zombie.yaw = 0;
    const player = createPlayerState('e:1', { x: 0, y: 0, z: 1 });
    const contact = swingTiming(zombie).windupTicks, landed: number[] = [];
    // `grace` is how many ticks of another zombie's grace the player still has when the arm reaches contact.
    player.hurtGraceTicks = options.grace === undefined ? 0 : contact + options.grace;
    let swung = false;
    for (let tick = 0; tick < 600; tick++) {
      const ticks = zombie.attackTicks;
      player.position.z = ticks === 0 ? 1 : z(ticks - contact, tick - contact);
      if (player.hurtGraceTicks > 0 && ticks > 0) player.hurtGraceTicks -= 1;
      const events = tickZombieMelee(zombie, [player]);
      if (events.some(event => event.type === 'zombieAttacked')) { landed.push(ticks - contact); options.calls?.push(tick - contact); }
      if (zombie.attackTicks > 0) swung = true;
      else if (swung) break;
      player.health = 100;
    }
    return landed;
  }
  const IN = 1, OUT = 2;

  it('lands a standing player\'s blow at the moment of contact, once', () => {
    expect(swing(() => IN)).toEqual([0]);
  });

  it('lands on a player who was in reach as the arm came down and has stepped out by contact', () => {
    expect(swing(offset => offset < 0 ? IN : OUT)).toEqual([0]);
    // In reach only on the last tick of the lead-in still counts.
    expect(swing(offset => offset === -1 ? IN : OUT)).toEqual([0]);
  });

  it('misses a player who was out of reach for the whole window, however close they were before it', () => {
    expect(swing(offset => offset < -beforeTicks ? IN : OUT)).toEqual([]);
  });

  it('lands on a player who comes into reach after contact, as soon as they do, until the window closes', () => {
    // There is some follow-through (five ticks is a twelfth of a second), whatever the window is tuned to.
    expect(swing(offset => offset < 5 ? OUT : IN), 'five ticks late').toEqual([5]);
    for (let late = 1; late <= afterTicks; late++) expect(swing(offset => offset < late ? OUT : IN), `${late} ticks late`).toEqual([late]);
    expect(swing(offset => offset < afterTicks + 1 ? OUT : IN), 'one tick past the window').toEqual([]);
  });

  it('is one blow a swing however long the player stays in reach', () => {
    expect(swing(() => IN, { gait: 'sprint' })).toHaveLength(1);
    expect(swing(() => IN, { gait: 'walk' })).toHaveLength(1);
  });

  it('is one blow a swing even with a second player in reach: it does not hit both', () => {
    const zombie = createZombieState('e:2', { x: 0, y: 0, z: 0 }, 1, 'run');
    zombie.yaw = 0;
    const players = [createPlayerState('e:1', { x: 0, y: 0, z: 1 }), createPlayerState('e:3', { x: 0.2, y: 0, z: 1 })];
    let blows = 0, swung = false;
    for (let tick = 0; tick < 600; tick++) {
      const landed = tickZombieMelee(zombie, players).filter(event => event.type === 'zombieAttacked').length;
      blows += landed;
      // The one who was hit backs away at once; the other stays where the arm is still coming through.
      if (landed) players[0].position.z = 3;
      for (const player of players) { if (player.hurtGraceTicks > 0) player.hurtGraceTicks -= 1; player.health = 100; }
      if (zombie.attackTicks > 0) swung = true;
      else if (swung) break;
    }
    expect(blows).toBe(1);
  });

  it('still waits, arm out, through another zombie\'s grace, and only while the player stays in reach', () => {
    const calls: number[] = [];
    expect(swing(() => IN, { grace: 20, calls })).toEqual([0]);
    // Held at contact for the grace, then it lands: twenty ticks after contact, not at it.
    expect(calls[0]).toBeGreaterThanOrEqual(19);
    // Out of reach once the arm is held: the blow does not follow them.
    expect(swing((_, elapsed) => elapsed < 3 ? IN : OUT, { grace: 20 })).toEqual([]);
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
    const { zombie, player } = scene(5, 0, -WALK);
    let beganAt: number | null = null, hit = false;
    for (let tick = 0; tick < 240 && !hit; tick++) {
      player.position.z = Math.max(BODY_CONTACT, player.position.z - WALK / 60);
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

  it('holds off for a player who is well off, backing away, or crossing well in front of it', () => {
    for (const [z, vx, vz] of [[4, 0, 0], [2, 0, WALK], [3, WALK, 0], [3, -WALK, 0]]) {
      const { zombie, player } = scene(z, vx, vz);
      for (let tick = 0; tick < 30; tick++) tickZombieMelee(zombie, [player]);
      expect(zombie.attackTicks, `player at ${z} m going (${vx}, ${vz})`).toBe(0);
    }
  });

  it('misses a player who stops short, or turns away, once the swing has begun', () => {
    for (const away of [false, true]) {
      const { zombie, player } = scene(5, 0, -WALK);
      let hit = false, swung = false;
      for (let tick = 0; tick < 240; tick++) {
        if (!swung) player.position.z -= WALK / 60;
        else { player.velocity = { x: 0, y: 0, z: away ? WALK : 0 }; if (away) player.position.z += WALK / 60; }
        if (tickZombieMelee(zombie, [player]).some(event => event.type === 'zombieAttacked')) hit = true;
        if (zombie.attackTicks > 0) swung = true;
      }
      expect(swung).toBe(true);
      expect(hit, away ? 'turned away' : 'stopped short').toBe(false);
    }
  });
});

describe('a zombie keeps coming while it swings', () => {
  /** A zombie `start` m from a player who stands still on open ground, run tick by tick. */
  function approach(start: number) {
    const sim = openGround({ x: 0, y: 0, z: 0 });
    const player = sim.getPlayer(sim.playerIds[0])!;
    const zombie = createZombieState(allocateEntityId(sim.state.world), { x: 0, y: 0, z: -start }, 15, 'sprint');
    zombie.yaw = 0;
    addEntity(sim.state.world, zombie);
    const distance = () => Math.hypot(zombie.position.x - player.position.x, zombie.position.z - player.position.z);
    return { sim, player, zombie, distance };
  }

  it('closes in during the wind-up rather than halting where it began, and the blow lands with it at the player', () => {
    const { sim, zombie, distance } = approach(6);
    let swingAt: number | null = null, hitAt: number | null = null;
    for (let tick = 0; tick < 600 && hitAt === null; tick++) {
      const events = sim.tick();
      if (swingAt === null && zombie.attackTicks > 0) swingAt = distance();
      if (events.some(event => event.type === 'zombieAttacked')) hitAt = distance();
    }
    expect(swingAt).not.toBeNull();
    // It began the swing while still well off, and closed by a couple of metres during it: the blow lands from its reach.
    expect(swingAt!).toBeGreaterThan(2);
    expect(hitAt).not.toBeNull();
    expect(hitAt!).toBeLessThanOrEqual(ZOMBIE_MELEE.reach.strikeRange);
    expect(swingAt! - hitAt!).toBeGreaterThan(1);
  });

  it('stops when it touches the player, and does not push them along', () => {
    const { sim, player, zombie, distance } = approach(6);
    const start = { ...player.position };
    for (let tick = 0; tick < 600; tick++) sim.tick();
    expect(distance()).toBeLessThan(BODY_CONTACT + 0.06);
    expect(distance()).toBeGreaterThan(BODY_CONTACT - 0.02);
    expect(Math.hypot(player.position.x - start.x, player.position.z - start.z)).toBeLessThan(0.06);
    expect(zombie.velocity).toMatchObject({ x: 0, z: 0 });
  });

  it('is not counted as stalled while it swings, however little ground it gets, but is when it is not swinging', () => {
    // A wall across its way to a player 6 m off: it gets nowhere either way.
    const wall: CollisionBox = { min: { x: -5, y: 0, z: -3.2 }, max: { x: 5, y: 3, z: -2.8 } };
    for (const [swinging, stalls] of [[true, false], [false, true]] as const) {
      const zombie = createZombieState('e:2', { x: 0, y: 0, z: 0 }, 1, 'run');
      const player = createPlayerState('e:1', { x: 0, y: 0, z: -6 });
      let most = 0;
      for (let tick = 0; tick < 120; tick++) {
        zombie.attackTicks = swinging ? 5 : 0;
        updateZombiePursuit(zombie, [player], 1 / 60, [wall], []);
        most = Math.max(most, zombie.stall);
      }
      expect(most > 30, swinging ? 'swinging' : 'not swinging').toBe(stalls);
    }
  });

  it('keeps zombies that swing on the move out of each other, so a column does not merge into one', () => {
    const sim = openGround({ x: 0, y: 0, z: 0 });
    const column = [0, 1, 2, 3, 4, 5].map(index => {
      const zombie = createZombieState(allocateEntityId(sim.state.world), { x: 0, y: 0, z: -5 - index * 0.6 }, 15, 'sprint');
      addEntity(sim.state.world, zombie);
      return zombie;
    });
    let closest = Infinity;
    for (let tick = 0; tick < 420; tick++) {
      sim.tick();
      if (tick < 30) continue;
      for (let i = 0; i < column.length; i++) for (let j = i + 1; j < column.length; j++) {
        closest = Math.min(closest, Math.hypot(column[i].position.x - column[j].position.x, column[i].position.z - column[j].position.z));
      }
    }
    // Bodies are 0.64 across and are held at 0.58 apart; none may sit on another.
    expect(closest).toBeGreaterThan(0.45);
  });
});

describe('running up to a zombie and away again', () => {
  const variants = [0, 1, 2, 3, 4, 5];

  it('connects when the player gets right up to it, at a walk or a sprint', () => {
    for (const plan of ['walk', 'sprint'] as const) for (const variant of variants) {
      expect(runRunUp({ turnAt: 0.7, plan, variant }).hits, `${plan}, tempo ${variant}`).toBeGreaterThanOrEqual(1);
    }
  });

  it('can still be dodged by turning away before the swing begins', () => {
    for (const plan of ['walk', 'sprint'] as const) for (const variant of variants) {
      expect(runRunUp({ turnAt: 4, plan, variant }).hits, `${plan}, tempo ${variant}`).toBe(0);
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
      // Steering round a whole group can cost a blow or two (two is a life), never a wall: a way through is left.
      const weave = runCrowd({ approach: 'weave', zombies: 12, seed, seconds: 8 });
      expect(weave.hits, `weave, seed ${seed}`).toBeLessThanOrEqual(2);
      expect(weave.seconds, `weave, seed ${seed}`).not.toBeNull();
    }
  });

  it('leaves a lone zombie something a player can run past, as an escape route', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      expect(runCrowd({ approach: 'dash', zombies: 1, seed, seconds: 8 }).seconds, `seed ${seed}`).not.toBeNull();
    }
  });
});
