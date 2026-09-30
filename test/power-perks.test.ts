import { describe, expect, it } from 'vitest';
import {
  BOX_RULES, GameSimulation, GRENADE_RULES, PERKS, PLAYER_HEALTH, TRAP_RULES, beginReload, createInputFrame, createMysteryBox,
  createPlayerState, createTrap, createZombieState, damagePlayer, equipWeapon, firePlayerWeapon, rayFromPlayer,
  sampleWalkHeight, teddyChance, DOWN_RULES, chooseZombieTarget, tickMysteryBoxes, tickPlayerRecovery, tickTraps, useMysteryBox, WEAPON_DEFINITIONS,
  type InteractionEvent, type MysteryBoxLocation, type PerkId,
} from '../src/core/index.ts';
import { ASYLUM_MAP } from '../src/maps/asylum.ts';

const map = ASYLUM_MAP;
const UP = map.upperHeight;
const simMap = { collisionBoxes: [...map.collisionBoxes], walkSurfaces: map.walkSurfaces, zombieSpawns: map.zombieSpawns,
  navigationGraph: map.navigation, doors: map.doors, mysteryBoxes: map.mysteryBoxes, shotBlockers: map.shotBlockers,
  barriers: map.barriers, wallWeapons: map.wallWeapons, powerSwitch: map.powerSwitch, perkMachines: map.perkMachines,
  traps: map.traps };
const quiet = { initialWaitTicks: 9999, intermissionTicks: 9999 };
function simAt(position: { x: number; y: number; z: number }, yaw: number, points = 10000) {
  const sim = new GameSimulation({ seed: 5, map: simMap, playerSpawns: [position], roundConfig: quiet,
    economyConfig: { startingPoints: points, hitReward: 10, killBonus: 50 } });
  const player = sim.getPlayer(sim.playerIds[0])!;
  player.yaw = yaw;
  return { sim, player };
}
function interact(sim: GameSimulation) {
  const frame = createInputFrame(0);
  frame.actions.interact = { pressed: true, held: true, released: false, value: 1 };
  return sim.tick({ [sim.playerIds[0]]: frame });
}
/** Where a buyer stands to face a point on a wall that faces `facing`. */
const standBefore = (point: { x: number; y: number; z: number }, facing: number, floor: number, distance = 1.2) =>
  ({ x: point.x + Math.sin(facing) * distance, y: floor, z: point.z + Math.cos(facing) * distance });
const faceToward = (from: { x: number; z: number }, to: { x: number; z: number }) => Math.atan2(from.x - to.x, from.z - to.z);

describe('Asylum power', () => {
  it('keeps the door between the starts shut until the switch is thrown', () => {
    const gate = map.doors.find(door => door.id === 'start-gate')!;
    const beside = { x: gate.position.x - 1.4, y: 0, z: gate.position.z };
    const { sim, player } = simAt(beside, faceToward(beside, gate.position));
    expect(sim.interactionCandidate(player.id)?.prompt).toBe('The power must be on');
    expect(interact(sim).some(event => event.type === 'doorOpened')).toBe(false);
    expect(player.points).toBe(10000);
  });

  it('throws the switch from the power room floor and opens the start door', () => {
    const switchAt = map.powerSwitch!.position;
    const stand = { x: switchAt.x, y: UP, z: switchAt.z + 1.3 };
    const { sim, player } = simAt(stand, 0);
    sim.tick();
    expect(player.position.y).toBeCloseTo(UP);
    const events = interact(sim);
    expect(events).toContainEqual({ type: 'powerActivated', playerId: player.id });
    expect(events).toContainEqual({ type: 'doorOpened', doorId: 'start-gate', playerId: player.id });
    expect(sim.state.power.on).toBe(true);
    expect(sim.state.doors.find(door => door.id === 'start-gate')!.open).toBe(true);
    expect(sim.interactionCandidate(player.id)).toBeNull(); // The switch stays thrown.
  });
});

