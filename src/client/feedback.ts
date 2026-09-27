import type { EntityId } from '../core/types.ts';
import type { SimulationEvent } from '../core/simulation.ts';
import { weaponName } from '../core/weapon.ts';
import { PERKS } from '../core/perks.ts';

export interface FeedbackSnapshot {
  message: string | null;
  hitMarker: 'body' | 'head' | 'kill' | null;
  damageVignette: boolean;
}

/** Short, visual reactions to authoritative events. No gameplay decision lives here. */
export class HudFeedback {
  private message = '';
  private messageUntil = 0;
  private marker: FeedbackSnapshot['hitMarker'] = null;
  private markerUntil = 0;
  private hurtUntil = 0;

  consume(events: readonly SimulationEvent[], playerId: EntityId, tick: number): void {
    if (events.some(event => event.type === 'matchRestarted')) {
      this.message = ''; this.messageUntil = 0; this.marker = null;
      this.markerUntil = 0; this.hurtUntil = 0;
      return;
    }
    let message = '';
    let priority = -1;
    const say = (value: string, rank: number) => {
      if (rank > priority) { message = value; priority = rank; }
    };
    for (const event of events) {
      if ('playerId' in event && event.playerId !== playerId
        && event.type !== 'zombieAttacked' && event.type !== 'powerupCollected' && event.type !== 'powerActivated') continue;
      switch (event.type) {
        case 'weaponHit': this.marker = event.hitZone === 'head' ? 'head' : 'body'; this.markerUntil = tick + 12; break;
        case 'meleeHit': this.marker = 'body'; this.markerUntil = tick + 12; break;
        case 'grenadeHit': this.marker = 'body'; this.markerUntil = tick + 12; break;
        case 'zombieDied':
          this.marker = 'kill'; this.markerUntil = tick + 16;
          if (event.method === 'head') say('HEADSHOT', 5);
          else if (event.method === 'melee') say('KNIFE KILL', 5);
          break;
        case 'playerDamaged': this.hurtUntil = tick + 32; say('TAKE COVER', 6); break;
        case 'weaponReloadStarted': say('RELOADING', 1); break;
        case 'weaponReloadCompleted': say('READY', 1); break;
        case 'wallWeaponPurchased': say(`${weaponName(event.weaponId).toUpperCase()} ACQUIRED`, 3); break;
        case 'wallWeaponAmmoPurchased': say('AMMO REFILLED', 3); break;
        case 'wallWeaponAmmoFull': say('AMMO ALREADY FULL', 3); break;
        case 'mysteryBoxUsed': say('THE BOX IS ROLLING', 3); break;
        case 'mysteryBoxClaimed': say(`${weaponName(event.weaponId).toUpperCase()} CLAIMED`, 4); break;
        case 'mysteryBoxUnavailable': say('NO NEW WEAPONS IN BOX', 3); break;
        case 'pointsSpendRejected': say('NOT ENOUGH POINTS', 4); break;
        case 'doorOpened': say('PATH OPENED', 3); break;
        case 'powerActivated': say('THE POWER IS ON', 9); break;
        case 'perkBought': say(PERKS[event.perk].name.toUpperCase(), 5); break;
        case 'playerRevived': say('QUICK REVIVE SPENT', 9); break;
        case 'trapActivated': say('ELECTRIC TRAP ACTIVE', 4); break;
        case 'mysteryBoxTeddy': say('BYE BYE — THE BOX IS MOVING', 6); break;
        case 'powerupCollected': say(event.kind === 'maxAmmo' ? 'MAX AMMO'
          : event.kind === 'doublePoints' ? 'DOUBLE POINTS'
            : event.kind === 'instaKill' ? 'INSTA-KILL' : 'NUKE', 8); break;
      }
    }
    if (message) { this.message = message; this.messageUntil = tick + 105; }
  }

  snapshot(tick: number): FeedbackSnapshot {
    return {
      message: tick < this.messageUntil ? this.message : null,
      hitMarker: tick < this.markerUntil ? this.marker : null,
      damageVignette: tick < this.hurtUntil,
    };
  }
}
