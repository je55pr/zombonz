import { hashString } from './rng.ts';
import type { ZombieGait, ZombieState } from './types.ts';

/**
 * How a zombie's melee is paced and where it can reach (see docs/combat.md). A swing has a wind-up, at the end of which
 * the arm comes down, and a recovery, after which it may swing again. The blow is live from `liveFrom` of the way through
 * the swing (well before the arm is drawn coming down) to its end, once: whoever is in reach at any point in that stretch is
 * hit. The client plays the attack clip from the swing's own tick count.
 *
 * WaW gives runners and sprinters faster attack animations than walkers ("New faster hit ... when running", in
 * `_zombiemode.gsc`), so the pace quickens with the gait; the numbers themselves are ours. Its zombies also start a
 * melee from 64 units (1.6 m) with a maximum of two starting per frame; ours start from closer and are kept apart
 * in time by each zombie's own tempo and by the player's brief grace after a hit.
 */
const SWING: Readonly<Record<ZombieGait, { windupTicks: number; recoveryTicks: number }>> = {
  walk: { windupTicks: 42, recoveryTicks: 54 },
  run: { windupTicks: 30, recoveryTicks: 42 },
  sprint: { windupTicks: 22, recoveryTicks: 34 },
};

export const ZOMBIE_MELEE = {
  damage: 50,
  /** Ticks (at 60 a second) of wind-up, until the arm comes down, and of recovery after it, for each gait. */
  swing: SWING,
  /** Each zombie's own tempo: up to this many ticks more of wind-up and of recovery, fixed by its id, so a group never swings in step. */
  windupJitterTicks: 12,
  recoveryJitterTicks: 10,
  /** The most (seeded) ticks between a swing ending and the next beginning. */
  gapTicks: 8,
  /**
   * Farthest across the floor, in metres, a swing may start from and a blow still lands from; the difference is the
   * lunge a player can step back out of. Crawlers reach less far.
   */
  reach: { startRange: 1.1, strikeRange: 1.8 },
  crawlerReach: { startRange: 0.9, strikeRange: 1.6 },
  /**
   * How far through a swing (as a share of its whole length) the blow goes live (issue #210). From then to the swing's end,
   * being in reach lands it, once. 0.4 is about when the arm is drawn coming down (the wind-up is 42 to 45% of a swing on average); lower
   * and blows land sooner (0.1 is almost at once). It used to be a single tick there, so a player who waited out the animation
   * and stepped back at the end avoided it altogether.
   */
  liveFrom: 0.4,
  /**
   * A zombie also starts its swing early, when the player, going at the speed and heading they have now, and the zombie,
   * still coming, will be within strike range as the blow lands (issue #210): otherwise a player who runs up to a zombie
   * and turns away is out of reach before the wind-up ends, and no blow ever connects. It looks no further ahead than
   * `maxLeadMetres` of the two's travel, so it never starts from further out than that and a fast player still outruns
   * a slow wind-up.
   */
  anticipation: { maxLeadMetres: 2 },
  /** Highest a target may be above or below the zombie's feet: a swing does not reach another floor. */
  maxHeightDelta: 0.9,
  /** Widest angle (radians) between where the zombie faces and where its target is, to start a swing and to land one. */
  startArc: 0.9,
  strikeArc: 1.3,
  /** After a blow lands the player is safe from every other zombie's for this many ticks, so a group's blows come one at a time. */
  hurtGraceTicks: 24,
} as const;

export interface SwingTiming {
  /** Ticks from the start of a swing until the arm comes down (what the animation's strike frame is played at). */
  windupTicks: number;
  /** Ticks in the whole swing. */
  totalTicks: number;
  /** The tick the blow goes live: from here to `totalTicks`, being in reach lands it. */
  blowTicks: number;
}

/** This zombie's swing: its gait's pace, stretched a little by its own tempo (fixed for the zombie's life). */
export function swingTiming(zombie: Pick<ZombieState, 'id' | 'gait'>): SwingTiming {
  const { windupTicks, recoveryTicks } = ZOMBIE_MELEE.swing[zombie.gait];
  const hash = hashString(zombie.id);
  const wind = windupTicks + hash % (ZOMBIE_MELEE.windupJitterTicks + 1);
  const total = wind + recoveryTicks + (hash >>> 8) % (ZOMBIE_MELEE.recoveryJitterTicks + 1);
  return { windupTicks: wind, totalTicks: total, blowTicks: Math.max(1, Math.ceil(total * ZOMBIE_MELEE.liveFrom)) };
}
