import { describe, expect, it } from 'vitest';
import {
  GameSimulation, MELEE_RULES, addEntity, beginMelee, createInputFrame, createPlayerState, createZombieState, damagePlayer,
  type SimulationEvent,
} from '../src/core/index.ts';
import { predictPlayerTick } from '../src/net/prediction.ts';

const origin = { x: 0, y: 0, z: 0 };
const press = (action: 'melee' | 'throwGrenade' | 'placeMine') => {
  const frame = createInputFrame(0);
  frame.actions[action] = { held: true, pressed: true, released: false, value: 1 };
  return frame;
};

function world() {
  const sim = new GameSimulation({ seed: 5, map: { collisionBoxes: [], walkSurfaces: [], zombieSpawns: [] },
    playerSpawns: [origin], roundConfig: { initialWaitTicks: 9999, intermissionTicks: 9999 } });
  const player = sim.getPlayer(sim.playerIds[0])!;
  return { sim, player };
}
const types = (events: SimulationEvent[]) => events.map(event => event.type);

describe('a knife swing and the blow that lands at its strike point', () => {
  it('announces the swing at once and lands the blow strikeTicks later, not before', () => {
    const { sim, player } = world();
    const target = createZombieState('e:99', { x: 0, y: 0, z: -1.2 }, 1);
    addEntity(sim.state.world, target);
    const first = sim.tick({ [player.id]: press('melee') });
    expect(types(first)).toContain('meleeSwung');
    expect(types(first)).not.toContain('meleeHit');
    expect(target.health).toBe(150);
    const landed: number[] = [];
    for (let tick = 1; tick <= MELEE_RULES.cooldownTicks; tick++) {
      if (types(sim.tick()).includes('meleeHit')) landed.push(tick);
    }
    expect(landed).toEqual([MELEE_RULES.strikeTicks]);
    expect(target.alive).toBe(false);
    expect(player.meleeCooldownTicks).toBe(0);
    expect(player.meleeStrikeTicks).toBe(0);
  });

  it('pays for the kill when the blow lands, not when the button went down', () => {
    const { sim, player } = world();
    addEntity(sim.state.world, createZombieState('e:99', { x: 0, y: 0, z: -1.2 }, 1));
    sim.tick({ [player.id]: press('melee') });
    for (let tick = 1; tick < MELEE_RULES.strikeTicks; tick++) { sim.tick(); expect(player.points).toBe(500); }
    sim.tick();
    expect(player.points).toBe(630);
  });

  it('reads reach and facing when the blow lands: a zombie that steps out is missed, one that steps in is hit', () => {
    const outside = world(), inside = world();
    const leaving = createZombieState('e:98', { x: 0, y: 0, z: -1.2 }, 1), arriving = createZombieState('e:99', { x: 0, y: 0, z: -3 }, 1);
    addEntity(outside.sim.state.world, leaving); addEntity(inside.sim.state.world, arriving);
    outside.sim.tick({ [outside.player.id]: press('melee') }); inside.sim.tick({ [inside.player.id]: press('melee') });
    leaving.position = { x: 0, y: 0, z: -3 }; arriving.position = { x: 0, y: 0, z: -1.2 };
    const before = [leaving.health, arriving.health];
    const all: SimulationEvent[] = [];
    for (let tick = 1; tick <= MELEE_RULES.strikeTicks; tick++) { all.push(...outside.sim.tick(), ...inside.sim.tick()); }
    expect(before).toEqual([150, 150]);
    expect(leaving.health).toBe(150);
    expect(arriving.alive).toBe(false);
    expect(all.filter(event => event.type === 'meleeHit')).toHaveLength(1);
  });

  it('lands nothing if the target died to someone else in the meantime', () => {
    const { sim, player } = world();
    const target = createZombieState('e:99', { x: 0, y: 0, z: -1.2 }, 1);
    addEntity(sim.state.world, target);
    sim.tick({ [player.id]: press('melee') });
    target.alive = false; target.health = 0;
    const events: SimulationEvent[] = [];
    for (let tick = 1; tick <= MELEE_RULES.strikeTicks; tick++) events.push(...sim.tick());
    expect(types(events)).not.toContain('meleeHit');
    expect(player.points).toBe(500);
  });

  it('lands nothing if the player is downed before the blow', () => {
    const { sim, player } = world();
    addEntity(sim.state.world, createZombieState('e:99', { x: 0, y: 0, z: -1.2 }, 1));
    sim.tick({ [player.id]: press('melee') });
    damagePlayer(player, 500);
    expect(player.downed).not.toBeNull();
    const events: SimulationEvent[] = [];
    for (let tick = 1; tick <= MELEE_RULES.strikeTicks + 2; tick++) events.push(...sim.tick());
    expect(types(events)).not.toContain('meleeHit');
    expect(player.meleeStrikeTicks).toBe(0);
  });

  it('cannot start another swing until the last has finished, and can then', () => {
    const player = createPlayerState('e:1', origin);
    expect(types(beginMelee(player) as never)).toEqual(['meleeSwung']);
    for (let tick = 0; tick < MELEE_RULES.cooldownTicks - 1; tick++) {
      player.meleeCooldownTicks -= 1;
      expect(beginMelee(player)).toEqual([]);
    }
    player.meleeCooldownTicks -= 1;
    expect(beginMelee(player)).toHaveLength(1);
  });

  it('cancels a reload when it starts, and blocks a grenade or a Bouncing Betty until it is over', () => {
    const { sim, player } = world();
    player.mineCharges = 2;
    player.weapon.reloadTicksRemaining = 40;
    sim.tick({ [player.id]: press('melee') });
    expect(player.weapon.reloadTicksRemaining).toBe(0);
    const charges = player.grenadeCharges;
    const events: SimulationEvent[] = [
      ...sim.tick({ [player.id]: press('throwGrenade') }), ...sim.tick({ [player.id]: press('placeMine') })];
    for (let tick = 0; tick < MELEE_RULES.cooldownTicks; tick++) events.push(...sim.tick());
    expect(player.grenadeCharges).toBe(charges);
    expect(player.mineCharges).toBe(2);
    expect(types(events)).not.toContain('grenadeThrown');
    expect(types(events)).not.toContain('minePlaced');
  });

  it('keeps its timing on a client that predicts it, and announces the swing once', () => {
    const player = createPlayerState('e:1', origin);
    const worldForClient = { collision: () => [], walkSurfaces: [], shotBlockers: [] };
    const first = predictPlayerTick(player, press('melee'), worldForClient, 1);
    expect(types(first)).toEqual(['meleeSwung']);
    expect(player.meleeStrikeTicks).toBe(MELEE_RULES.strikeTicks);
    const rest: SimulationEvent[] = [];
    for (let tick = 1; tick <= MELEE_RULES.cooldownTicks; tick++) {
      rest.push(...predictPlayerTick(player, tick === 3 ? press('melee') : createInputFrame(tick), worldForClient, 1));
      if (tick === MELEE_RULES.strikeTicks) expect(player.meleeStrikeTicks).toBe(0);
    }
    expect(rest).toEqual([]);
    expect(player.meleeCooldownTicks).toBe(0);
  });

  it('runs a swing the same way twice', () => {
    const run = () => {
      const { sim, player } = world();
      addEntity(sim.state.world, createZombieState('e:99', { x: 0, y: 0, z: -1.2 }, 1));
      const events = [sim.tick({ [player.id]: press('melee') })];
      for (let tick = 0; tick < 60; tick++) events.push(sim.tick());
      return { state: sim.state, events };
    };
    const a = run(), b = run();
    expect(a.state).toEqual(b.state);
    expect(a.events).toEqual(b.events);
  });
});
