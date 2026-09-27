import { describe, expect, it } from 'vitest';
import {
  BOX_RULES, GameSimulation, PERKS, PLAYER_HEALTH, TRAP_RULES, beginReload, createInputFrame, createMysteryBox,
  createPlayerState, createTrap, createZombieState, damagePlayer, equipWeapon, firePlayerWeapon, rayFromPlayer,
  sampleWalkHeight, teddyChance, tickMysteryBoxes, tickPlayerRecovery, tickTraps, useMysteryBox, WEAPON_DEFINITIONS,
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
    expect(sim.interactionCandidate(player.id)?.prompt).toBe('The power must be on');
    expect(interact(sim).some(event => event.type === 'perkBought')).toBe(false);
    sim.state.power.on = true;
    sim.tick();
    expect(sim.interactionCandidate(player.id)?.prompt).toContain(`[${PERKS[machine.perk].cost}]`);
    expect(interact(sim)).toContainEqual({ type: 'perkBought', playerId: player.id, perk: machine.perk });
    expect(player.perks).toEqual([machine.perk]);
    expect(player.points).toBe(10000 - PERKS[machine.perk].cost);
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

  it('Jugger-Nog takes five zombie hits to kill instead of two', () => {
    const plain = drink(), jugg = drink('juggernog');
    jugg.health = 250;
    let hits = 0;
    while (plain.alive) { damagePlayer(plain, 50); hits += 1; }
    expect(hits).toBe(2);
    hits = 0;
    while (jugg.alive) { damagePlayer(jugg, 50); hits += 1; }
    expect(hits).toBe(5);
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

  it('Quick Revive cancels one killing blow and costs every perk', () => {
    const player = drink('juggernog', 'quick-revive');
    player.health = 40;
    expect(damagePlayer(player, 50)).toContainEqual({ type: 'playerRevived', playerId: player.id, amount: 0, health: PLAYER_HEALTH.maximum });
    expect(player).toMatchObject({ alive: true, health: PLAYER_HEALTH.maximum, perks: [] });
    damagePlayer(player, 50); damagePlayer(player, 50);
    expect(player.alive).toBe(false);
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
