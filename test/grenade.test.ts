import { describe, expect, it } from 'vitest';
import { createGrenadePool, createPlayerState, createZombieState, throwGrenade, tickGrenades,
  GameSimulation, createInputFrame, addEntity, GRENADE_RULES } from '../src/core/index.ts';
import { BrowserInput } from '../src/client/input.ts';

describe('fixed-tick grenades', () => {
  it('keeps one held grenade through wind-up and cancels it on weapon switch', () => {
    const sim = new GameSimulation({ seed: 5, playerSpawns: [{ x: 0, y: 0, z: 0 }],
      map: { collisionBoxes: [], walkSurfaces: [], zombieSpawns: [] },
      roundConfig: { initialWaitTicks: 9999, intermissionTicks: 1 } });
    const player = sim.getPlayer(sim.playerIds[0])!;
    const press = createInputFrame(0);
    press.actions.throwGrenade = { held: true, pressed: true, released: false, value: 1 };
    sim.tick({ [player.id]: press });
    for (let i = 0; i < 5; i++) sim.tick({ [player.id]: press });
    expect(sim.state.grenades.active).toHaveLength(0);
    expect(player.grenadeCharges).toBe(2);
    const switchFrame = createInputFrame(1);
    switchFrame.actions.switchWeapon = { held: true, pressed: true, released: false, value: 1 };
    sim.tick({ [player.id]: switchFrame });
    expect(player.grenadeWindupTicks).toBe(0);
    for (let i = 0; i < GRENADE_RULES.windupTicks; i++) sim.tick();
    expect(sim.state.grenades.active).toHaveLength(0);
    expect(player.grenadeCharges).toBe(2);
  });

  it('cancels a pending throw when the online pause menu sends cancellation', () => {
    const sim = new GameSimulation({ seed: 8, playerSpawns: [{ x: 0, y: 0, z: 0 }],
      map: { collisionBoxes: [], walkSurfaces: [], zombieSpawns: [] },
      roundConfig: { initialWaitTicks: 9999, intermissionTicks: 1 } });
    const player = sim.getPlayer(sim.playerIds[0])!;
    const throwFrame = createInputFrame(0);
    throwFrame.actions.throwGrenade = { held: true, pressed: true, released: false, value: 1 };
    sim.tick({ [player.id]: throwFrame });
    const paused = createInputFrame(1);
    paused.actions.cancelGrenade = { held: false, pressed: true, released: false, value: 0 };
    sim.tick({ [player.id]: paused });
    for (let i = 0; i < GRENADE_RULES.windupTicks; i++) sim.tick();
    expect(player.grenadeWindupTicks).toBe(0);
    expect(sim.state.grenades.active).toHaveLength(0);
    expect(player.grenadeCharges).toBe(2);
  });

  it('throws at most two serializable grenades and spends one charge per press', () => {
    const pool = createGrenadePool(), player = createPlayerState('e:1', { x: 0, y: 0, z: 0 });
    expect(throwGrenade(pool, player)).toMatchObject([{ type: 'grenadeThrown', grenadeId: 'g:1' }]);
    expect(throwGrenade(pool, player)).toMatchObject([{ type: 'grenadeThrown', grenadeId: 'g:2' }]);
    expect(throwGrenade(pool, player)).toEqual([]);
    expect(player.grenadeCharges).toBe(0);
    expect(JSON.parse(JSON.stringify(pool))).toEqual(pool);
    expect(pool.active[0]).toMatchObject({ fuseTicksRemaining: 120, velocity: { z: -9 } });
  });

  it('blocks blast damage through walls but hurts visible zombies and the thrower', () => {
    const pool = createGrenadePool(), owner = createPlayerState('e:1', { x: 0, y: 0, z: 0 });
    pool.active.push({ id: 'g:1', ownerId: owner.id, position: { x: 0, y: 0.1, z: 0 },
      velocity: { x: 0, y: 0, z: 0 }, fuseTicksRemaining: 1 });
    const visible = createZombieState('e:2', { x: 0, y: 0, z: -2 }, 1);
    const hidden = createZombieState('e:3', { x: 2, y: 0, z: 0 }, 1);
    const wall = [{ min: { x: 0.8, y: 0, z: -1 }, max: { x: 1.2, y: 2, z: 1 } }];
    const events = tickGrenades(pool, [visible, hidden], [owner], wall, [], 1 / 60);
    expect(events).toContainEqual(expect.objectContaining({ type: 'grenadeExploded', grenadeId: 'g:1' }));
    expect(visible.alive).toBe(false);
    expect(hidden.health).toBe(150);
    expect(owner.health).toBeLessThan(100);
    expect(pool.active).toEqual([]);
  });

  it('applies Insta-Kill through an unobstructed grenade blast', () => {
    const pool = createGrenadePool(), owner = createPlayerState('e:1', { x: 10, y: 0, z: 0 });
    pool.active.push({ id: 'g:1', ownerId: owner.id, position: { x: 0, y: 0.1, z: 0 },
      velocity: { x: 0, y: 0, z: 0 }, fuseTicksRemaining: 1 });
    const zombie = createZombieState('e:2', { x: 0, y: 0, z: -2 }, 12);
    tickGrenades(pool, [zombie], [owner], [], [], 1 / 60, true);
    expect(zombie.alive).toBe(false);
  });

  it('replays a thrown arc and two-second fuse identically', () => {
    const run = () => {
      const pool = createGrenadePool(), player = createPlayerState('e:1', { x: 0, y: 0, z: 0 });
      throwGrenade(pool, player);
      const positions = [];
      const events = [];
      for (let i = 0; i < 120; i++) {
        events.push(...tickGrenades(pool, [], [player], [], [], 1 / 60));
        if (pool.active[0]) positions.push({ ...pool.active[0].position });
      }
      return { pool, positions, events, health: player.health };
    };
    const first = run(), second = run();
    expect(first).toEqual(second);
    expect(first.positions[0].y).toBeGreaterThan(1.3);
    expect(first.events.filter(event => event.type === 'grenadeExploded')).toHaveLength(1);
    expect(first.pool.active).toEqual([]);
  });

  it('awards grenade kills through simulation and adds two charges per new round up to four', () => {
    const sim = new GameSimulation({ seed: 5, playerSpawns: [{ x: 0, y: 0, z: 0 }],
      map: { collisionBoxes: [], walkSurfaces: [], zombieSpawns: [] },
      roundConfig: { initialWaitTicks: 9999, intermissionTicks: 1 } });
    const player = sim.getPlayer(sim.playerIds[0])!;
    const frame = createInputFrame(0);
    frame.actions.throwGrenade = { held: true, pressed: true, released: false, value: 1 };
    expect(sim.tick({ [player.id]: frame }).map(event => event.type)).not.toContain('grenadeThrown');
    expect(player.grenadeWindupTicks).toBe(GRENADE_RULES.windupTicks - 1);
    for (let i = 1; i < GRENADE_RULES.windupTicks - 1; i++) sim.tick();
    expect(sim.state.grenades.active).toHaveLength(0);
    expect(sim.tick().map(event => event.type)).toContain('grenadeThrown');
    expect(player.grenadeCharges).toBe(1);
    sim.state.grenades.active = [{ id: 'g:99', ownerId: player.id,
      position: { x: 0, y: 0.1, z: -3 }, velocity: { x: 0, y: 0, z: 0 }, fuseTicksRemaining: 1 }];
    const zombie = createZombieState('e:99', { x: 0, y: 0, z: -4 }, 1);
    addEntity(sim.state.world, zombie);
    const events = sim.tick();
    expect(zombie.alive).toBe(false);
    expect(events).toContainEqual(expect.objectContaining({ type: 'pointsAwarded', reason: 'kill', playerId: player.id }));
    // Each new round adds two frags, up to four carried.
    Object.assign(sim.state.round, { round: 1, phase: 'intermission', phaseTicks: 0 });
    sim.tick();
    expect(sim.state.round.round).toBe(2);
    expect(player.grenadeCharges).toBe(3);
    Object.assign(sim.state.round, { phase: 'intermission', phaseTicks: 0 });
    sim.tick();
    expect(player.grenadeCharges).toBe(4);
    sim.restart();
    expect(sim.state.grenades).toEqual(createGrenadePool());
    expect(sim.getPlayer(sim.playerIds[0])!.grenadeCharges).toBe(2);
  });

  it('maps T to a single throw per physical key press', () => {
    const target = new EventTarget(), surface = new EventTarget();
    const input = new BrowserInput({ pointerElement: surface as HTMLElement }, target as Window);
    target.dispatchEvent(Object.assign(new Event('keydown'), { code: 'KeyT', repeat: false }));
    expect(input.consume().actions.throwGrenade?.pressed).toBe(true);
    target.dispatchEvent(Object.assign(new Event('keydown'), { code: 'KeyT', repeat: true }));
    expect(input.consume().actions.throwGrenade?.pressed).toBe(false);
    input.dispose();
  });
});
