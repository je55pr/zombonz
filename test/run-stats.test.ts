import { describe, expect, it } from 'vitest';
import { addEntity, createInputFrame, createZombieState, GameSimulation } from '../src/core/index.ts';

describe('solo run statistics', () => {
  it('credits the killing player once, distinguishes headshots, and resets on restart', () => {
    const sim = new GameSimulation({ seed: 25,
      map: { collisionBoxes: [], walkSurfaces: [], zombieSpawns: [] },
      playerSpawns: [{ x: 0, y: 0, z: 0 }],
      roundConfig: { initialWaitTicks: 9999, intermissionTicks: 9999 },
    });
    const id = sim.playerIds[0], player = sim.getPlayer(id)!;
    const fire = createInputFrame(0);
    fire.actions.fire = { held: true, pressed: true, released: false, value: 1 };

    const head = createZombieState('e:99', { x: 0, y: 0, z: -3 }, 1);
    head.health = 1; addEntity(sim.state.world, head);
    sim.tick({ [id]: fire });
    expect(player).toMatchObject({ kills: 1, headshots: 1 });

    player.weapon.cooldownTicks = 0;
    player.pitch = -0.1;
    const body = createZombieState('e:100', { x: 0, y: 0, z: -3 }, 1);
    body.health = 1; addEntity(sim.state.world, body);
    sim.tick({ [id]: fire });
    expect(player).toMatchObject({ kills: 2, headshots: 1 });
    sim.tick();
    expect(player.kills).toBe(2);

    sim.restart();
    expect(sim.getPlayer(id)).toMatchObject({ kills: 0, headshots: 0 });
  });
});
