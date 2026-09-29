import { describe, expect, it } from 'vitest';
import {
  BODY_RADII, LIMB, ZOMBIE_RIG_IDS, createZombieState, resolveHitscan, rayCapsuleDistance, swingTiming, zombieBody,
  zombieChest, zombieHeadCentre, zombiePose, type ZombiePose, type ZombieState, type Vec3,
} from '../src/core/index.ts';
import { RIG_DATA } from '../src/core/zombieRigData.ts';

/** A zombie 6 m ahead of a shooter at the origin, put into each pose the way the simulation would. */
function zombieIn(pose: ZombiePose, variant = 0): ZombieState {
  const zombie = createZombieState('e:2', { x: 0, y: 0, z: -6 }, 1, pose === 'run' ? 'run' : 'walk', variant);
  switch (pose) {
    case 'walk': case 'run': zombie.velocity = { x: 0, y: 0, z: -1 }; break;
    case 'swing': zombie.attackTicks = swingTiming(zombie.gait).windupTicks; break;
    case 'crawl': zombie.limbs = LIMB.legL | LIMB.legR; break;
    case 'tear': case 'vault':
      zombie.entry = { barrierId: 'w', phase: pose === 'tear' ? 'breaking' : 'vaulting', waypointIndex: 1, phaseTicks: 0, lane: 0, vaultStart: null };
      break;
  }
  expect(zombiePose(zombie)).toBe(pose);
  return zombie;
}
const POSES: ZombiePose[] = ['stand', 'walk', 'run', 'swing', 'tear', 'vault', 'crawl'];
const eye: Vec3 = { x: 0, y: 1.62, z: 0 };
const shotAt = (zombie: ZombieState, at: Vec3, from = eye) => {
  const length = Math.hypot(at.x - from.x, at.y - from.y, at.z - from.z);
  return resolveHitscan({ origin: from, direction: { x: (at.x - from.x) / length, y: (at.y - from.y) / length, z: (at.z - from.z) / length } },
    [zombie], [], 60);
};

describe('a zombie’s body follows what it is doing', () => {
  it.each(POSES.flatMap(pose => ZOMBIE_RIG_IDS.map((_, variant) => [pose, variant] as const)))('%s, look %i: the head is where the head is', (pose, variant) => {
    const zombie = zombieIn(pose, variant), head = zombieHeadCentre(zombie);
    expect(shotAt(zombie, head)).toMatchObject({ kind: 'zombie', hitZone: 'head', part: 'head' });
    // Beside it, above it and below it by more than the skull is wide is not a headshot.
    for (const offset of [{ x: 0.3, y: 0, z: 0 }, { x: -0.3, y: 0, z: 0 }, { x: 0, y: 0.32, z: 0 }]) {
      const near = shotAt(zombie, { x: head.x + offset.x, y: head.y + offset.y, z: head.z });
      expect(near.kind === 'zombie' && near.hitZone === 'head', JSON.stringify(offset)).toBe(false);
    }
    // The chest is in the way of nothing, except that a crawler's head is out in front of it.
    const chest = shotAt(zombie, zombieChest(zombie));
    expect(chest.kind).toBe('zombie');
    if (pose !== 'crawl') expect(chest).toMatchObject({ hitZone: 'body' });
  });

  it('gives no headshots anywhere on the body below the skull', () => {
    const zombie = zombieIn('stand'), head = zombieHeadCentre(zombie);
    const lowest = head.y - BODY_RADII.head - 0.03;
    for (let y = 0.05; y < lowest; y += 0.05) {
      for (const x of [-0.25, -0.1, 0, 0.1, 0.25]) {
        const hit = shotAt(zombie, { x, y, z: -6 });
        if (hit.kind === 'zombie') expect(hit.hitZone, `x ${x} y ${y.toFixed(2)}`).toBe('body');
      }
    }
  });

  it('is far smaller than the old box: the skull is about 0.25 m across, not 0.64 m by 0.3 m', () => {
    const zombie = zombieIn('stand'), head = zombieHeadCentre(zombie);
    let across = 0;
    for (let x = -0.5; x <= 0.5; x += 0.01) {
      const hit = shotAt(zombie, { x: head.x + x, y: head.y, z: head.z });
      if (hit.kind === 'zombie' && hit.hitZone === 'head') across += 0.01;
    }
    expect(across).toBeGreaterThan(0.2);
    expect(across).toBeLessThan(0.3);
  });

  it('turns with the zombie', () => {
    const forward = zombieIn('walk'), turned = zombieIn('walk');
    turned.yaw = Math.PI / 2;
    const a = zombieHeadCentre(forward), b = zombieHeadCentre(turned);
    // The head sits a little ahead of the feet: ahead is +z at yaw 0 and +x a quarter turn later.
    expect(a.z - forward.position.z).toBeGreaterThan(0.1);
    expect(b.x - turned.position.x).toBeCloseTo(a.z - forward.position.z, 2);
    expect(b.z - turned.position.z).toBeCloseTo(-(a.x - forward.position.x), 2);
    expect(b.y).toBeCloseTo(a.y);
  });

  it('follows the animated head: a run leans it forward of a stand, a vault lowers it, a crawl drops it', () => {
    const height = (pose: ZombiePose) => zombieHeadCentre(zombieIn(pose)).y;
    const forward = (pose: ZombiePose) => zombieHeadCentre(zombieIn(pose)).z - -6;
    expect(forward('run')).toBeGreaterThan(forward('stand') + 0.05);
    expect(height('vault')).toBeCloseTo(height('walk') * 0.85, 2);
    expect(height('crawl')).toBeLessThan(0.7);
    expect(height('stand')).toBeGreaterThan(1.4);
    expect(height('stand')).toBeLessThan(1.6);
  });

  it('follows a swing: the head goes back in the wind-up and comes forward with the blow', () => {
    const zombie = zombieIn('swing'), { windupTicks, totalTicks } = swingTiming(zombie.gait);
    const heads = [1, windupTicks * 0.5, windupTicks, totalTicks - 1].map(ticks => { zombie.attackTicks = ticks; return zombieHeadCentre(zombie); });
    const travel = Math.max(...heads.map(h => h.z)) - Math.min(...heads.map(h => h.z));
    expect(travel).toBeGreaterThan(0.15);
    // Wherever it is, a shot at it goes through the head's own volume (a raised arm may be hit first).
    heads.forEach((head, i) => {
      zombie.attackTicks = [1, windupTicks * 0.5, windupTicks, totalTicks - 1][i];
      const volume = zombieBody(zombie).volumes().find(v => v.part === 'head')!;
      const direction = { x: head.x - eye.x, y: head.y - eye.y, z: head.z - eye.z };
      const length = Math.hypot(direction.x, direction.y, direction.z);
      expect(rayCapsuleDistance(eye, { x: direction.x / length, y: direction.y / length, z: direction.z / length }, volume.a, volume.b, volume.radius, 60)).not.toBeNull();
    });
  });

  it('is a different shape for each look: the walker stands taller and holds its arms out', () => {
    const soldier = zombieIn('stand', 0), walker = zombieIn('stand', 1);
    expect(zombieHeadCentre(walker).y).toBeGreaterThan(zombieHeadCentre(soldier).y + 0.05);
    const reach = (zombie: ZombieState) => Math.max(...zombieBody(zombie).volumes().filter(v => v.part.startsWith('arm')).map(v => Math.max(v.a.z, v.b.z)));
    const walking = (variant: number) => { const z = zombieIn('walk', variant); return reach(z) - z.position.z; };
    expect(walking(1)).toBeGreaterThan(walking(0) + 0.2);
  });

  it('loses the volumes of limbs that are gone, and keeps the rest', () => {
    const zombie = zombieIn('stand');
    const partsOf = () => new Set(zombieBody(zombie).volumes().map(v => v.part));
    expect([...partsOf()].sort()).toEqual(['armL', 'armR', 'head', 'legL', 'legR', 'torso']);
    zombie.limbs = LIMB.armL | LIMB.head;
    expect([...partsOf()].sort()).toEqual(['armR', 'legL', 'legR', 'torso']);
    const shoulder = zombieBody(zombie).volumes().find(v => v.part === 'torso')!;
    expect(shotAt(zombie, shoulder.b).kind).toBe('zombie');
  });

  it('is pure: the same zombie always has the same body', () => {
    const zombie = zombieIn('run');
    expect(zombieBody(zombie).volumes()).toEqual(zombieBody(zombie).volumes());
    expect(zombieHeadCentre(zombie)).toEqual(zombieHeadCentre({ ...zombie }));
  });
});

