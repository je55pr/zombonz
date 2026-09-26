/** Stable, sparse fluorescent flicker. Presentation only; never feeds the simulation. */
export function lampFlicker(tick: number, offset: number): number {
  const phase = (Math.floor(tick) + offset) % 421;
  if (phase < 3) return 0.45;
  if (phase === 3) return 1.08;
  if (phase >= 149 && phase < 153) return 0.74;
  return 1 + Math.sin(tick * 0.028 + offset) * 0.012;
}
