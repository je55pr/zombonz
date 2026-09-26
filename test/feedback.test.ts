import { describe, expect, it } from 'vitest';
import { HudFeedback } from '../src/client/feedback.ts';
import type { SimulationEvent } from '../src/core/simulation.ts';

describe('local combat feedback', () => {
  it('shows the local hit and kill once, then expires', () => {
    const feedback = new HudFeedback();
    const events: SimulationEvent[] = [
      { type: 'weaponHit', playerId: 'e:1', zombieId: 'e:9', weaponId: 'bar', damage: 150, distance: 4, hitZone: 'head' },
      { type: 'zombieDied', playerId: 'e:1', zombieId: 'e:9', method: 'head' },
      { type: 'pointsAwarded', playerId: 'e:1', amount: 90, reason: 'headshot', balance: 600 },
    ];
    feedback.consume(events, 'e:1', 10);
    expect(feedback.snapshot(10)).toMatchObject({ message: 'HEADSHOT', hitMarker: 'kill' });
    expect(feedback.snapshot(30).hitMarker).toBeNull();
    expect(feedback.snapshot(116).message).toBeNull();
  });

  it('ignores other players and clears indicators on restart', () => {
    const feedback = new HudFeedback();
    feedback.consume([{ type: 'playerDamaged', playerId: 'e:2', amount: 50, health: 50 }], 'e:1', 2);
    expect(feedback.snapshot(2).damageVignette).toBe(false);
    feedback.consume([{ type: 'playerDamaged', playerId: 'e:1', amount: 50, health: 50 }], 'e:1', 3);
    expect(feedback.snapshot(3)).toMatchObject({ message: 'TAKE COVER', damageVignette: true });
    feedback.consume([{ type: 'matchRestarted', previousSeed: 1, seed: 2 }], 'e:1', 4);
    expect(feedback.snapshot(4)).toEqual({ message: null, hitMarker: null, damageVignette: false });
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