describe('the measured rigs', () => {
  it('put the head and hips where the models put them (a stooped 1.4-1.7 m zombie, not a 1.72 m box)', () => {
    for (const rig of ['soldier', 'walker'] as const) {
      for (const pose of ['stand', 'walk', 'run'] as const) {
        const [, headY] = RIG_DATA[rig][pose].points.slice(0, 3), hipsY = RIG_DATA[rig][pose].points[10];
        expect(headY, `${rig} ${pose}`).toBeGreaterThan(1.35);
        expect(headY, `${rig} ${pose}`).toBeLessThan(1.7);
        expect(hipsY, `${rig} ${pose}`).toBeGreaterThan(0.6);
        expect(hipsY, `${rig} ${pose}`).toBeLessThan(0.9);
      }
    }
  });
});

describe('capsule ray tests', () => {
  const a = { x: 0, y: 0, z: 0 }, b = { x: 0, y: 2, z: 0 };
  it('hits the side, the caps and the inside, and misses past the ends', () => {
    expect(rayCapsuleDistance({ x: -3, y: 1, z: 0 }, { x: 1, y: 0, z: 0 }, a, b, 0.5, 10)).toBeCloseTo(2.5);
    expect(rayCapsuleDistance({ x: 0, y: 5, z: 0 }, { x: 0, y: -1, z: 0 }, a, b, 0.5, 10)).toBeCloseTo(2.5);
    expect(rayCapsuleDistance({ x: 0, y: 1, z: 0.1 }, { x: 1, y: 0, z: 0 }, a, b, 0.5, 10)).toBe(0);
    expect(rayCapsuleDistance({ x: -3, y: 3, z: 0 }, { x: 1, y: 0, z: 0 }, a, b, 0.5, 10)).toBeNull();
    expect(rayCapsuleDistance({ x: -3, y: 1, z: 0 }, { x: 1, y: 0, z: 0 }, a, b, 0.5, 2)).toBeNull();
    // A degenerate capsule is a sphere.
    expect(rayCapsuleDistance({ x: -3, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, a, a, 1, 10)).toBeCloseTo(2);
  });
});
