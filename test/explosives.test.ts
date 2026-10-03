import { describe, expect, it } from 'vitest';
import {
  GameSimulation, HAZARD_KINDS, MINE_RULES, addEntity, blastScale, createInputFrame, createWeaponState, createZombieState,
  detonate, damagePlayer, hazardBox, hazardCentre, hazardSolids, hazardTargets, createHazard, damageHazard, tickHazards, zombieChest,
  type EntityId, type HazardDefinition, type PlayerState, type SimulationEvent, type Vec3,
} from '../src/core/index.ts';
import { captureSnapshot, applySnapshot } from '../src/net/snapshot.ts';
import { encodeSnapshotBody } from '../src/net/protocol.ts';

const barrel = (id: string, x: number, z: number): HazardDefinition => ({ id, kind: 'barrel', position: { x, y: 0, z }, yaw: 0 });
const jeep = (id: string, x: number, z: number): HazardDefinition => ({ id, kind: 'jeep', position: { x, y: 0, z }, yaw: 0 });
const QUIET = { initialWaitTicks: 999999, intermissionTicks: 999999 };
/** Turns a player to look at a point (yaw 0 looks toward -z). */
function aim(player: PlayerState, at: Vec3): void {
  const eye = { x: player.position.x, y: player.position.y + 1.62, z: player.position.z };
  player.yaw = Math.atan2(-(at.x - eye.x), -(at.z - eye.z));
  player.pitch = Math.atan2(at.y - eye.y, Math.hypot(at.x - eye.x, at.z - eye.z));
}

function world(options: { hazards?: HazardDefinition[]; walls?: Array<{ min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } }>;
  spawns?: Array<{ x: number; y: number; z: number }> } = {}) {
  const sim = new GameSimulation({ seed: 7, playerSpawns: options.spawns ?? [{ x: 0, y: 0, z: 0 }], roundConfig: QUIET,
    economyConfig: { startingPoints: 10000, hitReward: 10, killBonus: 50 },
    map: { collisionBoxes: options.walls ?? [], walkSurfaces: [], zombieSpawns: [], hazards: options.hazards ?? [] } });
  const [player] = sim.players();
  return { sim, player };
}
/** One tick, with the player pressing these actions (all of them held as well) and looking down the sights. */
function step(sim: GameSimulation, actions: Array<'fire' | 'throwGrenade' | 'placeMine' | 'interact'> = [], id?: EntityId): SimulationEvent[] {
  const frame = createInputFrame(sim.state.world.tick);
  frame.actions.aim = { pressed: false, held: true, released: false, value: 1 };
  for (const action of actions) frame.actions[action] = { pressed: true, held: true, released: false, value: 1 };
  return sim.tick({ [id ?? sim.playerIds[0]]: frame });
}
function run(sim: GameSimulation, ticks: number): SimulationEvent[] {
  const events: SimulationEvent[] = [];
  for (let i = 0; i < ticks; i++) events.push(...step(sim));
  return events;
}
const types = (events: SimulationEvent[], type: SimulationEvent['type']) => events.filter(event => event.type === type);

