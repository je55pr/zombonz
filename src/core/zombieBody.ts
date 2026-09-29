import type { Vec3, ZombieState } from './types.ts';
import { swingTiming } from './zombieMelee.ts';
import { RIG_DATA, RIG_POINT_KEYS } from './zombieRigData.ts';

/**
 * Where a zombie's body is, for shots, blasts and swings. The simulation cannot run an animation, so a zombie is a
 * handful of capsules (a head, a torso, two arms, two legs) placed from what it is doing: the joint positions in
 * `zombieRigData.ts` were measured from the real models and their clips (see scripts/measure-zombie-rig.ts), and
 * turned to the zombie's facing. A zombie mid-swing is placed from the attack clip at the moment the swing is at, so
 * the head a player shoots at is where the head is drawn. Nothing here reads the clock or the renderer.
 */
export const ZOMBIE_RIG_IDS = ['soldier', 'walker'] as const;
export type ZombieRigId = typeof ZOMBIE_RIG_IDS[number];

/** The rig a zombie's `variant` (its look, chosen when it spawned) is drawn with. */
export const rigOf = (zombie: Pick<ZombieState, 'variant'>): ZombieRigId => ZOMBIE_RIG_IDS[zombie.variant % ZOMBIE_RIG_IDS.length];

/** How fast a zombie can turn, in radians a second: quick enough to follow a player round it, slow enough to be seen turning. */
export const ZOMBIE_TURN_RATE = 9;

/** Turns a zombie toward `heading` (radians, as the renderer turns a model) by at most one step. */
export function faceToward(zombie: Pick<ZombieState, 'yaw'>, heading: number, deltaSeconds: number): void {
  const difference = Math.atan2(Math.sin(heading - zombie.yaw), Math.cos(heading - zombie.yaw));
  const step = ZOMBIE_TURN_RATE * deltaSeconds;
  const yaw = zombie.yaw + Math.max(-step, Math.min(step, difference));
  zombie.yaw = Math.atan2(Math.sin(yaw), Math.cos(yaw));
}

export type BodyPart = 'head' | 'torso' | 'armL' | 'armR' | 'legL' | 'legR';

/** Bits of `ZombieState.limbs`: a set bit is a limb the zombie has lost. */
export const LIMB = { head: 1, armL: 2, armR: 4, legL: 8, legR: 16 } as const;
export type LimbId = keyof typeof LIMB;
export const LEGS_MASK = LIMB.legL | LIMB.legR;

/** What a zombie is doing with its body, which is what decides where its body is. */
export type ZombiePose = 'stand' | 'walk' | 'run' | 'swing' | 'tear' | 'vault' | 'crawl';

/** Radii of the capsules, in metres, from the measured extents of the models (skull 0.2, chest 0.39 x 0.32, limbs 0.13-0.2). */
export const BODY_RADII = { head: 0.12, torso: 0.18, upperArm: 0.075, foreArm: 0.07, thigh: 0.1, calf: 0.08 } as const;

/**
 * A crawler drags itself along on its arms and elbows, torso low and head up: authored, since neither model has a crawl
 * clip. The client bends the skeleton to match (see skinnedZombieView.ts). x, y, z for each of RIG_POINT_KEYS.
 */
const CRAWL_POINTS: readonly number[] = [
  0, 0.56, 0.62, // head (skull centre)
  0, 0.46, 0.42, // neck
  0, 0.4, 0.2, // chest
  0, 0.3, -0.18, // hips
  0.2, 0.42, 0.34, -0.2, 0.42, 0.34, // shoulders
  0.26, 0.24, 0.6, -0.26, 0.24, 0.6, // elbows
  0.28, 0.07, 0.86, -0.28, 0.07, 0.86, // hands
  0.1, 0.12, -0.56, -0.1, 0.12, -0.56, // knees
  0.1, 0.06, -0.92, -0.1, 0.06, -0.92, // feet
];
const CRAWL_BOB = 0.02;

