import { describe, expect, it } from 'vitest';
import {
  GameSimulation, WEAPON_DEFINITIONS, createPlayerState, createWeaponState, createZombieState, firePlayerWeapon,
  rayFromPlayer, weaponName, type ZombieState,
} from '../src/core/index.ts';
import {
  NACHT_MYSTERY_BOXES, NACHT_SHOT_BLOCKERS, NACHT_WALK_SURFACES, NACHT_WALL_WEAPONS, NACHT_WALL_WEAPON_FACING,
  UPPER_HEIGHT, greyboxCollisionBoxes,
} from '../src/maps/nacht.ts';

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

  it('places the WaW Nacht wall buys, with ammo at half price', () => {
    const walls = Object.fromEntries(NACHT_WALL_WEAPONS.map(wall => [wall.weaponId, wall]));
    expect(Object.keys(walls).sort()).toEqual(['bar', 'double-barrel', 'kar98k', 'thompson', 'trench-gun']);
    expect(walls['trench-gun'].weaponCost).toBe(1500);
    expect(walls.bar.weaponCost).toBe(1800);
    expect(walls['trench-gun'].position.y).toBeGreaterThan(UPPER_HEIGHT);
    expect(walls.bar.position.y).toBeGreaterThan(UPPER_HEIGHT);
    for (const wall of NACHT_WALL_WEAPONS) {
      expect(wall.ammoCost).toBe(wall.weaponCost / 2);
      expect(NACHT_WALL_WEAPON_FACING[wall.id], wall.id).toBeDefined();
    }
  });

  it('can buy every wall weapon from real Nacht floor in front of it', () => {
    for (const wall of NACHT_WALL_WEAPONS) {
      const facing = NACHT_WALL_WEAPON_FACING[wall.id];
      const stand = { x: wall.position.x + Math.sin(facing) * 1.2, y: wall.position.y - 1,
        z: wall.position.z + Math.cos(facing) * 1.2 };
      const sim = new GameSimulation({ seed: 1, playerSpawns: [stand],
        map: { collisionBoxes: greyboxCollisionBoxes(), shotBlockers: NACHT_SHOT_BLOCKERS,
          walkSurfaces: NACHT_WALK_SURFACES, zombieSpawns: [], wallWeapons: [wall] },
        roundConfig: { initialWaitTicks: 9999, intermissionTicks: 1 },
        economyConfig: { startingPoints: 5000, hitReward: 10, killBonus: 50 } });
      const player = sim.getPlayer(sim.playerIds[0])!;
      player.yaw = facing; // Players look along (-sin yaw, -cos yaw): back toward the wall.
      sim.tick();
      // Standing spot is real floor, and the chalk is visible through Nacht's actual walls.
      expect(player.position.y, wall.id).toBeCloseTo(stand.y);
      expect(sim.interactionCandidate(player.id)?.prompt, wall.id).toContain(`[${wall.weaponCost}]`);
    }
  });

  it('stocks the box with every weapon except the starting pistol', () => {
    const pool = NACHT_MYSTERY_BOXES[0].weapons;
    expect([...pool].sort()).toEqual(Object.keys(WEAPON_DEFINITIONS).filter(id => id !== 'starter-pistol').sort());
  });
});