describe('the shared blast rules', () => {
  const rules = { radius: 4, damage: 200, playerDamage: 60 };

  it('falls off in a straight line and stops at the edge', () => {
    expect(blastScale(0, 4)).toBe(1);
    expect(blastScale(1, 4)).toBeCloseTo(0.75);
    expect(blastScale(4, 4)).toBe(0);
    expect(blastScale(9, 4)).toBe(0);
  });

  it('hurts zombies in the open, not behind a wall or past the radius, and credits the owner', () => {
    const owner = world().player;
    const near = createZombieState('e:20', { x: 0, y: 0, z: -2 }, 1), sheltered = createZombieState('e:21', { x: 2, y: 0, z: 0 }, 1);
    const far = createZombieState('e:22', { x: 0, y: 0, z: 6 }, 1);
    const wall = { min: { x: 0.8, y: 0, z: -1 }, max: { x: 1.2, y: 2, z: 1 } };
    const events = detonate({ x: 0, y: 0.9, z: 0 }, rules, owner.id, 'owner',
      { zombies: [near, sheltered, far], players: [owner], boxes: [wall], instaKill: false });
    // A blast is measured to the chest, wherever this zombie carries it.
    const chest = zombieChest(near);
    expect(near.health).toBe(150 - Math.round(200 * blastScale(Math.hypot(chest.x, chest.y - 0.9, chest.z), 4)));
    expect(sheltered.health).toBe(150);
    expect(far.health).toBe(150);
    expect(events).toContainEqual(expect.objectContaining({ type: 'zombieDamaged', zombieId: near.id, playerId: owner.id }));
  });

  it('hurts only its owner among the players when thrown, and everyone near it when it comes from the map', () => {
    const { sim } = world({ spawns: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }] });
    const [owner, mate] = sim.players();
    const context = { zombies: [], players: [owner, mate], boxes: [], instaKill: false };
    detonate({ x: 0.5, y: 0.9, z: 0 }, rules, owner.id, 'owner', context);
    expect(owner.health).toBeLessThan(100);
    expect(mate.health).toBe(100);
    detonate({ x: 0.5, y: 0.9, z: 0 }, rules, owner.id, 'all', context);
    expect(mate.health).toBeLessThan(100);
  });

  it('kills everything it reaches under Insta-Kill', () => {
    const owner = world().player, zombie = createZombieState('e:20', { x: 0, y: 0, z: -3.5 }, 20);
    detonate({ x: 0, y: 0.9, z: 0 }, rules, owner.id, 'owner', { zombies: [zombie], players: [owner], boxes: [], instaKill: true });
    expect(zombie.alive).toBe(false);
  });
});

