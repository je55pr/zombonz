import { describe, expect, it } from 'vitest';
import {
  GameSimulation, WEAPON_DEFINITIONS, createPlayerState, createWeaponState, createZombieState, firePlayerWeapon,
  rayFromPlayer, weaponName, zombieHealthForRound as zombieHealth, type ZombieState,
} from '../src/core/index.ts';
import {
  BUNKER_MYSTERY_BOXES, BUNKER_SHOT_BLOCKERS, BUNKER_WALK_SURFACES, BUNKER_WALL_WEAPONS, BUNKER_WALL_WEAPON_FACING,
  UPPER_HEIGHT, greyboxCollisionBoxes,
} from '../src/maps/bunker.ts';

const origin = { x: 0, y: 0, z: 0 };

function shoot(weaponId: string, targets: ZombieState[], aiming = false, seed = 7) {
  const player = createPlayerState('e:1', origin);
  player.weapon = createWeaponState(weaponId);
  player.aiming = aiming;
  return firePlayerWeapon(player, rayFromPlayer(player, 1.3), targets, [], false, seed);
}

describe('weapon arsenal', () => {
  it('gives every weapon a display name and sane stats', () => {
    for (const definition of Object.values(WEAPON_DEFINITIONS)) {
      expect(definition.name.length, definition.id).toBeGreaterThan(1);
      expect(weaponName(definition.id)).toBe(definition.name);
      expect(definition.magazineSize).toBeGreaterThan(0);
      expect(definition.startingReserveAmmo % definition.magazineSize, definition.id).toBe(0);
    }
    expect(weaponName('starter-pistol')).toBe('M1911');
  });

  it('fires shotgun pellets that combine into one hit per zombie up close', () => {
    const zombie = createZombieState('e:2', { x: 0, y: 0, z: -2 }, 5);
    const events = shoot('double-barrel', [zombie]);
    const hits = events.filter(event => event.type === 'weaponHit');
    expect(hits).toHaveLength(1);
    // Most of the eight pellets land at two metres: far more than any single pellet.
    expect(hits[0].type === 'weaponHit' && hits[0].damage).toBeGreaterThan(WEAPON_DEFINITIONS['double-barrel'].damage * 4);
    expect(zombie.alive).toBe(false);
  });

  it('loses most pellets at range, and shotguns have a short reach', () => {
    const near = createZombieState('e:2', { x: 0, y: 0, z: -2 }, 20);
    const far = createZombieState('e:3', { x: 0, y: 0, z: -15 }, 20);
    const damageAt = (zombie: ZombieState) => {
      const before = zombie.health; shoot('trench-gun', [zombie]); return before - zombie.health;
    };
    expect(damageAt(far)).toBeLessThan(damageAt(near));
    const outOfRange = createZombieState('e:4', { x: 0, y: 0, z: -30 }, 1);
    expect(shoot('trench-gun', [outOfRange]).some(event => event.type === 'weaponHit')).toBe(false);
  });

  it('keeps single-projectile weapons to one ray', () => {
    const zombie = createZombieState('e:2', { x: 0, y: 0, z: -4 }, 1);
    const events = shoot('m1-garand', [zombie]);
    expect(events.filter(event => event.type === 'weaponHit')).toHaveLength(1);
    expect(150 - zombie.health).toBeLessThanOrEqual(WEAPON_DEFINITIONS['m1-garand'].damage * 3);
  });

  it('places the WaW-style Bunker wall buys, with ammo at half price', () => {
    const walls = Object.fromEntries(BUNKER_WALL_WEAPONS.map(wall => [wall.weaponId, wall]));
    // WaW's original chalk, plus four BO1-era wall guns.
    expect(Object.keys(walls).sort()).toEqual(['ak74u', 'bar', 'double-barrel', 'kar98k', 'm1-carbine', 'm14', 'mp5k',
      'thompson', 'trench-gun']);
    expect(walls['m1-carbine'].weaponCost).toBe(600);
    expect(walls['trench-gun'].weaponCost).toBe(1500);
    expect(walls.bar.weaponCost).toBe(1800);
    expect(walls['trench-gun'].position.y).toBeGreaterThan(UPPER_HEIGHT);
    expect(walls.bar.position.y).toBeGreaterThan(UPPER_HEIGHT);
    for (const wall of BUNKER_WALL_WEAPONS) {
      expect(wall.ammoCost).toBe(wall.weaponCost / 2);
      expect(BUNKER_WALL_WEAPON_FACING[wall.id], wall.id).toBeDefined();
    }
  });

  it('can buy every wall weapon from real Bunker floor in front of it', () => {
    for (const wall of BUNKER_WALL_WEAPONS) {
      const facing = BUNKER_WALL_WEAPON_FACING[wall.id];
      const stand = { x: wall.position.x + Math.sin(facing) * 1.2, y: wall.position.y - 1,
        z: wall.position.z + Math.cos(facing) * 1.2 };
      const sim = new GameSimulation({ seed: 1, playerSpawns: [stand],
        map: { collisionBoxes: greyboxCollisionBoxes(), shotBlockers: BUNKER_SHOT_BLOCKERS,
          walkSurfaces: BUNKER_WALK_SURFACES, zombieSpawns: [], wallWeapons: [wall] },
        roundConfig: { initialWaitTicks: 9999, intermissionTicks: 1 },
        economyConfig: { startingPoints: 5000, hitReward: 10, killBonus: 50 } });
      const player = sim.getPlayer(sim.playerIds[0])!;
      player.yaw = facing; // Players look along (-sin yaw, -cos yaw): back toward the wall.
      sim.tick();
      // Standing spot is real floor, and the chalk is visible through Bunker's actual walls.
      expect(player.position.y, wall.id).toBeCloseTo(stand.y);
      expect(sim.interactionCandidate(player.id)?.prompt, wall.id).toContain(`[${wall.weaponCost}]`);
    }
  });

  it('stocks the box with every weapon except the starting pistol, wonder weapons rarest', () => {
    const box = BUNKER_MYSTERY_BOXES[0];
    expect([...box.weapons].sort()).toEqual(Object.keys(WEAPON_DEFINITIONS).filter(id => id !== 'starter-pistol').sort());
    const weights = box.weapons.map(id => box.weights?.[id] ?? 1);
    expect(box.weights?.irrlicht).toBeLessThan(1);
    expect(box.weights?.molniya).toBeLessThan(box.weights!.irrlicht);
    // Roughly one roll in a hundred or fewer gives a given wonder weapon.
    expect(box.weights!.molniya / weights.reduce((a, b) => a + b, 0)).toBeLessThan(0.01);
  });
});

