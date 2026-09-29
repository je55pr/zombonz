import type { ZombieGait } from './types.ts';

/**
 * How a zombie's melee is paced (see docs/combat.md). A swing has a wind-up, at the end of which the blow lands (if
 * the target is still in reach), and a recovery, after which it may swing again. The client plays the attack clip
 * from the swing's own tick count, so what is drawn is what the rules are doing.
 *
 * WaW gives runners and sprinters faster attack animations than walkers ("New faster hit ... when running", in
 * `_zombiemode.gsc`), so the pace quickens with the gait; the numbers themselves are ours.
 */
export const ZOMBIE_MELEE = {
  damage: 50,
  /** Ticks (at 60 a second) of wind-up, until the blow lands, and of recovery after it, for each gait. */
  swing: {
    walk: { windupTicks: 42, recoveryTicks: 54 },
    run: { windupTicks: 30, recoveryTicks: 42 },
    sprint: { windupTicks: 22, recoveryTicks: 34 },
  },
} as const satisfies { damage: number; swing: Record<ZombieGait, { windupTicks: number; recoveryTicks: number }> };

export interface SwingTiming {
  /** Ticks from the start of a swing until the blow lands. */
  windupTicks: number;
  /** Ticks in the whole swing. */
  totalTicks: number;
}

export function swingTiming(gait: ZombieGait): SwingTiming {
  const { windupTicks, recoveryTicks } = ZOMBIE_MELEE.swing[gait];
  return { windupTicks, totalTicks: windupTicks + recoveryTicks };
}