describe('Asylum perks', () => {
  it('sells solo Quick Revive before power, then depletes after three self-revives', () => {
    const machine = map.perkMachines!.find(candidate => candidate.perk === 'quick-revive')!;
    const facing = map.perkMachineFacing![machine.id];
    const stand = standBefore(machine.position, facing, 0, 0.4);
    const { sim, player } = simAt(stand, facing, 2000);
    expect(sim.state.power.on).toBe(false);
    expect(sim.interactionCandidate(player.id)?.prompt).toContain('[500]');
    expect(interact(sim)).toContainEqual({ type: 'perkBought', playerId: player.id, perk: 'quick-revive' });
    expect(player.points).toBe(1500);
    player.perks = []; player.selfRevives = 3;
    sim.tick();
    expect(sim.interactionCandidate(player.id)).toBeNull();
    expect(interact(sim).some(event => event.type === 'perkBought')).toBe(false);
  });

  it('keeps co-op Quick Revive at 1500 and power-gated', () => {
    const machine = map.perkMachines!.find(candidate => candidate.perk === 'quick-revive')!;
    const facing = map.perkMachineFacing![machine.id];
    const stand = standBefore(machine.position, facing, 0, 0.4);
    const sim = new GameSimulation({ seed: 5, map: simMap, playerSpawns: [stand, { x: 0, y: 0, z: 0 }],
      roundConfig: quiet, economyConfig: { startingPoints: 2000, hitReward: 10, killBonus: 50 } });
    const player = sim.getPlayer(sim.playerIds[0])!; player.yaw = facing;
    expect(sim.interactionCandidate(player.id)?.prompt).toBe('The power must be on');
    expect(interact(sim).some(event => event.type === 'perkBought')).toBe(false);
    sim.state.power.on = true; sim.tick();
    expect(sim.interactionCandidate(player.id)?.prompt).toContain('[1500]');
    expect(interact(sim)).toContainEqual({ type: 'perkBought', playerId: player.id, perk: 'quick-revive' });
    expect(player.points).toBe(500);
  });
  it('puts each of Verrückt\'s four perks in its room', () => {
    const rooms: Record<string, [number, number, number, number, number]> = {
      juggernog: [-25.8, 3, 3, 19, 0], // German start
      'double-tap': [-30, -19, -20, 4, UP], // German balcony
      'quick-revive': [3, 16, 3, 19, 0], // American start
      'speed-cola': [16, 30, -32, -20, UP], // Speed Cola room
    };
    for (const machine of map.perkMachines!) {
      const [minX, maxX, minZ, maxZ, y] = rooms[machine.perk];
      expect(machine.position.x, machine.id).toBeGreaterThan(minX);
      expect(machine.position.x, machine.id).toBeLessThan(maxX);
      expect(machine.position.z, machine.id).toBeGreaterThan(minZ);
      expect(machine.position.z, machine.id).toBeLessThan(maxZ);
      expect(machine.position.y - 1, machine.id).toBe(y);
    }
    expect(map.perkMachines!.map(machine => machine.perk).sort()).toEqual(['double-tap', 'juggernog', 'quick-revive', 'speed-cola']);
  });

  it.each(map.perkMachines!.map(machine => machine.id))('sells %s from the floor in front, only with the power on', id => {
    const machine = map.perkMachines!.find(candidate => candidate.id === id)!;
    const facing = map.perkMachineFacing![id];
    const stand = standBefore(machine.position, facing, machine.position.y - 1, 0.4);
    const { sim, player } = simAt(stand, facing);
    sim.tick();
    expect(player.position.y, 'stands on floor').toBeCloseTo(stand.y);
    expect(Math.hypot(player.position.x - stand.x, player.position.z - stand.z), 'not pushed out').toBeLessThan(0.05);
    if (machine.perk === 'quick-revive') {
      expect(sim.interactionCandidate(player.id)?.prompt).toContain('[500]');
    } else {
      expect(sim.interactionCandidate(player.id)?.prompt).toBe('The power must be on');
      expect(interact(sim).some(event => event.type === 'perkBought')).toBe(false);
    }
    sim.state.power.on = true;
    sim.tick();
    expect(sim.interactionCandidate(player.id)?.prompt).toContain(`[${machine.perk === 'quick-revive' ? 500 : PERKS[machine.perk].cost}]`);
    expect(interact(sim)).toContainEqual({ type: 'perkBought', playerId: player.id, perk: machine.perk });
    expect(player.perks).toEqual([machine.perk]);
    expect(player.points).toBe(10000 - (machine.perk === 'quick-revive' ? 500 : PERKS[machine.perk].cost));
    interact(sim); // A second drink is refused.
    expect(player.perks).toEqual([machine.perk]);
  });
});

