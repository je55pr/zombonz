import { describe, expect, it } from 'vitest';
import { createGrenadePool, createPlayerState, createZombieState, throwGrenade, tickGrenades,
  GameSimulation, createInputFrame, addEntity } from '../src/core/index.ts';
import { BrowserInput } from '../src/client/input.ts';

describe('fixed-tick grenades', () => {
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

  it('awards grenade kills through simulation and replenishes charges on a new round', () => {
    const sim = new GameSimulation({ seed: 5, playerSpawns: [{ x: 0, y: 0, z: 0 }],
      map: { collisionBoxes: [], walkSurfaces: [], zombieSpawns: [] },
      roundConfig: { initialWaitTicks: 9999, intermissionTicks: 1 } });
    const player = sim.getPlayer(sim.playerIds[0])!;
    const frame = createInputFrame(0);
    frame.actions.throwGrenade = { held: true, pressed: true, released: false, value: 1 };
    expect(sim.tick({ [player.id]: frame }).map(event => event.type)).toContain('grenadeThrown');
    expect(player.grenadeCharges).toBe(1);
    sim.state.grenades.active = [{ id: 'g:99', ownerId: player.id,
      position: { x: 0, y: 0.1, z: -3 }, velocity: { x: 0, y: 0, z: 0 }, fuseTicksRemaining: 1 }];
    const zombie = createZombieState('e:99', { x: 0, y: 0, z: -4 }, 1);
    addEntity(sim.state.world, zombie);
    const events = sim.tick();
    expect(zombie.alive).toBe(false);
    expect(events).toContainEqual(expect.objectContaining({ type: 'pointsAwarded', reason: 'kill', playerId: player.id }));
    sim.state.round.phase = 'intermission'; sim.state.round.phaseTicks = 0;
    sim.tick();
    expect(player.grenadeCharges).toBe(2);
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
