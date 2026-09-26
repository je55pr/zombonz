import { describe, expect, it } from 'vitest';
import { collectPowerups, createBarrier, createPlayerState, createPowerupState, createWeaponState,
  createZombieState, tickPowerupLifetime, tryDropPowerup, GameSimulation, createInputFrame,
  addEntity, DEFAULT_POWERUP_CONFIG, type PowerupConfig } from '../src/core/index.ts';

const forced: PowerupConfig = { ...DEFAULT_POWERUP_CONFIG, dropChanceDenominator: 1,
  minimumTicksBetweenDrops: 600, kinds: ['maxAmmo'] };

describe('timed power-ups', () => {
  it('drops deterministically and respects active-drop and time spacing limits', () => {
    const first = createPowerupState(), second = createPowerupState();
    const zombie = createZombieState('e:9', { x: 4, y: 0, z: 3 }, 1);
    const spawn = tryDropPowerup(first, zombie, [], 123, 100, forced);
    expect(spawn).toEqual(tryDropPowerup(second, zombie, [], 123, 100, forced));
    expect(spawn).toMatchObject([{ type: 'powerupSpawned', dropId: 'p:1', kind: 'maxAmmo' }]);
    expect(tryDropPowerup(first, zombie, [], 123, 100, forced)).toEqual([]);
    first.drops = [];
    expect(tryDropPowerup(first, zombie, [], 123, 699, forced)).toEqual([]);
    expect(tryDropPowerup(first, zombie, [], 123, 700, forced)).toMatchObject([{ dropId: 'p:2' }]);
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
    expect(sim.state.powerups).toEqual(createPowerupState());
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
});
