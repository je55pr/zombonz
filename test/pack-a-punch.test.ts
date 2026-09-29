import { describe, expect, it } from 'vitest';
import {
  GameSimulation, PACK_A_PUNCH_BODY, PACK_A_PUNCH_RULES, UPGRADED_WEAPON_DEFINITIONS, UPGRADE_SPECS, WEAPON_DEFINITIONS,
  WEAPON_SWITCH_TICKS, baseWeaponId, collectPowerups, createInputFrame, createMysteryBox, createPlayerState, createPowerupState,
  createWeaponState, createZombieState, firePlayerWeapon, handleWallWeaponInteraction, isUpgradedWeapon, packAPunchBlocker,
  packAPunchPrompt, packAPunchUsePoint, playerEyeHeight, rayFromPlayer, upgradeIdFor, useMysteryBox, weaponDefinition, weaponName,
  addEntity, allocateEntityId,
  type InteractionEvent, type PackAPunchState, type PlayerState, type SimulationEvent,
} from '../src/core/index.ts';
import { BUNKER_MAP } from '../src/maps/bunker.ts';
import { ASYLUM_MAP } from '../src/maps/asylum.ts';
import { createMatch } from '../src/maps/match.ts';
import type { GameMap } from '../src/maps/gameMap.ts';
import { applySnapshot, captureSnapshot } from '../src/net/snapshot.ts';
import { encodeSnapshotBody } from '../src/net/protocol.ts';

const quiet = { initialWaitTicks: 99999, intermissionTicks: 99999 };

/** A one-player (or more) match on `map` with the power on, and the player at the machine's buy point looking at it. */
function atMachine(map: GameMap, id: string, options: { points?: number; held?: string; other?: string | null; players?: number } = {}) {
  const sim = createMatch(map, options.players ?? 1, 7, { roundConfig: quiet,
    economyConfig: { startingPoints: options.points ?? 10000, hitReward: 10, killBonus: 50 } });
  sim.state.power.on = true; sim.refreshInteractables();
  const machine = sim.state.packAPunch.find(candidate => candidate.id === id)!;
  const player = sim.getPlayer(sim.playerIds[0])!;
  place(player, machine);
  hold(player, options.held ?? 'kar98k', options.other === undefined ? 'starter-pistol' : options.other);
  return { sim, machine, player };
}
function place(player: PlayerState, machine: PackAPunchState): void {
  const point = packAPunchUsePoint(machine);
  player.position = { x: point.x, y: machine.position.y, z: point.z };
  player.yaw = machine.yaw;
}
function hold(player: PlayerState, held: string, other: string | null): void {
  player.weapon = createWeaponState(held);
  player.holsteredWeapon = other ? createWeaponState(other) : null;
  player.switchTicksRemaining = 0;
}
function press(sim: GameSimulation, index = 0): SimulationEvent[] {
  const frame = createInputFrame(sim.state.world.tick);
  frame.actions.interact = { pressed: true, held: true, released: false, value: 1 };
  return sim.tick({ [sim.playerIds[index]]: frame });
}
function run(sim: GameSimulation, ticks: number): SimulationEvent[] {
  const events: SimulationEvent[] = [];
  for (let i = 0; i < ticks; i++) events.push(...sim.tick());
  return events;
}
const types = (events: readonly SimulationEvent[]) => events.map(event => event.type);

