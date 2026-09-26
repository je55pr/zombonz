import { describe, expect, it } from 'vitest';
import { powerupBlinkVisible } from '../src/client/powerupView.ts';
import { DEFAULT_POWERUP_CONFIG } from '../src/core/index.ts';

describe('power-up expiry blink', () => {
  it('stays solid for fifteen seconds, then blinks faster until it expires', () => {
    const lifetime = DEFAULT_POWERUP_CONFIG.lifetimeTicks;
    for (let elapsed = 0; elapsed < 900; elapsed += 10) expect(powerupBlinkVisible(lifetime - elapsed)).toBe(true);
    expect(powerupBlinkVisible(lifetime - 900)).toBe(true);
    expect(powerupBlinkVisible(lifetime - 930)).toBe(false);
    expect(powerupBlinkVisible(lifetime - 960)).toBe(true);
    // The last flashes are a tenth of a second (6 ticks) apart.
    expect(powerupBlinkVisible(6)).not.toBe(powerupBlinkVisible(12));
  });
});