export interface AttackWindow {
  /** Seconds into the rig's attack clip (which repeats past its end) where the swing starts, lands, and settles. */
  from: number;
  strike: number;
  to: number;
}

/**
 * The parts of each rig's attack clip a swing plays. Soldier: one slow overhead blow, landing 1.05 s in. Walker: an
 * arms-out flail that swipes with the right hand at 0.2 s and the left at 0.65 s, so each swing is one of the two.
 */
export const ATTACK_WINDOWS: Readonly<Record<ZombieRigId, readonly AttackWindow[]>> = {
  soldier: [{ from: 0, strike: 1.05, to: 1.85 }],
  walker: [{ from: 0.75, strike: 1.2, to: 1.7 }, { from: 0.25, strike: 0.65, to: 1.15 }],
};

export function attackDuration(rig: ZombieRigId): number { return RIG_DATA[rig].attack.duration; }

/**
 * Where in the attack clip (seconds, not yet wrapped) a swing is `ticks` in, given the ticks it winds up for and the
 * ticks it takes in all: the wind-up is played up to the blow and the recovery after it, whatever their lengths.
 */
export function attackClipTime(rig: ZombieRigId, style: number, ticks: number, windupTicks: number, totalTicks: number): number {
  const windows = ATTACK_WINDOWS[rig], window = windows[style % windows.length];
  if (ticks <= windupTicks) return window.from + (window.strike - window.from) * (ticks / windupTicks);
  return window.strike + (window.to - window.strike) * Math.min(1, (ticks - windupTicks) / Math.max(1, totalTicks - windupTicks));
}

type Point = readonly [number, number, number];
export interface PosePoints {
  /** x, y, z for each of RIG_POINT_KEYS, in the zombie's own frame. */
  points: readonly number[];
  /** How far the head bobs (metres, half the travel). */
  bob: number;
  /** The body is drawn squashed this much while it vaults, so it is hit that much lower. */
  squash: number;
}

const KEY_INDEX = Object.fromEntries(RIG_POINT_KEYS.map((key, index) => [key, index * 3])) as Record<typeof RIG_POINT_KEYS[number], number>;
const at = (pose: readonly number[], key: typeof RIG_POINT_KEYS[number]): Point => [pose[KEY_INDEX[key]], pose[KEY_INDEX[key] + 1], pose[KEY_INDEX[key] + 2]];

/** Which pose a zombie is in, from nothing but its own state. */
export function zombiePose(zombie: ZombieState): ZombiePose {
  if (zombie.limbs & LEGS_MASK) return 'crawl';
  if (zombie.attackTicks > 0) return 'swing';
  const phase = zombie.entry?.phase;
  if (phase === 'vaulting') return 'vault';
  if (phase === 'breaking' || (phase === 'approach' && Math.abs(zombie.velocity.y) > 0.05)) return 'tear';
  if (Math.hypot(zombie.velocity.x, zombie.velocity.z) > 0.05) return zombie.gait === 'walk' ? 'walk' : 'run';
  return 'stand';
}

/** Joint positions of the zombie's current pose, in its own frame. `swing` needs the swing's timing (see zombie melee). */
export function posePoints(rig: ZombieRigId, pose: ZombiePose, attackClipSeconds = 0): PosePoints {
  const data = RIG_DATA[rig];
  switch (pose) {
    case 'crawl': return { points: CRAWL_POINTS, bob: CRAWL_BOB, squash: 1 };
    case 'walk': return { points: data.walk.points, bob: data.walk.bob, squash: 1 };
    case 'run': return { points: data.run.points, bob: data.run.bob, squash: 1 };
    case 'vault': return { points: data.walk.points, bob: 0, squash: 0.85 };
    case 'tear': return { points: data.attack.mean, bob: 0.03, squash: 1 };
    case 'swing': {
      const samples = data.attack.samples, last = samples.length - 1;
      const wrapped = ((attackClipSeconds % data.attack.duration) + data.attack.duration) % data.attack.duration;
      const position = wrapped / data.attack.duration * last, index = Math.min(last - 1, Math.floor(position)), blend = position - index;
      const a = samples[index], b = samples[index + 1];
      return { points: a.map((value, i) => value + (b[i] - value) * blend), bob: 0, squash: 1 };
    }
    default: return { points: data.stand.points, bob: data.stand.bob, squash: 1 };
  }
}