describe('Asylum traps', () => {
  it.each(map.traps!.map(trap => trap.id))('%s spans a balcony and is switched from its floor', id => {
    const trap = map.traps!.find(candidate => candidate.id === id)!;
    const middle = { x: (trap.zone.min.x + trap.zone.max.x) / 2, z: (trap.zone.min.z + trap.zone.max.z) / 2 };
    expect(sampleWalkHeight(middle.x, middle.z, UP, map.walkSurfaces)).toBe(UP);
    const facing = trap.switchPosition.x < 0 ? Math.PI / 2 : -Math.PI / 2;
    const stand = standBefore(trap.switchPosition, facing, UP);
    const { sim, player } = simAt(stand, facing);
    sim.tick();
    expect(player.position.y).toBeCloseTo(UP);
    expect(sim.interactionCandidate(player.id)?.prompt).toBe('The power must be on');
    sim.state.power.on = true;
    sim.tick();
    expect(interact(sim)).toContainEqual({ type: 'trapActivated', trapId: id, playerId: player.id });
  });
});

describe('Asylum box spots', () => {
  it.each(map.mysteryBoxes[0].locations!.map((location, index) => ({ id: location.id, index })))(
    'can buy from the box at $id', ({ index }) => {
      const location = map.mysteryBoxes[0].locations![index];
      const floor = location.center.y - 0.52;
      const front = { x: Math.cos(location.yaw), z: -Math.sin(location.yaw) };
      const stand = { x: location.position.x + front.x * 0.8, y: floor, z: location.position.z + front.z * 0.8 };
      const { sim, player } = simAt(stand, Math.atan2(front.x, front.z));
      sim.state.mysteryBoxes[0].locationIndex = index;
      sim.tick();
      expect(player.position.y).toBeCloseTo(floor);
      expect(Math.hypot(player.position.x - stand.x, player.position.z - stand.z), 'not pushed out').toBeLessThan(0.05);
      expect(interact(sim).some(event => event.type === 'mysteryBoxUsed')).toBe(true);
    });
});

describe('perks', () => {
  const drink = (...perks: PerkId[]) => { const player = createPlayerState('e:1', { x: 0, y: 0, z: 0 }); player.perks = perks; return player; };

  it('Jugger-Nog takes five zombie hits to put down instead of two', () => {
    const plain = drink(), jugg = drink('juggernog');
    jugg.health = 250;
    let hits = 0;
    while (!plain.downed && hits < 10) { damagePlayer(plain, 50); hits += 1; }
    expect(hits).toBe(2);
    hits = 0;
    while (!jugg.downed && hits < 10) { damagePlayer(jugg, 50); hits += 1; }
    expect(hits).toBe(5);
    expect(jugg.perks).toEqual([]); // Going down costs every perk.
  });

  it('Jugger-Nog players recover to 250', () => {
    const player = drink('juggernog');
    player.health = 200;
    for (let i = 0; i < 100; i++) tickPlayerRecovery(player);
    expect(player.health).toBe(250);
  });

  it('Double Tap fires a third faster, and Speed Cola halves reloads', () => {
    const plain = drink(), tapped = drink('double-tap');
    for (const player of [plain, tapped]) { equipWeapon(player, 'thompson'); player.switchTicksRemaining = 0; }
    firePlayerWeapon(plain, rayFromPlayer(plain, 1.6), [], [], false, 1);
    firePlayerWeapon(tapped, rayFromPlayer(tapped, 1.6), [], [], false, 1);
    expect(tapped.weapon.cooldownTicks).toBe(Math.round(WEAPON_DEFINITIONS.thompson.fireIntervalTicks * 0.75));
    expect(plain.weapon.cooldownTicks).toBe(WEAPON_DEFINITIONS.thompson.fireIntervalTicks);
    const cola = drink('speed-cola');
    equipWeapon(cola, 'thompson'); cola.switchTicksRemaining = 0;
    cola.weapon.magazineAmmo = 1;
    const [event] = beginReload(cola);
    expect(event).toMatchObject({ type: 'weaponReloadStarted', reloadTicks: WEAPON_DEFINITIONS.thompson.reloadTicks / 2 });
  });

});