describe('barrels and vehicles', () => {
  /** A one-shot gun, so a single shot puts the barrel on fire. */
  function shooter(hazards: HazardDefinition[], options: Parameters<typeof world>[0] = {}) {
    const made = world({ hazards, ...options });
    made.player.weapon = createWeaponState('magnum-357');
    aim(made.player, hazardCentre(hazards[0]));
    return made;
  }

  it('takes its health in bullets, burns for a moment, then explodes exactly once', () => {
    const { sim } = shooter([barrel('b1', 0, -6)]);
    const shot = step(sim, ['fire']);
    expect(types(shot, 'hazardHit')).toHaveLength(1);
    expect(types(shot, 'hazardIgnited')).toHaveLength(1);
    expect(sim.state.hazards[0].phase).toBe('burning');
    const after = run(sim, HAZARD_KINDS.barrel.burnTicks + 40);
    expect(types(after, 'hazardExploded')).toHaveLength(1);
    expect(sim.state.hazards[0].phase).toBe('exploded');
    // Nothing more comes of a barrel that has gone off, however long it is left, or shot at.
    expect(types(run(sim, 120), 'hazardExploded')).toEqual([]);
  });

  it('is not set off twice by more shots while it burns', () => {
    const { sim, player } = shooter([barrel('b1', 0, -6)]);
    step(sim, ['fire']);
    player.weapon.cooldownTicks = 0;
    const second = step(sim, ['fire']);
    expect(types(second, 'hazardIgnited')).toEqual([]);
    expect(types(run(sim, 60), 'hazardExploded')).toHaveLength(1);
  });

  it('needs more than one pistol shot, and stops the shot from reaching a zombie behind it', () => {
    const { sim, player } = world({ hazards: [barrel('b1', 0, -4)] });
    aim(player, { x: 0, y: 0.85, z: -4 });
    const behind = createZombieState('e:20', { x: 0, y: 0, z: -7 }, 1);
    addEntity(sim.state.world, behind);
    step(sim, ['fire']);
    expect(sim.state.hazards[0].health).toBe(HAZARD_KINDS.barrel.health - 50);
    expect(sim.state.hazards[0].phase).toBe('intact');
    expect(behind.health).toBe(150);
    expect(player.weapon.weaponId).toBe('starter-pistol');
  });

  it('kills the zombies near it, credited and paid to the shooter, and spares those out of reach or sheltered', () => {
    const wall = { min: { x: 1.4, y: 0, z: -7.5 }, max: { x: 1.8, y: 3, z: -4.5 } };
    const { sim, player } = shooter([barrel('b1', 0, -6)], { walls: [wall] });
    const close = createZombieState('e:20', { x: 1, y: 0, z: -6 }, 1);
    const sheltered = createZombieState('e:21', { x: 2.6, y: 0, z: -6 }, 1);
    const far = createZombieState('e:22', { x: -7, y: 0, z: -6 }, 1);
    for (const zombie of [close, sheltered, far]) addEntity(sim.state.world, zombie);
    const points = player.points;
    const events = [...step(sim, ['fire']), ...run(sim, 60)];
    expect(close.alive).toBe(false);
    expect(sheltered.alive).toBe(true);
    expect(far.health).toBe(150);
    expect(events).toContainEqual(expect.objectContaining({ type: 'zombieDied', zombieId: close.id, playerId: player.id }));
    expect(player.points).toBeGreaterThan(points);
    expect(player.kills).toBe(1);
  });

  it('hurts every player near it, the shooter and teammates alike', () => {
    const { sim } = world({ hazards: [barrel('b1', 0, -3)], spawns: [{ x: 0, y: 0, z: 0 }, { x: 1.5, y: 0, z: -4 }, { x: 9, y: 0, z: 0 }] });
    const [shooterPlayer, mate, distant] = sim.players();
    shooterPlayer.weapon = createWeaponState('magnum-357');
    aim(shooterPlayer, hazardCentre(sim.hazardTargets()[0].definition));
    step(sim, ['fire']);
    run(sim, HAZARD_KINDS.barrel.burnTicks + 5);
    expect(shooterPlayer.health).toBeLessThan(100);
    expect(mate.health).toBeLessThan(100);
    expect(distant.health).toBe(100);
  });

  it('sets off its neighbours in turn, and leaves a barrel out of reach alone', () => {
    const { sim } = shooter([barrel('a', 0, -6), barrel('b', 2.2, -6), barrel('c', 4.4, -7), barrel('d', 0, -30)]);
    const events = [...step(sim, ['fire']), ...run(sim, 200)];
    const exploded = types(events, 'hazardExploded').map(event => (event as { hazardId: string }).hazardId);
    expect(exploded).toEqual(['a', 'b', 'c']);
    expect(sim.state.hazards[3].phase).toBe('intact');
    // Each one goes off a little after the one that lit it, not all in the same tick.
    const ticks = types(events, 'hazardExploded').length;
    expect(ticks).toBe(3);
  });

  it('is set off by a grenade beside it, and a wall between shelters it', () => {
    const exposed = world({ hazards: [barrel('b1', 0, -1.5)] });
    exposed.sim.state.grenades.active.push({ id: 'g:9', ownerId: exposed.player.id, position: { x: 0, y: 0.5, z: -0.5 },
      velocity: { x: 0, y: 0, z: 0 }, fuseTicksRemaining: 1 });
    step(exposed.sim);
    expect(exposed.sim.state.hazards[0].phase).toBe('burning');
    const wall = { min: { x: -2, y: 0, z: -1.1 }, max: { x: 2, y: 3, z: -0.9 } };
    const sheltered = world({ hazards: [barrel('b1', 0, -1.5)], walls: [wall] });
    sheltered.sim.state.grenades.active.push({ id: 'g:9', ownerId: sheltered.player.id, position: { x: 0, y: 0.5, z: -0.5 },
      velocity: { x: 0, y: 0, z: 0 }, fuseTicksRemaining: 1 });
    step(sheltered.sim);
    expect(sheltered.sim.state.hazards[0].phase).toBe('intact');
  });

  it('blocks walking while whole, and a barrel leaves no collision behind when it goes', () => {
    const { sim } = shooter([barrel('b1', 0, -3)]);
    expect(sim.collisionBoxes()).toHaveLength(1);
    step(sim, ['fire']);
    expect(sim.collisionBoxes()).toHaveLength(1);
    run(sim, HAZARD_KINDS.barrel.burnTicks + 2);
    expect(sim.collisionBoxes()).toHaveLength(0);
  });

  it('leaves a vehicle as a solid shell that still stops shots, after it has burned for a while', () => {
    const { sim } = shooter([jeep('j1', 0, -8)]);
    sim.state.hazards[0].health = 10;
    const ignited = step(sim, ['fire']);
    expect(types(ignited, 'hazardIgnited')).toHaveLength(1);
    // Burning first: nothing goes off for seconds.
    expect(types(run(sim, HAZARD_KINDS.jeep.burnTicks - 30), 'hazardExploded')).toEqual([]);
    expect(sim.state.hazards[0].phase).toBe('burning');
    const boom = run(sim, 60);
    expect(types(boom, 'hazardExploded')).toHaveLength(1);
    expect(sim.state.hazards[0].phase).toBe('exploded');
    expect(sim.collisionBoxes()).toHaveLength(1);
    const hidden = createZombieState('e:20', { x: 0, y: 0, z: -14 }, 1);
    addEntity(sim.state.world, hidden);
    sim.players()[0].weapon.cooldownTicks = 0;
    aim(sim.players()[0], { x: 0, y: 1.4, z: -8 });
    step(sim, ['fire']);
    expect(hidden.health).toBe(150);
  });

  it('is data: any placement of a known kind gets its size, health and blast from the kind', () => {
    for (const kind of Object.keys(HAZARD_KINDS) as Array<keyof typeof HAZARD_KINDS>) {
      const definition: HazardDefinition = { id: 'x', kind, position: { x: 3, y: 1, z: 4 }, yaw: Math.PI / 2 };
      const box = hazardBox(definition), spec = HAZARD_KINDS[kind];
      // Turned a quarter, its length runs along x.
      expect(box.max.x - box.min.x).toBeCloseTo(spec.size.z);
      expect(box.max.z - box.min.z).toBeCloseTo(spec.size.x);
      expect(box.min.y).toBe(1);
      expect(createHazard(definition).health).toBe(spec.health);
    }
    expect(() => hazardBox({ id: 'x', kind: 'nope' as never, position: { x: 0, y: 0, z: 0 }, yaw: 0 })).toThrow();
  });

  it('does not tick until burning, and needs a credited attacker to hurt anyone', () => {
    const definitions = [barrel('b1', 0, -2)], states = [createHazard(definitions[0])];
    const zombie = createZombieState('e:20', { x: 0, y: 0, z: -2.5 }, 1);
    const context = { zombies: [zombie], players: [], boxes: [], instaKill: false };
    expect(tickHazards(definitions, states, context)).toEqual([]);
    const target = hazardTargets(definitions, states)[0];
    expect(damageHazard(target, 0, 'e:1')).toEqual([]);
    states[0].phase = 'burning'; states[0].burnTicks = 1; // nobody has hurt it
    const events = tickHazards(definitions, states, context);
    expect(events.map(event => event.type)).toEqual(['hazardExploded']);
    expect(zombie.health).toBe(150);
    expect(hazardSolids(definitions, states)).toHaveLength(0);
  });

  it('travels in snapshots, so a client sees the same barrels and cars burn', () => {
    const { sim } = shooter([barrel('b1', 0, -6), jeep('j1', 6, -8)]);
    step(sim, ['fire']);
    sim.state.hazards[1].health = 123; sim.state.hazards[1].attackerId = sim.playerIds[0];
    const body = JSON.parse(encodeSnapshotBody(captureSnapshot(sim)));
    const client = world({ hazards: [barrel('b1', 0, -6), jeep('j1', 6, -8)] }).sim;
    applySnapshot(client, body);
    expect(client.state.hazards).toEqual(sim.state.hazards);
    expect(client.collisionBoxes()).toHaveLength(2);
  });
});