describe('Pack-a-Punch upgrades', () => {
  it('gives every gun an upgraded version with its own id and name, and every upgrade a gun', () => {
    const names = new Set<string>();
    for (const [id, definition] of Object.entries(WEAPON_DEFINITIONS)) {
      const upgradeId = upgradeIdFor(id);
      expect(upgradeId, `${id} has an upgrade`).toBe(`${id}-pap`);
      const upgraded = UPGRADED_WEAPON_DEFINITIONS[upgradeId!];
      expect(upgraded.id).toBe(upgradeId);
      expect(upgraded.name, id).not.toBe(definition.name);
      names.add(upgraded.name);
      expect(upgraded.damage, id).toBeGreaterThan(definition.damage);
      expect(upgraded.magazineSize, id).toBeGreaterThanOrEqual(definition.magazineSize);
      expect(upgraded.startingReserveAmmo, id).toBeGreaterThan(definition.startingReserveAmmo);
      expect(upgraded.reloadTicks, id).toBeLessThan(definition.reloadTicks);
      expect(upgraded.fireIntervalTicks, id).toBe(definition.fireIntervalTicks);
    }
    expect(names.size).toBe(Object.keys(WEAPON_DEFINITIONS).length);
    for (const id of Object.keys(UPGRADE_SPECS)) expect(WEAPON_DEFINITIONS[id], `${id} is a gun`).toBeDefined();
  });

  it('keeps upgraded guns out of the guns that can be found, and looks them up like any other', () => {
    expect(Object.keys(WEAPON_DEFINITIONS).some(id => isUpgradedWeapon(id))).toBe(false);
    expect(weaponDefinition('kar98k-pap')).toBe(UPGRADED_WEAPON_DEFINITIONS['kar98k-pap']);
    expect(weaponDefinition('kar98k')).toBe(WEAPON_DEFINITIONS.kar98k);
    expect(weaponDefinition('nonsense-pap')).toBeUndefined();
    expect(weaponName('kar98k-pap')).toBe("Hunter's Moon");
    expect(baseWeaponId('kar98k-pap')).toBe('kar98k');
    expect(baseWeaponId('kar98k')).toBe('kar98k');
    expect(baseWeaponId('nonsense-pap')).toBe('nonsense-pap');
    expect(upgradeIdFor('kar98k-pap'), 'an upgraded gun has no further upgrade').toBeNull();
    expect(upgradeIdFor('knife')).toBeNull();
    const fresh = createWeaponState('kar98k-pap'), definition = UPGRADED_WEAPON_DEFINITIONS['kar98k-pap'];
    expect(fresh).toMatchObject({ weaponId: 'kar98k-pap', magazineAmmo: definition.magazineSize, reserveAmmo: definition.startingReserveAmmo });
  });

  it('changes what it says it changes: damage, ammo, reload, pellets, blasts and chains', () => {
    const shotguns = ['double-barrel', 'trench-gun', 'spas12', 'ithaca37'];
    for (const id of shotguns) expect(UPGRADED_WEAPON_DEFINITIONS[`${id}-pap`].pellets, id).toBe(12);
    expect(WEAPON_DEFINITIONS.spas12.pellets).toBe(8);
    expect(UPGRADED_WEAPON_DEFINITIONS['rpg7-pap'].explosive!.radius).toBeGreaterThan(WEAPON_DEFINITIONS.rpg7.explosive!.radius);
    expect(UPGRADED_WEAPON_DEFINITIONS['rpg7-pap'].explosive!.selfDamage).toBe(WEAPON_DEFINITIONS.rpg7.explosive!.selfDamage);
    expect(UPGRADED_WEAPON_DEFINITIONS['molniya-pap'].chain!.targets).toBe(8);
    expect(WEAPON_DEFINITIONS.molniya.chain!.targets).toBe(5);
    // Bullets go through one more body and keep a little more force, but never past nine tenths.
    for (const id of Object.keys(WEAPON_DEFINITIONS)) {
      const before = WEAPON_DEFINITIONS[id].penetration, after = UPGRADED_WEAPON_DEFINITIONS[`${id}-pap`].penetration;
      if (!before) { expect(after, id).toBeUndefined(); continue; }
      expect(after!.maxTargets, id).toBe(before.maxTargets + 1);
      expect(after!.damageRetention, id).toBeLessThanOrEqual(0.9);
      expect(after!.damageRetention, id).toBeGreaterThanOrEqual(before.damageRetention);
    }
  });

  it('hits a zombie harder with the upgraded gun, in the same place', () => {
    const shoot = (weaponId: string) => {
      const player = createPlayerState('e:1', { x: 0, y: 0, z: 0 });
      player.weapon = createWeaponState(weaponId);
      // A body shot at an aimed gun, on a zombie that cannot die, so the damage is the gun's alone.
      player.pitch = -0.1; player.aiming = true;
      const zombie = createZombieState('e:2', { x: 0, y: 0, z: -6 }, 1);
      zombie.health = 1e6;
      const events = firePlayerWeapon(player, rayFromPlayer(player, playerEyeHeight(player)), [zombie], [], false, 11);
      const hit = events.find(event => event.type === 'weaponHit');
      return hit?.type === 'weaponHit' ? hit.damage : 0;
    };
    for (const id of ['thompson', 'kar98k', 'bar']) {
      const base = shoot(id), upgraded = shoot(`${id}-pap`);
      expect(base, id).toBeGreaterThan(0);
      expect(upgraded / base, id).toBeCloseTo(UPGRADED_WEAPON_DEFINITIONS[`${id}-pap`].damage / WEAPON_DEFINITIONS[id].damage, 1);
    }
  });
});

