import { describe, expect, it } from 'vitest';
import { collectPowerups, createBarrier, createPlayerState, createPowerupState, createWeaponState,
  createZombieState, tickPowerupLifetime, tryDropPowerup, GameSimulation, createInputFrame,
  addEntity, damagePlayer, DEFAULT_POWERUP_CONFIG, startPowerupRound, updatePowerupThreshold,
  type PowerupConfig } from '../src/core/index.ts';

const forced: PowerupConfig = { ...DEFAULT_POWERUP_CONFIG, randomDropPercent: 100, kinds: ['maxAmmo'] };

describe('timed power-ups', () => {
  it('drops deterministically and caps drops per round', () => {
    const first = createPowerupState(), second = createPowerupState();
    const zombie = createZombieState('e:9', { x: 4, y: 0, z: 3 }, 1);
    const spawn = tryDropPowerup(first, zombie, [], 123, 100, forced);
    expect(spawn).toEqual(tryDropPowerup(second, zombie, [], 123, 100, forced));
    expect(spawn).toMatchObject([{ type: 'powerupSpawned', dropId: 'p:1', kind: 'maxAmmo' }]);
    for (let i = 0; i < 3; i++) expect(tryDropPowerup(first, zombie, [], 123, 101 + i, forced)).toHaveLength(1);
    expect(tryDropPowerup(first, zombie, [], 123, 200, forced)).toEqual([]);
    expect(first.drops).toHaveLength(4);
    startPowerupRound(first);
    expect(tryDropPowerup(first, zombie, [], 123, 300, forced)).toMatchObject([{ dropId: 'p:5' }]);
  });

  it('places a reward from an exterior kill inside its window', () => {
    const barrier = createBarrier({ id: 'window', position: { x: 0, y: 0, z: 0 },
      outward: { x: 0, y: 0, z: -1 }, width: 2, maxBoards: 3,
      approachPath: [{ x: 0, y: 0, z: -5 }, { x: 0, y: 0, z: -1 }],
      insidePoint: { x: 0, y: 0, z: 1 } }, 'e:2').state;
    const zombie = createZombieState('e:9', { x: 0, y: 0, z: -2 }, 1);
    zombie.entry = { barrierId: 'window', phase: 'approach', waypointIndex: 1,
      phaseTicks: 0, lane: 0, vaultStart: null };
    const state = createPowerupState();
    tryDropPowerup(state, zombie, [barrier], 42, 1, forced);
    expect(state.drops[0].position).toEqual(barrier.insidePoint);
  });

  it('refills both carried guns for every living player without filling magazines', () => {
    const state = createPowerupState(), zombie = createZombieState('e:9', { x: 0, y: 0, z: 0 }, 1);
    tryDropPowerup(state, zombie, [], 42, 1, forced);
    const collector = createPlayerState('e:1', { x: 0, y: 0, z: 0 });
    collector.weapon.magazineAmmo = 2; collector.weapon.reserveAmmo = 1;
    collector.holsteredWeapon = createWeaponState('bar'); collector.holsteredWeapon.reserveAmmo = 3;
    const teammate = createPlayerState('e:2', { x: 10, y: 0, z: 0 });
    teammate.weapon.reserveAmmo = 0;
    expect(collectPowerups(state, [teammate, collector], [], forced)).toEqual([
      { type: 'powerupCollected', dropId: 'p:1', kind: 'maxAmmo', playerId: 'e:1' },
    ]);
    expect(collector.weapon).toMatchObject({ magazineAmmo: 2, reserveAmmo: 32 });
    expect(collector.holsteredWeapon.reserveAmmo).toBe(140);
    expect(teammate.weapon.reserveAmmo).toBe(32);
    expect(state.drops).toEqual([]);
  });

  it('cannot collect through a wall and expires after its fixed lifetime', () => {
    const state = createPowerupState(), zombie = createZombieState('e:9', { x: 1, y: 0, z: 0 }, 1);
    const quick = { ...forced, lifetimeTicks: 2 };
    tryDropPowerup(state, zombie, [], 42, 1, quick);
    const player = createPlayerState('e:1', { x: 0, y: 0, z: 0 });
    const wall = [{ min: { x: 0.4, y: 0, z: -1 }, max: { x: 0.6, y: 2, z: 1 } }];
    expect(collectPowerups(state, [player], wall, quick)).toEqual([]);
    expect(tickPowerupLifetime(state)).toEqual([]);
    expect(tickPowerupLifetime(state)).toEqual([{ type: 'powerupExpired', dropId: 'p:1', kind: 'maxAmmo' }]);
    expect(state.drops).toEqual([]);
  });

  it('connects a kill, world pickup, ammo refill and restart through GameSimulation', () => {
    const sim = new GameSimulation({ seed: 31, playerSpawns: [{ x: 0, y: 0, z: 0 }],
      map: { collisionBoxes: [], walkSurfaces: [], zombieSpawns: [] }, powerupConfig: forced,
      roundConfig: { initialWaitTicks: 9999, intermissionTicks: 9999 } });
    const player = sim.getPlayer(sim.playerIds[0])!;
    player.weapon = createWeaponState('kar98k'); player.weapon.reserveAmmo = 2;
    addEntity(sim.state.world, createZombieState('e:99', { x: 0, y: 0, z: -3 }, 1));
    const fire = createInputFrame(0);
    fire.actions.fire = { held: true, pressed: true, released: false, value: 1 };
    expect(sim.tick({ [player.id]: fire }).map(event => event.type)).toContain('powerupSpawned');
    expect(sim.state.powerups.drops).toHaveLength(1);
    player.position.z = -2.5;
    expect(sim.tick().map(event => event.type)).toContain('powerupCollected');
    expect(player.weapon.reserveAmmo).toBe(50);
    expect(player.weapon.magazineAmmo).toBe(4);
    sim.restart();
    expect(sim.state.powerups).toEqual(createPowerupState(500, forced));
  });

  it('activates a timed team-wide Double Points bonus only after collection', () => {
    const state = createPowerupState(), zombie = createZombieState('e:9', { x: 0, y: 0, z: 0 }, 1);
    const config: PowerupConfig = { ...forced, kinds: ['doublePoints'], doublePointsDurationTicks: 3 };
    tryDropPowerup(state, zombie, [], 42, 1, config);
    expect(state.drops[0].kind).toBe('doublePoints');
    expect(state.doublePointsTicksRemaining).toBe(0);
    const player = createPlayerState('e:1', { x: 0, y: 0, z: 0 });
    expect(collectPowerups(state, [player], [], config)).toMatchObject([{ kind: 'doublePoints' }]);
    expect(state.doublePointsTicksRemaining).toBe(3);
    for (let i = 0; i < 3; i++) tickPowerupLifetime(state);
    expect(state.doublePointsTicksRemaining).toBe(0);
  });

  it('doubles gun hit and kill rewards while active, then returns to normal', () => {
    const sim = new GameSimulation({ seed: 31, playerSpawns: [{ x: 0, y: 0, z: 0 }],
      map: { collisionBoxes: [], walkSurfaces: [], zombieSpawns: [] },
      roundConfig: { initialWaitTicks: 9999, intermissionTicks: 9999 } });
    const player = sim.getPlayer(sim.playerIds[0])!;
    player.weapon = createWeaponState('kar98k');
    sim.state.powerups.doublePointsTicksRemaining = 2;
    addEntity(sim.state.world, createZombieState('e:99', { x: 0, y: 0, z: -3 }, 1));
    const fire = createInputFrame(0);
    fire.actions.fire = { held: true, pressed: true, released: false, value: 1 };
    sim.tick({ [player.id]: fire });
    expect(player.points).toBe(700); // Headshot kill: (10 hit + 90 bonus) × 2.
    player.weapon.cooldownTicks = 0;
    addEntity(sim.state.world, createZombieState('e:100', { x: 0, y: 0, z: -3 }, 1));
    sim.tick({ [player.id]: fire });
    expect(player.points).toBe(800);
  });

  it('activates and expires Insta-Kill independently of Double Points', () => {
    const state = createPowerupState(), zombie = createZombieState('e:9', { x: 0, y: 0, z: 0 }, 1);
    const config: PowerupConfig = { ...forced, kinds: ['instaKill'], instaKillDurationTicks: 2 };
    tryDropPowerup(state, zombie, [], 42, 1, config);
    const player = createPlayerState('e:1', { x: 0, y: 0, z: 0 });
    collectPowerups(state, [player], [], config);
    expect(state.instaKillTicksRemaining).toBe(2);
    expect(state.doublePointsTicksRemaining).toBe(0);
    tickPowerupLifetime(state); expect(state.instaKillTicksRemaining).toBe(1);
    tickPowerupLifetime(state); expect(state.instaKillTicksRemaining).toBe(0);
  });

  it('routes Insta-Kill through simulation damage until its final tick', () => {
    const sim = new GameSimulation({ seed: 31, playerSpawns: [{ x: 0, y: 0, z: 0 }],
      map: { collisionBoxes: [], walkSurfaces: [], zombieSpawns: [] },
      roundConfig: { initialWaitTicks: 9999, intermissionTicks: 9999 } });
    const player = sim.getPlayer(sim.playerIds[0])!;
    sim.state.powerups.instaKillTicksRemaining = 2;
    const first = createZombieState('e:99', { x: 0, y: 0, z: -3 }, 12);
    addEntity(sim.state.world, first);
    const fire = createInputFrame(0);
    fire.actions.fire = { held: true, pressed: true, released: false, value: 1 };
    sim.tick({ [player.id]: fire });
    expect(first.alive).toBe(false);
    player.weapon.cooldownTicks = 0;
    const second = createZombieState('e:100', { x: 0, y: 0, z: -3 }, 12);
    const secondHealth = second.health;
    addEntity(sim.state.world, second);
    sim.tick({ [player.id]: fire });
    expect(second.alive).toBe(true);
    expect(second.health).toBe(secondHealth - 100);
  });

  it('detonates a Nuke before zombie attacks and awards a flat team bonus', () => {
    const sim = new GameSimulation({ seed: 17,
      playerSpawns: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }],
      map: { collisionBoxes: [], walkSurfaces: [], zombieSpawns: [] },
      roundConfig: { initialWaitTicks: 9999, intermissionTicks: 9999 } });
    sim.state.powerups.drops.push({ id: 'p:1', kind: 'nuke',
      position: { x: 0, y: 0, z: 0 }, ticksRemaining: 900 });
    const zombies = [createZombieState('e:99', { x: 0, y: 0, z: -2 }, 10),
      createZombieState('e:100', { x: 0, y: 0, z: -3 }, 10)];
    for (const zombie of zombies) addEntity(sim.state.world, zombie);
    const events = sim.tick();
    expect(events).toContainEqual({ type: 'nukeDetonated', dropId: 'p:1', killed: 2 });
    expect(events.filter(event => event.type === 'pointsAwarded')).toMatchObject([
      { playerId: sim.playerIds[0], amount: 400, reason: 'nuke' },
      { playerId: sim.playerIds[1], amount: 400, reason: 'nuke' },
    ]);
    expect(events.some(event => event.type === 'zombieAttacked' || event.type === 'zombieDied')).toBe(false);
    expect(zombies.every(zombie => !zombie.alive && zombie.health === 0)).toBe(true);
    expect(sim.playerIds.map(id => sim.getPlayer(id)!.points)).toEqual([900, 900]);
  });
});