export interface BodyVolume {
  part: BodyPart;
  a: Vec3;
  b: Vec3;
  radius: number;
}

/** Where in its model's attack clip (seconds) the zombie's current swing has got to. */
export function swingSeconds(zombie: ZombieState): number {
  const { windupTicks, totalTicks } = swingTiming(zombie);
  return attackClipTime(rigOf(zombie), zombie.attackStyle, zombie.attackTicks, windupTicks, totalTicks);
}

/** Everything about where a zombie's body is that the rest of the core needs, worked out once. */
export interface ZombieBody {
  pose: ZombiePose;
  points: PosePoints;
  /** Local frame to world: position plus left, up and forward. */
  toWorld(point: Point): Vec3;
  volumes(): BodyVolume[];
}

export function zombieBody(zombie: ZombieState): ZombieBody {
  const rig = rigOf(zombie), pose = zombiePose(zombie);
  const points = posePoints(rig, pose, pose === 'swing' ? swingSeconds(zombie) : 0);
  const sin = Math.sin(zombie.yaw), cos = Math.cos(zombie.yaw), squash = points.squash;
  const toWorld = ([x, y, z]: Point): Vec3 => ({
    x: zombie.position.x + x * cos + z * sin,
    y: zombie.position.y + y * squash,
    z: zombie.position.z - x * sin + z * cos,
  });
  const world = (key: typeof RIG_POINT_KEYS[number]) => toWorld(at(points.points, key));
  return {
    pose, points, toWorld,
    volumes() {
      const out: BodyVolume[] = [];
      const lost = zombie.limbs;
      if (!(lost & LIMB.head)) {
        const centre = at(points.points, 'head'), bob = points.bob * 0.7;
        out.push({ part: 'head', a: toWorld([centre[0], centre[1] - bob, centre[2]]), b: toWorld([centre[0], centre[1] + bob, centre[2]]),
          radius: BODY_RADII.head });
      }
      const hips = world('hips');
      // The torso runs from the pelvis to the base of the neck; the head has its own capsule above it.
      out.push({ part: 'torso', a: { ...hips, y: hips.y + 0.04 * squash }, b: world('neck'), radius: BODY_RADII.torso });
      for (const side of ['L', 'R'] as const) {
        if (!(lost & LIMB[`arm${side}`])) {
          const shoulder = world(`shoulder${side}`), elbow = world(`elbow${side}`), hand = world(`hand${side}`);
          out.push({ part: `arm${side}`, a: shoulder, b: elbow, radius: BODY_RADII.upperArm },
            { part: `arm${side}`, a: elbow, b: hand, radius: BODY_RADII.foreArm });
        }
        if (!(lost & LIMB[`leg${side}`])) {
          const knee = world(`knee${side}`), foot = world(`foot${side}`), hip = toWorld([(side === 'L' ? 1 : -1) * 0.11, at(points.points, 'hips')[1], at(points.points, 'hips')[2]]);
          out.push({ part: `leg${side}`, a: hip, b: knee, radius: BODY_RADII.thigh },
            { part: `leg${side}`, a: knee, b: foot, radius: BODY_RADII.calf });
        }
      }
      return out;
    },
  };
}

/** The middle of a zombie's chest: what a blast, a chain of lightning or a knife is aimed at. */
export function zombieChest(zombie: ZombieState): Vec3 {
  const body = zombieBody(zombie), pose = body.points.points;
  const chest = at(pose, 'chest'), hips = at(pose, 'hips');
  return body.toWorld([(chest[0] + hips[0]) / 2, (chest[1] + hips[1]) / 2, (chest[2] + hips[2]) / 2]);
}