describe('the machine\'s body and buy point', () => {
  const machine = { position: { x: 10, y: 3, z: -4 }, yaw: 0 };

  it('has a solid body across its front, and swaps sides when it is turned a quarter', () => {
    const { width, depth, height } = PACK_A_PUNCH_BODY;
    const facing = packAPunchBlocker(machine);
    expect(facing.min).toEqual({ x: 10 - width / 2, y: 3, z: -4 - depth / 2 });
    expect(facing.max).toEqual({ x: 10 + width / 2, y: 3 + height, z: -4 + depth / 2 });
    const turned = packAPunchBlocker({ ...machine, yaw: Math.PI / 2 });
    expect(turned.max.x - turned.min.x).toBeCloseTo(depth);
    expect(turned.max.z - turned.min.z).toBeCloseTo(width);
  });

  it('puts the buy point in front of its face, at chest height, whichever way it faces', () => {
    const { depth } = PACK_A_PUNCH_BODY;
    for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const point = packAPunchUsePoint({ ...machine, yaw });
      expect(point.y).toBeCloseTo(4);
      expect(Math.hypot(point.x - 10, point.z + 4)).toBeCloseTo(depth / 2 + 0.75);
      expect((point.x - 10) * Math.sin(yaw) + (point.z + 4) * Math.cos(yaw)).toBeGreaterThan(0);
    }
  });

  it('refuses a yaw that is not a quarter turn, since its body is an axis-aligned box', () => {
    expect(() => createMatch({ ...BUNKER_MAP, packAPunch: [{ id: 'x', position: { x: 0, y: 0, z: 0 }, yaw: 0.4 }] }, 1, 1)).toThrow(/quarter turn/);
  });
});

describe.each([['Bunker', BUNKER_MAP], ['Asylum', ASYLUM_MAP]] as const)('%s has a machine in the right place', (_name, map) => {
  const only = map.packAPunch![0];

  it('has exactly one, standing on a floor of the map and clear of every wall and prop', () => {
    expect(map.packAPunch).toHaveLength(1);
    const body = packAPunchBlocker({ position: only.position, yaw: only.yaw });
    for (const box of map.collisionBoxes) {
      // Floors and ceilings above and below are not in the way; anything else crossing the body's height is.
      if (box.max.y <= body.min.y + 0.05 || box.min.y >= body.max.y - 0.05) continue;
      const overlaps = box.min.x < body.max.x && box.max.x > body.min.x && box.min.z < body.max.z && box.max.z > body.min.z;
      expect(overlaps, `${JSON.stringify(box)} overlaps the machine`).toBe(false);
    }
  });

  it('leaves room to stand at its buy point, and the way up to it clear', () => {
    const sim = createMatch(map, 1, 3, { roundConfig: quiet });
    const machine = sim.state.packAPunch[0], point = packAPunchUsePoint(machine);
    const solids = [...map.collisionBoxes, packAPunchBlocker(machine)].filter(box =>
      box.max.y > machine.position.y + 0.1 && box.min.y < machine.position.y + 1.8);
    for (const [dx, dz] of [[0, 0], [0.3, 0], [-0.3, 0], [0, 0.3], [0, -0.3]]) {
      const inside = solids.some(box => point.x + dx > box.min.x && point.x + dx < box.max.x && point.z + dz > box.min.z && point.z + dz < box.max.z);
      expect(inside, `standing ${dx},${dz} from the buy point`).toBe(false);
    }
    const player = sim.getPlayer(sim.playerIds[0])!;
    place(player, machine);
    const before = { ...player.position };
    sim.tick();
    expect(Math.hypot(player.position.x - before.x, player.position.z - before.z), 'not pushed out of the way').toBeLessThan(0.05);
    expect(player.position.y).toBeCloseTo(before.y);
  });

  it('stops a walker and a bullet: its body is added to the map collision, not baked into it', () => {
    const sim = createMatch(map, 1, 3, { roundConfig: quiet });
    const machine = sim.state.packAPunch[0], body = packAPunchBlocker(machine);
    expect(sim.collisionBoxes()).toContainEqual(body);
    expect(map.collisionBoxes).not.toContainEqual(body);
    const player = sim.getPlayer(sim.playerIds[0])!;
    place(player, machine);
    hold(player, 'kar98k', 'starter-pistol');
    // Walk straight into it for two seconds.
    const forward = createInputFrame(0);
    forward.actions.moveForward = { pressed: true, held: true, released: false, value: 1 };
    for (let tick = 0; tick < 120; tick++) sim.tick({ [player.id]: forward });
    const ahead = (player.position.x - machine.position.x) * Math.sin(machine.yaw) + (player.position.z - machine.position.z) * Math.cos(machine.yaw);
    expect(ahead, 'walked up to it').toBeLessThan(0.95);
    expect(ahead, 'but not into it').toBeGreaterThan(PACK_A_PUNCH_BODY.depth / 2);
    // A shot from the buy point at a zombie right behind it hits the machine, not the zombie.
    place(player, machine);
    const behind = { x: machine.position.x - Math.sin(machine.yaw) * 1.4, y: machine.position.y, z: machine.position.z - Math.cos(machine.yaw) * 1.4 };
    const zombie = createZombieState(allocateEntityId(sim.state.world), behind, 1);
    addEntity(sim.state.world, zombie);
    const shot = createInputFrame(sim.state.world.tick);
    shot.actions.fire = { pressed: true, held: true, released: false, value: 1 };
    const events = sim.tick({ [player.id]: shot });
    expect(types(events)).toContain('weaponFired');
    expect(types(events)).not.toContain('weaponHit');
  });
});

