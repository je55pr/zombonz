import { describe, expect, it } from 'vitest';
import { HudFeedback } from '../src/client/feedback.ts';
import type { SimulationEvent } from '../src/core/simulation.ts';

describe('local combat feedback', () => {
  it('shows hit and kill markers without combat text', () => {
    const feedback = new HudFeedback();
    const events: SimulationEvent[] = [
      { type: 'weaponHit', playerId: 'e:1', zombieId: 'e:9', weaponId: 'bar', damage: 150, distance: 4, hitZone: 'head' },
      { type: 'zombieDied', playerId: 'e:1', zombieId: 'e:9', method: 'head' },
      { type: 'pointsAwarded', playerId: 'e:1', amount: 90, reason: 'headshot', balance: 600 },
    ];
    feedback.consume(events, 'e:1', 10);
    expect(feedback.snapshot(10)).toMatchObject({ message: null, hitMarker: 'kill' });
    expect(feedback.snapshot(30).hitMarker).toBeNull();
    expect(feedback.snapshot(116).message).toBeNull();
    feedback.consume([{ type: 'zombieDied', playerId: 'e:1', zombieId: 'e:10', method: 'melee' }], 'e:1', 117);
    expect(feedback.snapshot(117)).toMatchObject({ message: null, hitMarker: 'kill' });
  });

  it('ignores other players and clears indicators on restart', () => {
    const feedback = new HudFeedback();
    feedback.consume([{ type: 'playerDamaged', playerId: 'e:2', amount: 50, health: 50 }], 'e:1', 2);
    expect(feedback.snapshot(2).damageVignette).toBe(false);
    feedback.consume([{ type: 'playerDamaged', playerId: 'e:1', amount: 50, health: 50 }], 'e:1', 3);
    expect(feedback.snapshot(3)).toMatchObject({ message: null, damageVignette: true });
    feedback.consume([{ type: 'matchRestarted', previousSeed: 1, seed: 2 }], 'e:1', 4);
    expect(feedback.snapshot(4)).toEqual({ message: null, hitMarker: null, damageVignette: false, damagePulse: 0 });
  });

  it('fades the local damage pulse instead of snapping the vignette off', () => {
    const feedback = new HudFeedback();
    feedback.consume([{ type: 'playerDamaged', playerId: 'e:1', amount: 50, health: 50 }], 'e:1', 10);
    expect(feedback.snapshot(10).damagePulse).toBe(1);
    const middle = feedback.snapshot(26).damagePulse ?? 0;
    expect(middle).toBeGreaterThan(0);
    expect(middle).toBeLessThan(1);
    expect(feedback.snapshot(42)).toMatchObject({ damageVignette: false, damagePulse: 0 });
  });

  it('keeps important failures while routine purchases stay off centre screen', () => {
    const feedback = new HudFeedback();
    feedback.consume([{ type: 'wallWeaponPurchased', playerId: 'e:1', wallWeaponId: 'wall', weaponId: 'kar98k' }], 'e:1', 10);
    expect(feedback.snapshot(10).message).toBeNull();
    feedback.consume([{ type: 'wallWeaponAmmoFull', playerId: 'e:1', wallWeaponId: 'wall', weaponId: 'kar98k' }], 'e:1', 11);
    expect(feedback.snapshot(11).message).toBe('AMMO ALREADY FULL');
  });

  it('announces a team-wide Max Ammo pickup to every player', () => {
    const feedback = new HudFeedback();
    feedback.consume([{ type: 'powerupCollected', dropId: 'p:1', kind: 'maxAmmo', playerId: 'e:2' }], 'e:1', 50);
    expect(feedback.snapshot(50).message).toBe('MAX AMMO');
    feedback.consume([{ type: 'powerupCollected', dropId: 'p:2', kind: 'doublePoints', playerId: 'e:2' }], 'e:1', 51);
    expect(feedback.snapshot(51).message).toBe('DOUBLE POINTS');
    feedback.consume([{ type: 'powerupCollected', dropId: 'p:3', kind: 'instaKill', playerId: 'e:2' }], 'e:1', 52);
    expect(feedback.snapshot(52).message).toBe('INSTA-KILL');
    feedback.consume([{ type: 'powerupCollected', dropId: 'p:4', kind: 'nuke', playerId: 'e:2' }], 'e:1', 53);
    expect(feedback.snapshot(53).message).toBe('NUKE');
  });
});