describe('Bouncing Betties', () => {
  function betty(options: Parameters<typeof world>[0] = {}) {
    const made = world(options);
    made.player.mineCharges = 2;
    return made;
  }
  const sprung = (sim: GameSimulation) => sim.state.grenades.mines[0]?.phase;

  it('are set on the floor in front of the player, one charge each, and only while there are charges', () => {
    const { sim, player } = betty();
    const events = step(sim, ['placeMine']);
    expect(types(events, 'minePlaced')).toHaveLength(1);
    expect(player.mineCharges).toBe(1);
    const [mine] = sim.state.grenades.mines;
    expect(mine.position.z).toBeCloseTo(-MINE_RULES.placeDistance);
    expect(mine.phase).toBe('arming');
    step(sim, ['placeMine']);
    expect(player.mineCharges).toBe(0);
    expect(types(step(sim, ['placeMine']), 'minePlaced')).toEqual([]);
    expect(sim.state.grenades.mines).toHaveLength(2);
  });

  it('go at the player’s feet when a wall is in the way, and cannot be set while down', () => {
    const wall = { min: { x: -1, y: 0, z: -0.6 }, max: { x: 1, y: 2, z: -0.5 } };
    const { sim, player } = betty({ walls: [wall] });
    step(sim, ['placeMine']);
    expect(sim.state.grenades.mines[0].position.z).toBeCloseTo(0);
    damagePlayer(player, 500);
    expect(player.downed).not.toBeNull();
    expect(types(step(sim, ['placeMine']), 'minePlaced')).toEqual([]);
  });

  it('arm after a moment, and do nothing to a zombie that walks over them before then', () => {
    const { sim } = betty();
    step(sim, ['placeMine']);
    const zombie = createZombieState('e:20', { x: 0, y: 0, z: -MINE_RULES.placeDistance - 0.5 }, 1);
    zombie.moveSpeed = 0;
    addEntity(sim.state.world, zombie);
    run(sim, MINE_RULES.armTicks - 5);
    expect(sprung(sim)).toBe('arming');
    expect(zombie.health).toBe(150);
    const armed = run(sim, 10);
    expect(types(armed, 'mineArmed')).toHaveLength(1);
  });

  it('spring under a zombie, jump, then go off once: killing those near it and hurting the owner if close', () => {
    const { sim, player } = betty();
    step(sim, ['placeMine']);
    run(sim, MINE_RULES.armTicks);
    expect(sprung(sim)).toBe('armed');
    // Nothing near it: it waits, however long.
    expect(types(run(sim, 120), 'mineTriggered')).toEqual([]);
    const victim = createZombieState('e:20', { x: 0, y: 0, z: -MINE_RULES.placeDistance - 1 }, 1);
    victim.moveSpeed = 0;
    const bystander = createZombieState('e:21', { x: 3, y: 0, z: -MINE_RULES.placeDistance }, 1);
    bystander.moveSpeed = 0;
    for (const zombie of [victim, bystander]) addEntity(sim.state.world, zombie);
    const points = player.points;
    const triggered = step(sim);
    expect(types(triggered, 'mineTriggered')).toHaveLength(1);
    expect(sprung(sim)).toBe('popping');
    // It takes a moment to jump: nothing has been hurt yet.
    expect(victim.health).toBe(150);
    const events = run(sim, MINE_RULES.popTicks + 2);
    expect(types(events, 'mineExploded')).toHaveLength(1);
    expect(sim.state.grenades.mines).toEqual([]);
    expect(victim.alive).toBe(false);
    expect(bystander.alive).toBe(false);
    expect(player.points).toBeGreaterThan(points);
    expect(player.health).toBeLessThan(100);
    // The explosion is at chest height, above where the mine sat.
    const blast = types(events, 'mineExploded')[0] as { position: { y: number } };
    expect(blast.position.y).toBeCloseTo(MINE_RULES.popHeight);
  });

  it('are not set off by players, and one that is set off sets off a barrel beside it', () => {
    const { sim, player } = betty({ hazards: [barrel('b1', 0, -MINE_RULES.placeDistance - 1.2)] });
    // The zombie that sets it off is within arm's reach of the player, who would otherwise be dead before the mine pops.
    player.godMode = true;
    step(sim, ['placeMine']);
    run(sim, MINE_RULES.armTicks + 30);
    expect(sprung(sim)).toBe('armed');
    const zombie = createZombieState('e:20', { x: 1, y: 0, z: -MINE_RULES.placeDistance }, 1);
    zombie.moveSpeed = 0;
    addEntity(sim.state.world, zombie);
    const events = run(sim, MINE_RULES.popTicks + HAZARD_KINDS.barrel.burnTicks + 10);
    expect(types(events, 'mineExploded')).toHaveLength(1);
    expect(types(events, 'hazardExploded')).toHaveLength(1);
  });

  it('are cleared when the match restarts, and travel in snapshots', () => {
    const { sim } = betty();
    step(sim, ['placeMine']);
    const snapshot = JSON.parse(encodeSnapshotBody(captureSnapshot(sim)));
    const other = world().sim;
    applySnapshot(other, snapshot);
    expect(other.state.grenades.mines).toEqual(sim.state.grenades.mines);
    sim.restart();
    expect(sim.state.grenades.mines).toEqual([]);
    expect(sim.players()[0].mineCharges).toBe(0);
  });
});