describe('using a machine', () => {
  it('is the Bunker\'s upstairs, where the wooden cabinet stood, and the Asylum\'s BAR room', () => {
    const upstairs = BUNKER_MAP.packAPunch![0], bar = ASYLUM_MAP.packAPunch![0];
    expect(upstairs.position.y).toBe(BUNKER_MAP.upperHeight);
    expect(upstairs.position.x).toBeGreaterThan(-8.17); expect(upstairs.position.x).toBeLessThan(-0.2);
    expect(upstairs.position.z).toBeGreaterThan(-14.65); expect(upstairs.position.z).toBeLessThan(0.54);
    // The BAR room: north wall z 9.2, south wall z 13.8, west door at x 16.2, east wall x 24.8.
    expect(bar.position.y).toBe(0);
    expect(bar.position.x).toBeGreaterThan(16.2); expect(bar.position.x).toBeLessThan(24.8);
    expect(bar.position.z).toBeGreaterThan(9.2); expect(bar.position.z).toBeLessThan(13.8);
    expect(ASYLUM_MAP.wallWeapons.some(wall => wall.id === 'back-room-bar')).toBe(true);
  });

  it('takes the gun in hand for 5000 points, hands over the other gun, and gives the upgraded one back full', () => {
    const { sim, machine, player } = atMachine(BUNKER_MAP, 'upper-pap', { held: 'kar98k', other: 'starter-pistol' });
    expect(sim.interactionCandidate(player.id)?.prompt).toBe('E  Pack-a-Punch [5000]');
    const events = press(sim);
    expect(events).toContainEqual({ type: 'pointsSpent', playerId: player.id, amount: 5000, reason: 'pap:upper-pap', balance: 5000 });
    expect(events).toContainEqual({ type: 'packAPunchStarted', playerId: player.id, machineId: 'upper-pap', weaponId: 'kar98k-pap' });
    expect(player.points).toBe(5000);
    expect(player.weapon.weaponId).toBe('starter-pistol');
    expect(player.holsteredWeapon).toBeNull();
    expect(player.switchTicksRemaining).toBeGreaterThan(0);
    expect(player.switchTicksRemaining).toBeLessThanOrEqual(WEAPON_SWITCH_TICKS);
    expect(machine).toMatchObject({ phase: 'upgrading', ownerId: player.id, weaponId: 'kar98k-pap' });
    expect(sim.interactionCandidate(player.id)?.prompt).toBe('Pack-a-Punch  upgrading…');
    // It takes its time, then says so.
    const waiting = run(sim, PACK_A_PUNCH_RULES.upgradeTicks - 2);
    expect(types(waiting)).not.toContain('packAPunchReady');
    expect(machine.phase).toBe('upgrading');
    const ready = run(sim, 2);
    expect(ready).toContainEqual({ type: 'packAPunchReady', playerId: player.id, machineId: 'upper-pap', weaponId: 'kar98k-pap' });
    expect(machine.phase).toBe('ready');
    expect(sim.interactionCandidate(player.id)?.prompt).toMatch(/^E {2}Take Hunter's Moon \[12s\]/);
    // Taking it puts the upgraded gun in hand, full, with the pistol put away.
    const taken = press(sim);
    expect(taken).toContainEqual({ type: 'packAPunchCollected', playerId: player.id, machineId: 'upper-pap', weaponId: 'kar98k-pap' });
    const upgraded = UPGRADED_WEAPON_DEFINITIONS['kar98k-pap'];
    expect(player.weapon).toMatchObject({ weaponId: 'kar98k-pap', magazineAmmo: upgraded.magazineSize, reserveAmmo: upgraded.startingReserveAmmo });
    expect(player.holsteredWeapon?.weaponId).toBe('starter-pistol');
    expect(player.points).toBe(5000);
    expect(machine).toMatchObject({ phase: 'idle', ownerId: null, weaponId: null });
  });

  it('can upgrade the gun in hand whichever slot it came from, and leaves the other one untouched', () => {
    const { sim, player } = atMachine(BUNKER_MAP, 'upper-pap', { held: 'starter-pistol', other: 'thompson' });
    player.holsteredWeapon!.magazineAmmo = 7; player.holsteredWeapon!.reserveAmmo = 33;
    press(sim); run(sim, PACK_A_PUNCH_RULES.upgradeTicks); press(sim);
    expect(player.weapon.weaponId).toBe('starter-pistol-pap');
    expect(player.holsteredWeapon).toMatchObject({ weaponId: 'thompson', magazineAmmo: 7, reserveAmmo: 33 });
  });

  it('refuses without a second gun to hold, a gun it cannot take, an already upgraded one, or the points', () => {
    const only = atMachine(BUNKER_MAP, 'upper-pap', { held: 'kar98k', other: null });
    expect(only.sim.interactionCandidate(only.player.id)?.prompt).toBe('Pack-a-Punch needs a second weapon to hold meanwhile');
    expect(press(only.sim)).toContainEqual({ type: 'packAPunchRefused', playerId: only.player.id, machineId: 'upper-pap', reason: 'noSecondWeapon' });
    expect(only.player.points).toBe(10000);
    expect(only.player.weapon.weaponId).toBe('kar98k');
    expect(only.machine.phase).toBe('idle');

    const again = atMachine(BUNKER_MAP, 'upper-pap', { held: 'kar98k-pap', other: 'starter-pistol' });
    expect(again.sim.interactionCandidate(again.player.id)?.prompt).toBe("The Hunter's Moon is already Pack-a-Punched");
    expect(press(again.sim)).toContainEqual({ type: 'packAPunchRefused', playerId: again.player.id, machineId: 'upper-pap', reason: 'alreadyUpgraded' });
    expect(again.player.points).toBe(10000);

    const poor = atMachine(BUNKER_MAP, 'upper-pap', { points: 4999 });
    const events = press(poor.sim);
    expect(events).toContainEqual({ type: 'pointsSpendRejected', playerId: poor.player.id, amount: 5000, reason: 'pap:upper-pap', balance: 4999 });
    expect(poor.player.points).toBe(4999);
    expect(poor.player.weapon.weaponId).toBe('kar98k');
    expect(poor.machine.phase).toBe('idle');
  });

  it('refuses a gun that has no upgrade rather than corrupting the inventory', () => {
    const odd = atMachine(BUNKER_MAP, 'upper-pap', { held: 'kar98k', other: 'starter-pistol' });
    // An id the game does not know, standing in for any gun a future change adds without an upgrade.
    odd.player.weapon = { ...createWeaponState('kar98k'), weaponId: 'homemade' };
    expect(odd.sim.interactionCandidate(odd.player.id)?.prompt).toBe('The HOMEMADE cannot be Pack-a-Punched');
    expect(press(odd.sim)).toContainEqual({ type: 'packAPunchRefused', playerId: odd.player.id, machineId: 'upper-pap', reason: 'notUpgradable' });
    expect(odd.player.weapon.weaponId).toBe('homemade');
    expect(odd.player.holsteredWeapon?.weaponId).toBe('starter-pistol');
    expect(odd.player.points).toBe(10000);
  });

  it('is in use for everyone but its owner while it works, and the gun waits only for them', () => {
    const { sim, machine, player } = atMachine(BUNKER_MAP, 'upper-pap', { players: 2 });
    const other = sim.getPlayer(sim.playerIds[1])!;
    place(other, machine); other.position.x += 0.5;
    hold(other, 'mp40', 'starter-pistol');
    press(sim);
    expect(machine.ownerId).toBe(player.id);
    expect(sim.interactionCandidate(other.id)?.prompt).toBe('Pack-a-Punch is in use');
    expect(press(sim, 1)).toContainEqual({ type: 'packAPunchRefused', playerId: other.id, machineId: 'upper-pap', reason: 'busy' });
    expect(other.weapon.weaponId).toBe('mp40');
    run(sim, PACK_A_PUNCH_RULES.upgradeTicks);
    expect(machine.phase).toBe('ready');
    expect(sim.interactionCandidate(other.id)?.prompt).toBe('Pack-a-Punch is in use');
    expect(press(sim, 1)).toContainEqual({ type: 'packAPunchRefused', playerId: other.id, machineId: 'upper-pap', reason: 'busy' });
    expect(machine.phase).toBe('ready');
    press(sim, 0);
    expect(player.weapon.weaponId).toBe('kar98k-pap');
  });

  it('loses the gun if it is not taken in time, and the machine is free again', () => {
    const { sim, machine, player } = atMachine(BUNKER_MAP, 'upper-pap');
    press(sim); run(sim, PACK_A_PUNCH_RULES.upgradeTicks);
    const waiting = run(sim, PACK_A_PUNCH_RULES.collectTicks - 2);
    expect(types(waiting)).not.toContain('packAPunchLost');
    const lost = run(sim, 2);
    expect(lost).toContainEqual({ type: 'packAPunchLost', machineId: 'upper-pap', weaponId: 'kar98k-pap' });
    expect(machine).toMatchObject({ phase: 'idle', ownerId: null, weaponId: null });
    expect(player.weapon.weaponId).toBe('starter-pistol');
    expect(player.holsteredWeapon).toBeNull();
    expect(sim.interactionCandidate(player.id)?.prompt).toBe('Pack-a-Punch needs a second weapon to hold meanwhile');
  });

  it('releases the machine if its owner is gone, and leaves the gun with no one', () => {
    const { sim, machine, player } = atMachine(BUNKER_MAP, 'upper-pap', { players: 2 });
    press(sim);
    player.alive = false;
    const events = sim.tick();
    expect(events).toContainEqual({ type: 'packAPunchLost', machineId: 'upper-pap', weaponId: 'kar98k-pap' });
    expect(machine.phase).toBe('idle');
  });

  it('does not let a downed owner take the gun until they are back up, and the time keeps running', () => {
    const { sim, machine, player } = atMachine(BUNKER_MAP, 'upper-pap', { players: 2 });
    press(sim); run(sim, PACK_A_PUNCH_RULES.upgradeTicks);
    player.downed = { bleedoutTicks: 1800, reviveTicks: 0, reviverId: null, selfRevive: false, lostPerks: [],
      stashed: { weapon: createWeaponState('starter-pistol'), holstered: null } };
    expect(sim.interactionCandidate(player.id)).toBeNull();
    press(sim);
    expect(machine.phase).toBe('ready');
    expect(machine.cooldownTicks).toBeLessThan(PACK_A_PUNCH_RULES.collectTicks);
  });

  it('when both hands are full again, taking the gun replaces the one in hand, and the prompt says so', () => {
    const { sim, machine, player } = atMachine(BUNKER_MAP, 'upper-pap', { held: 'kar98k', other: 'starter-pistol' });
    press(sim); run(sim, PACK_A_PUNCH_RULES.upgradeTicks);
    // A gun bought meanwhile fills the second slot.
    player.holsteredWeapon = createWeaponState('thompson');
    expect(packAPunchPrompt(machine, player, true)).toMatch(/\(replaces the M1911\)$/);
    press(sim);
    expect(player.weapon.weaponId).toBe('kar98k-pap');
    expect(player.holsteredWeapon?.weaponId).toBe('thompson');
  });

  it('cannot be used from behind, through its body', () => {
    const { sim, machine, player } = atMachine(BUNKER_MAP, 'upper-pap');
    const front = packAPunchUsePoint(machine);
    // Directly behind the machine, as far back as the use point is in front.
    player.position = { x: front.x, y: machine.position.y, z: 2 * machine.position.z - front.z };
    player.yaw = machine.yaw + Math.PI;
    expect(sim.interactionCandidate(player.id)).toBeNull();
    expect(press(sim).some(event => event.type === 'packAPunchStarted')).toBe(false);
  });

  it('needs the power where a map has a switch, and says so', () => {
    const { sim, machine, player } = atMachine(ASYLUM_MAP, 'bar-room-pap');
    sim.state.power.on = false; sim.refreshInteractables();
    expect(sim.interactionCandidate(player.id)?.prompt).toBe('The power must be on');
    expect(press(sim).some(event => event.type === 'packAPunchStarted' || event.type === 'pointsSpent')).toBe(false);
    expect(player.points).toBe(10000);
    expect(machine.phase).toBe('idle');
    sim.state.power.on = true; sim.refreshInteractables();
    expect(sim.interactionCandidate(player.id)?.prompt).toBe('E  Pack-a-Punch [5000]');
    expect(press(sim)).toContainEqual(expect.objectContaining({ type: 'packAPunchStarted' }));
  });

  it('works the same on the Asylum, in the BAR room', () => {
    const { sim, machine, player } = atMachine(ASYLUM_MAP, 'bar-room-pap', { held: 'bar', other: 'starter-pistol' });
    press(sim); run(sim, PACK_A_PUNCH_RULES.upgradeTicks); press(sim);
    expect(machine.phase).toBe('idle');
    expect(player.weapon.weaponId).toBe('bar-pap');
    expect(weaponName(player.weapon.weaponId)).toBe('Vanguard');
  });

  it('runs the same way every time', () => {
    const play = () => {
      const { sim } = atMachine(BUNKER_MAP, 'upper-pap');
      press(sim); run(sim, PACK_A_PUNCH_RULES.upgradeTicks + 100); press(sim); run(sim, 50);
      return JSON.stringify(sim.state);
    };
    expect(play()).toBe(play());
  });
});

describe('an upgraded gun among the other ways to get and refill guns', () => {
  const interaction = (player: PlayerState, type: string): InteractionEvent =>
    ({ type: 'interactionTriggered', playerId: player.id, interactableId: 'e:99', interactionType: type, actionId: `${type}:x` });

  it('is refilled at the wall of its base gun for the ammo price, and is not sold the base gun as well', () => {
    const player = createPlayerState('e:1', { x: 0, y: 0, z: 0 }, 1000);
    hold(player, 'kar98k-pap', 'starter-pistol');
    player.weapon.reserveAmmo = 3;
    const wall = { id: 'w', interactableId: 'e:99' as const, weaponId: 'kar98k', weaponCost: 200, ammoCost: 100, purchased: false };
    const events = handleWallWeaponInteraction(player, interaction(player, 'wallWeapon'), [wall]);
    expect(events.map(event => event.type)).toEqual(['pointsSpent', 'wallWeaponAmmoPurchased']);
    expect(player.points).toBe(900);
    expect(player.weapon.reserveAmmo).toBe(UPGRADED_WEAPON_DEFINITIONS['kar98k-pap'].startingReserveAmmo);
    expect(player.weapon.weaponId).toBe('kar98k-pap');
    expect(player.holsteredWeapon?.weaponId).toBe('starter-pistol');
    // Full, it is not sold ammo, and still not the gun.
    expect(handleWallWeaponInteraction(player, interaction(player, 'wallWeapon'), [wall])).toEqual([
      { type: 'wallWeaponAmmoFull', playerId: player.id, wallWeaponId: 'w', weaponId: 'kar98k' }]);
  });

  it('is never offered its base gun by the mystery box', () => {
    const player = createPlayerState('e:1', { x: 0, y: 0, z: 0 }, 5000);
    hold(player, 'kar98k-pap', 'starter-pistol');
    const box = createMysteryBox({ id: 'b', position: { x: 0, y: 0, z: 0 }, cost: 950, weapons: ['kar98k'] }, 'e:99');
    expect(useMysteryBox(player, interaction(player, 'mysteryBox'), [box.state], 5)).toEqual([
      { type: 'mysteryBoxUnavailable', playerId: player.id, boxId: 'b' }]);
    expect(player.points).toBe(5000);
  });

  it('is topped up to its own, larger reserve by Max Ammo', () => {
    const player = createPlayerState('e:1', { x: 0, y: 0, z: 0 });
    hold(player, 'kar98k-pap', 'starter-pistol');
    player.weapon.reserveAmmo = 1; player.holsteredWeapon!.reserveAmmo = 1;
    const powerups = createPowerupState(500);
    powerups.drops.push({ id: 'p', kind: 'maxAmmo', position: { x: 0, y: 0, z: 0 }, ticksRemaining: 1000 });
    collectPowerups(powerups, [player], []);
    expect(player.weapon.reserveAmmo).toBe(UPGRADED_WEAPON_DEFINITIONS['kar98k-pap'].startingReserveAmmo);
    expect(player.holsteredWeapon!.reserveAmmo).toBe(WEAPON_DEFINITIONS['starter-pistol'].startingReserveAmmo);
  });

  it('fires, reloads and shows in the HUD like any other gun', () => {
    const { sim, player } = atMachine(BUNKER_MAP, 'upper-pap', { held: 'thompson', other: 'starter-pistol' });
    press(sim); run(sim, PACK_A_PUNCH_RULES.upgradeTicks); press(sim);
    expect(player.weapon.weaponId).toBe('thompson-pap');
    run(sim, WEAPON_SWITCH_TICKS + 1);
    const fire = createInputFrame(sim.state.world.tick);
    fire.actions.fire = { pressed: true, held: true, released: false, value: 1 };
    expect(types(sim.tick({ [player.id]: fire }))).toContain('weaponFired');
    expect(player.weapon.magazineAmmo).toBe(UPGRADED_WEAPON_DEFINITIONS['thompson-pap'].magazineSize - 1);
    const reload = createInputFrame(sim.state.world.tick);
    reload.actions.reload = { pressed: true, held: true, released: false, value: 1 };
    const started = sim.tick({ [player.id]: reload }).find(event => event.type === 'weaponReloadStarted');
    expect(started).toMatchObject({ weaponId: 'thompson-pap', reloadTicks: UPGRADED_WEAPON_DEFINITIONS['thompson-pap'].reloadTicks });
  });
});

describe('a machine in a shared game', () => {
  it('travels in snapshots, so a client sees the same machine, prompt and upgraded gun', () => {
    const host = atMachine(BUNKER_MAP, 'upper-pap', { players: 2 });
    press(host.sim); run(host.sim, 90);
    const client = createMatch(BUNKER_MAP, 2, 7, { roundConfig: quiet });
    applySnapshot(client, JSON.parse(encodeSnapshotBody(captureSnapshot(host.sim))));
    expect(client.state.packAPunch).toEqual(host.sim.state.packAPunch);
    expect(client.state.packAPunch[0].phase).toBe('upgrading');
    expect(client.getPlayer(host.player.id)!.weapon.weaponId).toBe('starter-pistol');
    run(host.sim, PACK_A_PUNCH_RULES.upgradeTicks);
    applySnapshot(client, JSON.parse(encodeSnapshotBody(captureSnapshot(host.sim))));
    expect(client.state.packAPunch[0]).toMatchObject({ phase: 'ready', weaponId: 'kar98k-pap', ownerId: host.player.id });
    client.state.power.on = true; client.refreshInteractables();
    place(client.getPlayer(host.player.id)!, client.state.packAPunch[0]);
    expect(client.interactionCandidate(host.player.id)?.prompt).toMatch(/^E {2}Take Hunter's Moon \[\d+s\]/);
    // And the upgraded gun in hand arrives in the player's own state.
    press(host.sim);
    applySnapshot(client, JSON.parse(encodeSnapshotBody(captureSnapshot(host.sim))));
    expect(client.getPlayer(host.player.id)!.weapon.weaponId).toBe('kar98k-pap');
    expect(client.state.packAPunch[0].phase).toBe('idle');
  });

  it('gives the machines of a map without any an empty list, so older maps play on unchanged', () => {
    const sim = createMatch({ ...BUNKER_MAP, packAPunch: undefined }, 1, 1, { roundConfig: quiet });
    expect(sim.state.packAPunch).toEqual([]);
    const withMachine = createMatch(BUNKER_MAP, 1, 1, { roundConfig: quiet });
    expect(withMachine.collisionBoxes()).toHaveLength(sim.collisionBoxes().length + 1);
  });
});