describe('electric traps', () => {
  const definition = { id: 'trap', name: 'electric trap', cost: 1000, switchPosition: { x: 0, y: 1, z: 0 },
    zone: { min: { x: 0, y: 0, z: 0 }, max: { x: 4, y: 2, z: 4 } } };

  it('kills zombies that walk in, for no points, and hurts players standing in it', () => {
    const { state } = createTrap(definition, 'e:9');
    state.activeTicks = 10; state.ownerId = 'e:1';
    const inside = createZombieState('e:2', { x: 2, y: 0, z: 2 }, 1), outside = createZombieState('e:3', { x: 6, y: 0, z: 2 }, 1);
    const player = createPlayerState('e:1', { x: 1, y: 0, z: 1 });
    const events = tickTraps([state], [inside, outside], [player], 0);
    expect(events).toContainEqual({ type: 'zombieDied', zombieId: 'e:2', playerId: 'e:1', method: 'trap' });
    expect(inside.alive).toBe(false);
    expect(outside.alive).toBe(true);
    expect(player.health).toBe(100 - TRAP_RULES.playerDamage);
    expect(player.points).toBe(500);
  });

  it('runs, recharges, then is ready again', () => {
    const { state } = createTrap(definition, 'e:9');
    state.activeTicks = TRAP_RULES.activeTicks; state.ownerId = 'e:1';
    for (let i = 0; i < TRAP_RULES.activeTicks; i++) tickTraps([state], [], [], i);
    expect(state).toMatchObject({ activeTicks: 0, cooldownTicks: TRAP_RULES.cooldownTicks });
    let ready = false;
    for (let i = 0; i < TRAP_RULES.cooldownTicks; i++) ready ||= tickTraps([state], [], [], i).some(event => event.type === 'trapReady');
    expect(ready).toBe(true);
  });
});

describe('the moving box', () => {
  const spot = (id: string, x: number): MysteryBoxLocation =>
    ({ id, position: { x, y: 0.6, z: 0.77 }, center: { x, y: 0.52, z: 0 }, yaw: -Math.PI / 2 });

  it('follows Black Ops\' teddy odds', () => {
    expect([0, 3].map(uses => teddyChance(uses, 0))).toEqual([0, 0]);
    expect(teddyChance(4, 0)).toBe(0.15);
    expect(teddyChance(8, 0)).toBe(1);
    expect(teddyChance(8, 1)).toBe(0.3);
    expect(teddyChance(13, 2)).toBe(0.5);
  });

  it('brings up the bear by the ninth roll at its first spot, refunds it, and moves on', () => {
    const { state, interactable } = createMysteryBox({ id: 'box', position: spot('a', 0).position, cost: 950,
      weapons: ['thompson', 'mp40', 'stg44'], locations: [spot('a', 0), spot('b', 10), spot('c', 20)] }, 'e:5');
    const player = createPlayerState('e:1', { x: 0, y: 0, z: 1.5 }, 20000);
    const use: InteractionEvent = { type: 'interactionTriggered', playerId: player.id, interactableId: 'e:5',
      interactionType: 'mysteryBox', actionId: 'box:box' };
    let teddyAt = -1;
    for (let roll = 0; roll < 9 && teddyAt < 0; roll++) {
      useMysteryBox(player, use, [state], 42 + roll);
      // Leave the gun unclaimed and let the box close again, unless the bear comes up.
      while (state.phase !== 'idle' && teddyAt < 0) {
        if (tickMysteryBoxes([state], [interactable], [player]).some(event => event.type === 'mysteryBoxTeddy')) teddyAt = roll;
      }
    }
    expect(teddyAt).toBeGreaterThanOrEqual(4);
    expect(teddyAt).toBeLessThanOrEqual(8);
    expect(player.points).toBe(20000 - 950 * teddyAt); // The bear's roll is refunded.
    const moved = [];
    for (let i = 0; i < BOX_RULES.teddyTicks + BOX_RULES.awayTicks + 2; i++) moved.push(...tickMysteryBoxes([state], [interactable], [player], 7));
    expect(moved.filter(event => event.type === 'mysteryBoxMoved')).toHaveLength(1);
    expect(state).toMatchObject({ phase: 'idle', moves: 1, usesHere: 0 });
    expect(state.locationIndex).not.toBe(0);
    expect(interactable.position).toEqual(state.locations[state.locationIndex].position);
  });

  it('never moves a box with a single spot', () => {
    const { state, interactable } = createMysteryBox({ id: 'box', position: { x: 0, y: 0.6, z: 0.77 }, cost: 950,
      weapons: ['thompson', 'mp40'] }, 'e:5');
    const player = createPlayerState('e:1', { x: 0, y: 0, z: 1.5 }, 20000);
    const use: InteractionEvent = { type: 'interactionTriggered', playerId: player.id, interactableId: 'e:5',
      interactionType: 'mysteryBox', actionId: 'box:box' };
    for (let roll = 0; roll < 15; roll++) {
      useMysteryBox(player, use, [state], roll);
      while (state.phase !== 'idle') {
        expect(tickMysteryBoxes([state], [interactable], [player]).map(event => event.type)).not.toContain('mysteryBoxTeddy');
      }
    }
    expect(state.rolls).toBe(15);
  });
});