describe('wonder weapons and explosives', () => {
  const at = (id: `e:${number}`, z: number, x = 0, round = 10) => createZombieState(id, { x, y: 0, z }, round);

  it('Irrlicht bolts kill on impact and burst onto nearby zombies, but walls stop the burst', () => {
    const target = at('e:2', -6), beside = at('e:3', -6, 1.2), shielded = at('e:4', -6, -1.2);
    const wall = [{ min: { x: -0.9, y: 0, z: -7 }, max: { x: -0.7, y: 3, z: -5 } }];
    const events = shoot('irrlicht', [target, beside, shielded].map(zombie => zombie), false, 7);
    expect(events.some(event => event.type === 'weaponExploded')).toBe(true);
    expect(target.alive).toBe(false);
    expect(beside.health).toBeLessThan(1045);
    // Same shot again with a wall between the impact and the third zombie.
    const again = at('e:5', -6), hidden = at('e:6', -6, -1.2);
    const player = createPlayerState('e:1', origin);
    player.weapon = createWeaponState('irrlicht');
    firePlayerWeapon(player, rayFromPlayer(player, 1.3), [again, hidden], wall, false, 7);
    expect(hidden.health).toBe(1045);
    expect(shielded.health).toBeLessThan(1045);
  });

  it('Irrlicht hurts its shooter when fired into something close', () => {
    const player = createPlayerState('e:1', origin);
    player.weapon = createWeaponState('irrlicht');
    const events = firePlayerWeapon(player, rayFromPlayer(player, 1.3), [],
      [{ min: { x: -2, y: 0, z: -1.2 }, max: { x: 2, y: 3, z: -1 } }], false, 7);
    expect(events.map(event => event.type)).toContain('playerDamaged');
    expect(player.health).toBeLessThan(100);
    expect(player.health).toBeGreaterThan(50);
    const far = createPlayerState('e:1', origin);
    far.weapon = createWeaponState('irrlicht');
    firePlayerWeapon(far, rayFromPlayer(far, 1.3), [], [{ min: { x: -2, y: 0, z: -12 }, max: { x: 2, y: 3, z: -11 } }], false, 7);
    expect(far.health).toBe(100);
  });

  it('Molniya chains through up to five zombies in line of sight, weakening each jump', () => {
    const line = [0, 1, 2, 3, 4, 5].map(i => at(`e:${i + 2}`, -4 - i * 2.5, 0, 12));
    const events = shoot('molniya', line);
    const struck = events.filter(event => event.type === 'weaponHit');
    expect(struck).toHaveLength(5);
    expect(line[5].alive).toBe(true);
    const damages = struck.map(event => event.type === 'weaponHit' ? event.damage : 0);
    for (let i = 2; i < damages.length; i++) expect(damages[i]).toBeLessThanOrEqual(damages[i - 1]);
    const chain = events.find(event => event.type === 'weaponChained');
    expect(chain?.type === 'weaponChained' && chain.points).toHaveLength(6);

    const blocked = [at('e:20', -4, 0, 12), at('e:21', -6.5, 0, 12)];
    const player = createPlayerState('e:1', origin);
    player.weapon = createWeaponState('molniya');
    firePlayerWeapon(player, rayFromPlayer(player, 1.3), blocked,
      [{ min: { x: -1, y: 0, z: -5.4 }, max: { x: 1, y: 3, z: -5.2 } }], false, 7);
    expect(blocked[1].health).toBe(zombieHealth(12));
  });

  it('RPG-7 blasts a whole group and can hurt its shooter up close', () => {
    const group = [at('e:2', -10), at('e:3', -10, 1.5), at('e:4', -11.5, -1)];
    shoot('rpg7', group);
    expect(group.every(zombie => !zombie.alive)).toBe(true);
    expect(WEAPON_DEFINITIONS.rpg7.explosive!.selfDamage).toBeGreaterThan(WEAPON_DEFINITIONS.irrlicht.explosive!.selfDamage);
  });
});
