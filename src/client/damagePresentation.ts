import { DOWN_RULES, type DownedState } from '../core/downs.ts';

/** 0 = minimal, 1 = reduced, 2 = full. Kept numeric so it fits the existing stepped settings UI. */
export type CombatEffectsLevel = 0 | 1 | 2;

export interface DamagePresentation {
  /** Persistent injury amount from 0 (healthy) to 1 (critical/downed). */
  injury: number;
  /** Extra hit pulse layered on top of the persistent injury. */
  pulse: number;
  /** Degrees to subtract from the player's chosen world FOV. */
  fovPenalty: number;
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

/** Shared presentation scale for particles/shake. Essential gameplay cues are not gated by this. */
export function combatEffectsScale(effects: number): number {
  const level = Math.max(0, Math.min(2, Math.round(effects)));
  return level >= 2 ? 1 : level >= 1 ? 0.45 : 0.15;
}

/** Injury starts becoming visible below 70% health and reaches 1 at zero. */
export function injuryProgress(health: number, maxHealth: number): number {
  if (!(maxHealth > 0)) return 0;
  const ratio = clamp01(health / maxHealth);
  return clamp01((0.7 - ratio) / 0.7);
}

/** How far through the 30-second bleedout the player is, from 0 just-down to 1 nearly out. */
export function bleedoutProgress(downed: Pick<DownedState, 'bleedoutTicks'> | null | undefined): number {
  if (!downed) return 0;
  return clamp01(1 - downed.bleedoutTicks / DOWN_RULES.bleedoutTicks);
}

/**
 * Presentation target for a local player's injury state.
 *
 * Full: up to 3° from ordinary injury, then 3° -> 5° through bleedout.
 * Reduced: half of that.
 * Minimal: no camera-FOV manipulation.
 */
export function damagePresentation(
  health: number,
  maxHealth: number,
  downed: Pick<DownedState, 'bleedoutTicks'> | null | undefined,
  hitPulse: number | boolean,
  effects: number,
): DamagePresentation {
  const level = Math.max(0, Math.min(2, Math.round(effects))) as CombatEffectsLevel;
  const injury = downed ? 1 : injuryProgress(health, maxHealth);
  const scale = level === 2 ? 1 : level === 1 ? 0.55 : 0.22;
  const rawPulse = typeof hitPulse === 'number' ? clamp01(hitPulse) : hitPulse ? 1 : 0;
  const pulse = level === 2 ? rawPulse : level === 1 ? rawPulse * 0.45 : 0;

  let fovPenalty = downed
    ? 3 + 2 * bleedoutProgress(downed)
    : 3 * injuryProgress(health, maxHealth);
  if (level === 1) fovPenalty *= 0.5;
  else if (level === 0) fovPenalty = 0;

  return { injury: injury * scale, pulse, fovPenalty };
}
