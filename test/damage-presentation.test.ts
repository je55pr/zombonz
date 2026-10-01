import { describe, expect, it } from 'vitest';
import { DOWN_RULES } from '../src/core/downs.ts';
import { combatEffectsScale, damagePresentation, injuryProgress } from '../src/client/damagePresentation.ts';

describe('player damage presentation', () => {
  it('uses health percentage, so Jugger-Nog and normal health feel equally injured', () => {
    expect(injuryProgress(50, 100)).toBeCloseTo(injuryProgress(125, 250));
    expect(damagePresentation(50, 100, null, 0, 2).fovPenalty)
      .toBeCloseTo(damagePresentation(125, 250, null, 0, 2).fovPenalty);
  });

  it('does not touch a healthy camera and tightens gently as health falls', () => {
    expect(damagePresentation(100, 100, null, 0, 2).fovPenalty).toBe(0);
    expect(damagePresentation(70, 100, null, 0, 2).fovPenalty).toBeCloseTo(0);
    expect(damagePresentation(50, 100, null, 0, 2).fovPenalty).toBeCloseTo(0.857, 2);
    expect(damagePresentation(20, 100, null, 0, 2).fovPenalty).toBeCloseTo(2.143, 2);
    expect(damagePresentation(1, 100, null, 0, 2).fovPenalty).toBeLessThanOrEqual(3);
  });

  it('starts last stand at three degrees tighter and reaches five only at the end of bleedout', () => {
    expect(damagePresentation(0, 100, { bleedoutTicks: DOWN_RULES.bleedoutTicks }, 0, 2).fovPenalty).toBe(3);
    expect(damagePresentation(0, 100, { bleedoutTicks: DOWN_RULES.bleedoutTicks / 2 }, 0, 2).fovPenalty).toBe(4);
    expect(damagePresentation(0, 100, { bleedoutTicks: 0 }, 0, 2).fovPenalty).toBe(5);
  });

  it('makes Reduced gentler and Minimal informational only', () => {
    const full = damagePresentation(20, 100, null, 1, 2);
    const reduced = damagePresentation(20, 100, null, 1, 1);
    const minimal = damagePresentation(20, 100, null, 1, 0);
    expect(reduced.fovPenalty).toBeCloseTo(full.fovPenalty * 0.5);
    expect(reduced.injury).toBeLessThan(full.injury);
    expect(reduced.pulse).toBeLessThan(full.pulse);
    expect(minimal.fovPenalty).toBe(0);
    expect(minimal.pulse).toBe(0);
    expect(minimal.injury).toBeGreaterThan(0); // low-health warning remains visible
  });

  it('shares a bounded effects scale for gore and impact particles', () => {
    expect(combatEffectsScale(2)).toBe(1);
    expect(combatEffectsScale(1)).toBe(0.45);
    expect(combatEffectsScale(0)).toBe(0.15);
    expect(combatEffectsScale(99)).toBe(1);
  });
});