describe('classic power-up drop rules', () => {
  const noLuck: PowerupConfig = { ...DEFAULT_POWERUP_CONFIG, randomDropPercent: 0 };

  it('arms a guaranteed drop each time the team earns past a threshold that grows 14%', () => {
    const state = createPowerupState(500);
    const player = createPlayerState('e:1', { x: 0, y: 0, z: 0 });
    const zombie = createZombieState('e:9', { x: 0, y: 0, z: 0 }, 1);
    expect(state.scoreToDrop).toBe(2500);
    player.pointsEarned = 2500;
    updatePowerupThreshold(state, [player], noLuck);
    expect(state.dropArmed).toBe(false);
    expect(tryDropPowerup(state, zombie, [], 1, 1, noLuck)).toEqual([]);
    player.pointsEarned = 2510;
    updatePowerupThreshold(state, [player], noLuck);
    expect(state.dropArmed).toBe(true);
    expect(state.dropIncrement).toBeCloseTo(2280);
    expect(state.scoreToDrop).toBeCloseTo(4790);
    expect(tryDropPowerup(state, zombie, [], 1, 2, noLuck)).toHaveLength(1);
    expect(state.dropArmed).toBe(false);
    expect(tryDropPowerup(state, zombie, [], 1, 3, noLuck)).toEqual([]);
  });

  it('gives about a 3% chance per kill before the threshold', () => {
    let drops = 0;
    for (let i = 1; i <= 4000; i++) {
      const state = createPowerupState(500);
      drops += tryDropPowerup(state, createZombieState(`e:${i}`, { x: 0, y: 0, z: 0 }, 1), [], 77, i).length;
    }
    expect(drops / 4000).toBeGreaterThan(0.02);
    expect(drops / 4000).toBeLessThan(0.04);
  });

  it('deals every kind once before any repeats, from a seeded shuffle', () => {
    const always: PowerupConfig = { ...DEFAULT_POWERUP_CONFIG, randomDropPercent: 100, maxDropsPerRound: 99 };
    const deal = (seed: number) => {
      const state = createPowerupState();
      const zombie = createZombieState('e:9', { x: 0, y: 0, z: 0 }, 1);
      return Array.from({ length: 8 }, (_, i) => tryDropPowerup(state, zombie, [], seed, i, always)[0])
        .map(event => event.type === 'powerupSpawned' ? event.kind : null);
    };
    const kinds = deal(1234);
    expect(new Set(kinds.slice(0, 4)).size).toBe(4);
    expect(new Set(kinds.slice(4)).size).toBe(4);
    expect(deal(1234)).toEqual(kinds);
  });

  it('arms drops from real points earned through the simulation, not the spendable balance', () => {
    const sim = new GameSimulation({ seed: 3, playerSpawns: [{ x: 0, y: 0, z: 0 }],
      map: { collisionBoxes: [], walkSurfaces: [], zombieSpawns: [] }, powerupConfig: noLuck,
      roundConfig: { initialWaitTicks: 9999, intermissionTicks: 9999 } });
    const player = sim.getPlayer(sim.playerIds[0])!;
    player.points = 0;
    player.pointsEarned = 2505;
    player.weapon = createWeaponState('kar98k');
    addEntity(sim.state.world, createZombieState('e:99', { x: 0, y: 0, z: -3 }, 1));
    const fire = createInputFrame(0);
    fire.actions.fire = { held: true, pressed: true, released: false, value: 1 };
    const events = sim.tick({ [player.id]: fire });
    expect(player.pointsEarned).toBeGreaterThan(2500);
    expect(events.map(event => event.type)).toContain('powerupSpawned');
  });

  it('Max Ammo also refills grenades', () => {
    const state = createPowerupState(), zombie = createZombieState('e:9', { x: 0, y: 0, z: 0 }, 1);
    tryDropPowerup(state, zombie, [], 42, 1, forced);
    const player = createPlayerState('e:1', { x: 0, y: 0, z: 0 });
    player.grenadeCharges = 0;
    collectPowerups(state, [player], [], forced);
    expect(player.grenadeCharges).toBe(4);
  });
});