describe('last stand', () => {
  const flat = { collisionBoxes: [], walkSurfaces: [{ minX: -20, maxX: 20, minZ: -20, maxZ: 20, startHeight: 0, endHeight: 0 }],
    zombieSpawns: [] };
  const match = (players: number, perks: PerkId[] = []) => {
    const sim = new GameSimulation({ seed: 1, map: flat, roundConfig: quiet,
      playerSpawns: Array.from({ length: players }, (_, i) => ({ x: i * 1.2, y: 0, z: 0 })) });
    const all = sim.playerIds.map(id => sim.getPlayer(id)!);
    for (const player of all) player.perks = [...perks];
    return { sim, all };
  };
  const knockDown = (sim: GameSimulation, player: ReturnType<GameSimulation['getPlayer']>) => {
    player!.health = 1; damagePlayer(player!, 50); return sim.tick();
  };
  const holdUse = (sim: GameSimulation, id: `e:${number}`) => {
    const frame = createInputFrame(0);
    frame.actions.interact = { pressed: false, held: true, released: false, value: 1 };
    return sim.tick({ [id]: frame });
  };

  it('puts a player down with the pistol instead of killing them, and zombies leave them be', () => {
    const { sim, all: [downed, buddy] } = match(2);
    equipWeapon(downed, 'thompson');
    knockDown(sim, downed);
    expect(downed).toMatchObject({ alive: true, health: 0 });
    expect(downed.weapon).toMatchObject({ weaponId: DOWN_RULES.pistol, reserveAmmo: DOWN_RULES.pistolReserve });
    const zombie = createZombieState('e:50', { x: -1, y: 0, z: 0 }, 1);
    expect(chooseZombieTarget(zombie, [downed, buddy])?.id).toBe(buddy.id);
    expect(damagePlayer(downed, 50)).toEqual([]);
  });

  it('is revived by a teammate holding use for three seconds, with their guns back', () => {
    const { sim, all: [downed, buddy] } = match(2);
    equipWeapon(downed, 'thompson');
    knockDown(sim, downed);
    expect(sim.interactionCandidate(buddy.id)?.prompt).toBe('Hold E to revive');
    const events = [];
    for (let i = 0; i < DOWN_RULES.reviveTicks && downed.downed; i++) events.push(...holdUse(sim, buddy.id));
    expect(events).toContainEqual({ type: 'playerRevived', playerId: downed.id, reviverId: buddy.id });
    expect(downed).toMatchObject({ downed: null, health: PLAYER_HEALTH.maximum });
    expect(downed.weapon.weaponId).toBe('thompson');
  });

  it('revives twice as fast when the reviver has Quick Revive', () => {
    const { sim, all: [downed, buddy] } = match(2);
    buddy.perks = ['quick-revive'];
    knockDown(sim, downed);
    for (let i = 0; i < DOWN_RULES.quickReviveTicks; i++) holdUse(sim, buddy.id);
    expect(downed.downed).toBeNull();
  });

  it('starts the revive over if the reviver lets go, and bleeds out after thirty seconds', () => {
    const { sim, all: [downed, buddy] } = match(2);
    knockDown(sim, downed);
    for (let i = 0; i < 100; i++) holdUse(sim, buddy.id);
    sim.tick();
    expect(downed.downed?.reviveTicks).toBe(0);
    const events = [];
    for (let i = 0; i < DOWN_RULES.bleedoutTicks + 5; i++) events.push(...sim.tick());
    expect(events).toContainEqual({ type: 'playerBledOut', playerId: downed.id });
    expect(downed.alive).toBe(false);
    expect(sim.state.round.phase).not.toBe('gameOver'); // A teammate still stands.
  });

  it('brings a bled-out player back at the next round', () => {
    const sim = new GameSimulation({ seed: 1, map: flat, roundConfig: { initialWaitTicks: 1, intermissionTicks: 5 },
      spawnConfig: { baseZombieCount: 0, additionalPerRound: 0, maxAlive: 1, spawnIntervalTicks: 0 },
      playerSpawns: [{ x: 0, y: 0, z: 0 }, { x: 3, y: 0, z: 0 }] });
    const downed = sim.getPlayer(sim.playerIds[0])!;
    downed.points = 1234;
    downed.pointsEarned = 4321;
    downed.kills = 8;
    downed.headshots = 3;
    downed.selfRevives = 2;
    downed.grenadeCharges = 0;
    downed.mineCharges = 2;
    downed.bouncingBettyOwned = true;
    downed.perks = ['juggernog'];
    equipWeapon(downed, 'thompson');
    knockDown(sim, downed);
    // With no zombies the rounds turn over every few ticks, so the respawn follows soon after.
    const types: string[] = [];
    for (let i = 0; i < DOWN_RULES.bleedoutTicks + 60 && !types.includes('playerRespawned'); i++) {
      for (const event of sim.tick()) if ('playerId' in event && event.playerId === downed.id) types.push(event.type);
    }
    expect(types.filter(type => type === 'playerBledOut' || type === 'playerRespawned')).toEqual(['playerBledOut', 'playerRespawned']);
    expect(downed).toMatchObject({
      alive: true, health: 100, points: 1234, pointsEarned: 4321, kills: 8, headshots: 3, selfRevives: 2,
      downed: null, position: { x: 0, y: 0, z: 0 }, perks: [], grenadeCharges: GRENADE_RULES.starting,
      mineCharges: 0, bouncingBettyOwned: false, holsteredWeapon: null,
      weapon: { weaponId: DOWN_RULES.pistol },
    });
  });

  it('ends the game when nobody is left standing to revive', () => {
    const { sim } = match(1);
    const events = knockDown(sim, sim.getPlayer(sim.playerIds[0]));
    expect(events.map(event => event.type)).toContain('playerDied');
    expect(sim.getPlayer(sim.playerIds[0])!.alive).toBe(false);
    sim.tick();
    expect(sim.state.round.phase).toBe('gameOver');
  });

  it('solo Quick Revive gets the player back up alone, three times at most', () => {
    const { sim, all: [player] } = match(1, ['quick-revive']);
    for (let use = 1; use <= DOWN_RULES.soloQuickReviveLimit; use++) {
      player.perks = ['quick-revive'];
      knockDown(sim, player);
      expect(player.downed?.selfRevive).toBe(true);
      expect(player.selfRevives).toBe(use);
      for (let i = 0; i <= DOWN_RULES.selfReviveTicks && player.downed; i++) sim.tick();
      expect(player).toMatchObject({ alive: true, downed: null });
    }
    player.perks = ['quick-revive'];
    knockDown(sim, player);
    expect(player.alive).toBe(false); // The fourth time there is no self-revive left.
  });
});