/** The centre of a zombie's skull. */
export function zombieHeadCentre(zombie: ZombieState): Vec3 {
  const body = zombieBody(zombie);
  return body.toWorld(at(body.points.points, 'head'));
}

/** Farthest a body reaches from `position + (0, 0.8, 0)` in any pose: a cheap test before building capsules. */
export const BODY_REACH = 1.4;

/** Distance along a ray to a sphere, 0 if the ray starts inside it, or null. */
function raySphere(o: Vec3, d: Vec3, centre: Vec3, radius: number, maxDistance: number): number | null {
  const ox = o.x - centre.x, oy = o.y - centre.y, oz = o.z - centre.z;
  const b = ox * d.x + oy * d.y + oz * d.z, c = ox * ox + oy * oy + oz * oz - radius * radius;
  if (c <= 0) return 0;
  const disc = b * b - c;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  return t >= 0 && t <= maxDistance ? t : null;
}

/** Distance along a ray to a capsule (a segment `a`-`b` thickened by `radius`), 0 if it starts inside, or null. */
export function rayCapsuleDistance(o: Vec3, d: Vec3, a: Vec3, b: Vec3, radius: number, maxDistance: number): number | null {
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z, ab2 = abx * abx + aby * aby + abz * abz;
  if (ab2 < 1e-9) return raySphere(o, d, a, radius, maxDistance);
  const ox = o.x - a.x, oy = o.y - a.y, oz = o.z - a.z;
  const m = (abx * d.x + aby * d.y + abz * d.z) / ab2, n = (abx * ox + aby * oy + abz * oz) / ab2;
  // The part of the ray's offset from the axis that is not along it, as a function of the distance travelled.
  const px = ox - n * abx, py = oy - n * aby, pz = oz - n * abz;
  const qx = d.x - m * abx, qy = d.y - m * aby, qz = d.z - m * abz;
  const A = qx * qx + qy * qy + qz * qz, B = px * qx + py * qy + pz * qz, C = px * px + py * py + pz * pz - radius * radius;
  let best: number | null = null;
  if (C <= 0 && n >= 0 && n <= 1) return 0;
  if (A > 1e-12) {
    const disc = B * B - A * C;
    if (disc >= 0) {
      const t = (-B - Math.sqrt(disc)) / A, along = n + t * m;
      if (t >= 0 && t <= maxDistance && along >= 0 && along <= 1) best = t;
    }
  }
  for (const end of [a, b]) {
    const t = raySphere(o, d, end, radius, maxDistance);
    if (t !== null && (best === null || t < best)) best = t;
  }
  return best;
}

export interface BodyHit {
  distance: number;
  part: BodyPart;
  point: Vec3;
}

/**
 * The nearest part of a zombie's body a ray meets within `maxDistance`, or null. Where volumes overlap the nearer one is
 * hit; at equal distance the head is, then the torso, so a shot never lands on a limb through the skull.
 */
export function rayZombieBody(o: Vec3, d: Vec3, zombie: ZombieState, maxDistance: number): BodyHit | null {
  const centre = { x: zombie.position.x, y: zombie.position.y + 0.8, z: zombie.position.z };
  if (raySphere(o, d, centre, BODY_REACH, maxDistance) === null) return null;
  let best: BodyHit | null = null;
  for (const volume of zombieBody(zombie).volumes()) {
    const distance = rayCapsuleDistance(o, d, volume.a, volume.b, volume.radius, maxDistance);
    if (distance === null || (best !== null && distance >= best.distance)) continue;
    best = { distance, part: volume.part, point: { x: o.x + d.x * distance, y: o.y + d.y * distance, z: o.z + d.z * distance } };
  }
  return best;
}