describe('Carpenter', () => {
  const window = (n: number) => createBarrier({ id: `w${n}`, position: { x: n * 3, y: 0, z: 0 },
    outward: { x: 0, y: 0, z: -1 }, width: 2, maxBoards: 6,
    approachPath: [{ x: n * 3, y: 0, z: -5 }, { x: n * 3, y: 0, z: -1 }],
    insidePoint: { x: n * 3, y: 0, z: 1 } }, `e:${20 + n}`).state;
  const windows = (count: number, broken: number) => {
    const barriers = Array.from({ length: count }, (_, n) => window(n));
    barriers.slice(0, broken).forEach(barrier => { barrier.boards = 0; });
    return barriers;
  };
  const carpenterOnly: PowerupConfig = { ...DEFAULT_POWERUP_CONFIG, randomDropPercent: 100, maxDropsPerRound: 99,
    kinds: ['carpenter', 'maxAmmo'] };
  const dealt = (barriers: ReturnType<typeof windows>, drops: number) => {
    const state = createPowerupState(), zombie = createZombieState('e:9', { x: 0, y: 0, z: 0 }, 1);
    for (let i = 0; i < drops; i++) tryDropPowerup(state, zombie, barriers, 77, i, carpenterOnly);
    return state.drops.map(drop => drop.kind);
  };

  it('never drops until five barriers have lost every board', () => {
    expect(dealt(windows(8, 4), 12)).not.toContain('carpenter');
    // Torn but not stripped bare does not count.
    const torn = windows(8, 4); torn[5].boards = 1;
    expect(dealt(torn, 12)).not.toContain('carpenter');
    expect(dealt(windows(8, 5), 12)).toContain('carpenter');
  });

  it('asks for every barrier on a map with fewer than five, and does not spend a drop when it must pass', () => {
    expect(dealt(windows(3, 2), 6)).toEqual(['maxAmmo', 'maxAmmo', 'maxAmmo', 'maxAmmo', 'maxAmmo', 'maxAmmo']);
    expect(dealt(windows(3, 3), 6)).toContain('carpenter');
    const onlyCarpenter: PowerupConfig = { ...carpenterOnly, kinds: ['carpenter'] };
    const state = createPowerupState(), zombie = createZombieState('e:9', { x: 0, y: 0, z: 0 }, 1);
    expect(tryDropPowerup(state, zombie, windows(8, 1), 77, 1, onlyCarpenter)).toEqual([]);
    expect(state.dropsThisRound).toBe(0);
  });

  it('rebuilds every damaged barrier to full when collected and reports how many', () => {
    const barriers = windows(8, 5); barriers[6].boards = 2;
    barriers[0].repairTicks = 30; barriers[0].repairerId = 'e:1';
    const state = createPowerupState();
    state.drops.push({ id: 'p:1', kind: 'carpenter', position: { x: 0, y: 0, z: 0 }, ticksRemaining: 900 });
    const player = createPlayerState('e:1', { x: 0, y: 0, z: 0 });
    const events = collectPowerups(state, [player], [], carpenterOnly, [], barriers);
    expect(events).toEqual([{ type: 'carpenterRepaired', dropId: 'p:1', repaired: 6 },
      { type: 'powerupCollected', dropId: 'p:1', kind: 'carpenter', playerId: 'e:1' }]);
    expect(barriers.every(barrier => barrier.boards === barrier.maxBoards)).toBe(true);
    expect(barriers[0]).toMatchObject({ repairTicks: 0, repairerId: null });
  });

  it('pays 200 to every player on their feet, through the simulation', () => {
    const map = { collisionBoxes: [], walkSurfaces: [], zombieSpawns: [] };
    const sim = new GameSimulation({ seed: 17, map,
      playerSpawns: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }],
      roundConfig: { initialWaitTicks: 9999, intermissionTicks: 9999 } });
    const down = sim.getPlayer(sim.playerIds[2])!;
    damagePlayer(down, 500);
    expect(down.downed).not.toBeNull();
    sim.state.powerups.drops.push({ id: 'p:1', kind: 'carpenter', position: { x: 0, y: 0, z: 0 }, ticksRemaining: 900 });
    const before = sim.playerIds.map(id => sim.getPlayer(id)!.points);
    const events = sim.tick();
    expect(events).toContainEqual(expect.objectContaining({ type: 'carpenterRepaired', repaired: 0 }));
    expect(events.filter(event => event.type === 'pointsAwarded')).toMatchObject([
      { playerId: sim.playerIds[0], amount: 200, reason: 'carpenter' },
      { playerId: sim.playerIds[1], amount: 200, reason: 'carpenter' },
    ]);
    expect(sim.playerIds.map(id => sim.getPlayer(id)!.points)).toEqual([before[0] + 200, before[1] + 200, before[2]]);
  });
});
