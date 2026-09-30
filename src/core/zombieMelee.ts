import { hashString } from './rng.ts';
import type { ZombieGait, ZombieState } from './types.ts';

/**
 * How a zombie's melee is paced and where it can reach (see docs/combat.md). A swing has a wind-up, at the end of which
 * the blow lands (on whoever is in reach in the blow's window, see `hitWindow`), and a recovery, after which it may swing again. The client plays
 * the attack clip from the swing's own tick count, so what is drawn is what the rules are doing.
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
  /** Ticks (at 60 a second) of wind-up, until the blow lands, and of recovery after it, for each gait. */
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
  reach: { startRange: 1.1, strikeRange: 1.3 },
  crawlerReach: { startRange: 0.9, strikeRange: 1.1 },
  /**
   * The blow's window (issue #210): the blow lands at contact (`windupTicks` in) on someone in reach then, but also on someone
   * who was in reach in the last `beforeTicks` of the arm coming down and has stepped out by contact, and on someone who
   * comes into reach up to `afterTicks` after, as the arm follows through. A single-tick check missed blows that looked like
   * they should land. Twelve ticks is a fifth of a second; a player who sidesteps is out of reach for all of it or is hit.
   */
  hitWindow: { beforeTicks: 4, afterTicks: 8 },
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
  hurtGraceTicks: 30,
} as const;

export interface SwingTiming {
  /** Ticks from the start of a swing until the blow lands. */
  windupTicks: number;
  /** Ticks in the whole swing. */
  totalTicks: number;
}

/** This zombie's swing: its gait's pace, stretched a little by its own tempo (fixed for the zombie's life). */
export function swingTiming(zombie: Pick<ZombieState, 'id' | 'gait'>): SwingTiming {
  const { windupTicks, recoveryTicks } = ZOMBIE_MELEE.swing[zombie.gait];
  const hash = hashString(zombie.id);
  const wind = windupTicks + hash % (ZOMBIE_MELEE.windupJitterTicks + 1);
  return { windupTicks: wind, totalTicks: wind + recoveryTicks + (hash >>> 8) % (ZOMBIE_MELEE.recoveryJitterTicks + 1) };
}
