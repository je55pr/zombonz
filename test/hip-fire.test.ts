import { describe, expect, it } from 'vitest';
import {
  DEFAULT_AIM_SPREAD, PLAYER_MOVEMENT, SPREAD_RULES, WEAPON_DEFINITIONS, createPlayerState, createWeaponState, createZombieState,
  currentSpread, resolveHitscan, spreadHitscanRay, zombieChest, zombieHeadCentre, type PlayerState, type Vec3,
} from '../src/core/index.ts';
import { rayThrough } from './aim.ts';

const SHOTS = 600;

/** How often shots aimed at the middle of a standing zombie's head or chest, `range` metres off, hit it. */
function rates(player: PlayerState, range: number, target: 'head' | 'chest' = 'head') {
  const zombie = createZombieState('e:2', { x: 0, y: 0, z: -range }, 1);
  const eye: Vec3 = { x: 0, y: player.position.y + PLAYER_MOVEMENT.eyeHeight, z: 0 };
  const base = rayThrough(eye, target === 'head' ? zombieHeadCentre(zombie) : zombieChest(zombie));
  const spread = currentSpread(player);
  let head = 0, body = 0;
  for (let seed = 1; seed <= SHOTS; seed++) {
    const hit = resolveHitscan(spreadHitscanRay(base, spread, seed * 7919), [zombie], [], 200);
    if (hit.kind === 'zombie') { if (hit.hitZone === 'head') head++; else body++; }
  }
  return { head: head / SHOTS, body: body / SHOTS, spread };
}
const pistol = (patch: Partial<PlayerState> = {}) => Object.assign(createPlayerState('e:1', { x: 0, y: 0, z: 0 }), patch);

describe('hip-fire with the starting pistol', () => {
  it('is a matter of luck to hit a distant head: a few in a hundred at 30 m, hardly any at 50', () => {
    expect(rates(pistol(), 30).head).toBeLessThan(0.06);
    expect(rates(pistol(), 50).head).toBeLessThan(0.03);
  });

  it('still hits what is near: a body at 5 m is usually hit', () => {
    expect(rates(pistol(), 5, 'chest').body + rates(pistol(), 5, 'chest').head).toBeGreaterThan(0.85);
  });

  it('misses more of a body than it hits at long range', () => {
    const far = rates(pistol(), 40, 'chest');
    expect(far.body + far.head).toBeLessThan(0.3);
  });

  it('gets worse the farther the target', () => {
    const at = (range: number) => { const r = rates(pistol(), range, 'chest'); return r.body + r.head; };
    expect(at(5)).toBeGreaterThan(at(15));
    expect(at(15)).toBeGreaterThan(at(30));
    expect(at(30)).toBeGreaterThan(at(60));
  });

  it('gets worse on the move, and worse again sprinting', () => {
    const standing = currentSpread(pistol());
    const walking = currentSpread(pistol({ velocity: { x: PLAYER_MOVEMENT.maxSpeed, y: 0, z: 0 } }));
    const sprinting = currentSpread(pistol({ velocity: { x: PLAYER_MOVEMENT.maxSpeed, y: 0, z: 0 }, sprinting: true }));
    expect(walking).toBeGreaterThan(standing * 1.9);
    expect(sprinting).toBeGreaterThan(walking * 1.4);
    const at = (spread: number) => {
      const zombie = createZombieState('e:2', { x: 0, y: 0, z: -12 }, 1);
      const base = rayThrough({ x: 0, y: 1.62, z: 0 }, zombieChest(zombie));
      let hits = 0;
      for (let seed = 1; seed <= SHOTS; seed++) if (resolveHitscan(spreadHitscanRay(base, spread, seed * 7919), [zombie], [], 200).kind === 'zombie') hits++;
      return hits / SHOTS;
    };
    expect(at(standing)).toBeGreaterThan(at(walking));
    expect(at(walking)).toBeGreaterThan(at(sprinting));
  });

  it('loosens with every shot in a burst', () => {
    const player = pistol();
    const fresh = currentSpread(player);
    player.spreadBloom = SPREAD_RULES.maxBloom;
    expect(currentSpread(player)).toBeGreaterThan(fresh * 2);
  });
});

describe('aiming down the sights', () => {
  it('is a clear accuracy advantage: most shots at a head 30 m away land, against a few from the hip', () => {
    const hip = rates(pistol(), 30), aimed = rates(pistol({ aiming: true }), 30);
    expect(aimed.head).toBeGreaterThan(0.45);
    expect(aimed.head).toBeGreaterThan(hip.head * 10);
    expect(aimed.spread).toBeCloseTo(hip.spread * DEFAULT_AIM_SPREAD);
  });

  it('tightens every gun by at least a third, and a scoped rifle by twenty times', () => {
    for (const [id, definition] of Object.entries(WEAPON_DEFINITIONS)) {
      const player = pistol(); player.weapon = createWeaponState(id);
      const hip = currentSpread(player); player.aiming = true;
      expect(currentSpread(player), id).toBeLessThan(hip * (definition.aimSpreadMultiplier ?? DEFAULT_AIM_SPREAD) + 1e-9);
      expect(currentSpread(player), id).toBeLessThanOrEqual(hip * 0.6 + 1e-9);
    }
    const rifle = pistol(); rifle.weapon = createWeaponState('kar98k');
    const hip = currentSpread(rifle); rifle.aiming = true;
    expect(currentSpread(rifle)).toBeLessThan(hip / 19);
  });
});

describe('every gun', () => {
  it('spreads at least two degrees from the hip (except the rocket launcher and the wonder weapons), and no cone exceeds the cap', () => {
    for (const [id, definition] of Object.entries(WEAPON_DEFINITIONS)) {
      if (!['rpg7', 'irrlicht', 'molniya'].includes(id)) expect(definition.hipSpreadRadians, id).toBeGreaterThanOrEqual(0.035);
      const player = pistol({ sprinting: true, spreadBloom: SPREAD_RULES.maxBloom, velocity: { x: PLAYER_MOVEMENT.maxSpeed, y: 0, z: 0 } });
      player.weapon = createWeaponState(id);
      expect(currentSpread(player), id).toBeLessThanOrEqual(SPREAD_RULES.maxCone);
    }
  });

  it('scatters shots over a disc, not a square: none strays farther than the spread', () => {
    const base = { origin: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: -1 } };
    const spread = 0.05;
    let farthest = 0, insideHalf = 0;
    for (let seed = 1; seed <= 2000; seed++) {
      const { direction } = spreadHitscanRay(base, spread, seed * 104729);
      const angle = Math.hypot(direction.x, direction.y);
      farthest = Math.max(farthest, angle);
      if (angle < spread / 2) insideHalf++;
    }
    expect(farthest).toBeLessThanOrEqual(spread * 1.001);
    // Even over the area: a quarter of the shots fall within half the radius.
    expect(insideHalf / 2000).toBeGreaterThan(0.2);
    expect(insideHalf / 2000).toBeLessThan(0.3);
  });
});
