import { describe, expect, it } from 'vitest';
import { assetExists } from '../scripts/inspect-assets.mjs';
import { gunClip, loudestWindowDb, normalisingGain, softCeilingCurve } from '../src/client/audio.ts';
import { WEAPON_DEFINITIONS } from '../src/core/weapon.ts';

describe('audio mix', () => {
  it('normalises every clip to the same loudest-window level, within the trim limit', () => {
    const tone = (amplitude: number) => Float32Array.from({ length: 32000 }, (_, i) => amplitude * Math.sin(i / 5));
    // A full-scale sine is about -3 dBFS RMS; a quarter-scale one about -15 dBFS.
    expect(loudestWindowDb(tone(1), 32000)).toBeCloseTo(-3, 0);
    expect(loudestWindowDb(tone(0.25), 32000)).toBeCloseTo(-15, 0);
    // Loud clips are cut and quiet ones raised to -12 dB, so a board break can't drown out a gunshot.
    expect(20 * Math.log10(normalisingGain(-3))).toBeCloseTo(-9);
    expect(20 * Math.log10(normalisingGain(-15))).toBeCloseTo(3);
    expect(20 * Math.log10(normalisingGain(-60))).toBeCloseTo(12);
    expect(normalisingGain(-Infinity)).toBe(1);
  });

  it('passes normal levels through untouched and caps overlaps just under full scale', () => {
    const curve = softCeilingCurve(4001);
    const at = (x: number) => curve[Math.round((x + 1) / 2 * 4000)];
    expect(at(0.5)).toBeCloseTo(0.5);
    expect(at(-0.7)).toBeCloseTo(-0.7);
    expect(at(1)).toBeLessThan(0.95);
    expect(at(1)).toBeGreaterThan(at(0.85));
  });

  it('gives every gun a recorded shot that ships with the game', () => {
    for (const id of Object.keys(WEAPON_DEFINITIONS)) {
      const { clip } = gunClip(id);
      expect(assetExists(`public/assets/audio/${clip}.mp3`), `${id} -> ${clip}`).toBe(true);
    }
    // Close-up takes per family, rather than one sound for every rifle or SMG.
    expect(gunClip('thompson').clip).not.toBe(gunClip('ppsh41').clip);
    expect(gunClip('kar98k').clip).not.toBe(gunClip('mosin').clip);
    expect(gunClip('trench-gun').clip).not.toBe(gunClip('double-barrel').clip);
  });
});
