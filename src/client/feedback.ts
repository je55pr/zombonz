import type { EntityId } from '../core/types.ts';
import type { SimulationEvent } from '../core/simulation.ts';

export interface FeedbackSnapshot {
  message: string | null;
  hitMarker: 'body' | 'head' | 'kill' | null;
  damageVignette: boolean;
  /** Smooth 1 -> 0 pulse after local damage; the boolean above remains for cheap HUD invalidation/tests. */
  damagePulse?: number;
}

/** Short, visual reactions to authoritative events. No gameplay decision lives here. */
export class HudFeedback {
  private message = '';
  private messageUntil = 0;
  private marker: FeedbackSnapshot['hitMarker'] = null;
  private markerUntil = 0;
  private hurtUntil = 0;
  private hurtStart = 0;
  private names = new Map<EntityId, string>();

  /** Teammates' names, for messages about them in a co-op game. */
  setNames(names: ReadonlyMap<EntityId, string>): void { this.names = new Map(names); }
  /** A message from outside the match (a player joining or leaving), shown like any other. */
  notice(message: string, tick: number): void { this.message = message; this.messageUntil = tick + 180; }

  consume(events: readonly SimulationEvent[], playerId: EntityId, tick: number): void {
    if (events.some(event => event.type === 'matchRestarted')) {
      this.message = ''; this.messageUntil = 0; this.marker = null;
      this.markerUntil = 0; this.hurtUntil = 0; this.hurtStart = 0;
      return;
    }
    let message = '';
    let priority = -1;
    const say = (value: string, rank: number) => {
      if (rank > priority) { message = value; priority = rank; }
    };
    for (const event of events) {
      // Word of a teammate going down, getting up or bleeding out.
      const teammate = 'playerId' in event && event.playerId && event.playerId !== playerId ? this.names.get(event.playerId) : undefined;
      if (teammate) {
        if (event.type === 'playerDowned') say(`${teammate.toUpperCase()} IS DOWN`, 8);
        else if (event.type === 'playerBledOut') say(`${teammate.toUpperCase()} BLED OUT`, 8);
        else if (event.type === 'playerRespawned') say(`${teammate.toUpperCase()} IS BACK`, 6);
      }
      if ('playerId' in event && event.playerId !== playerId
        && event.type !== 'zombieAttacked' && event.type !== 'powerupCollected' && event.type !== 'powerActivated'
        && !(event.type === 'playerRevived' && event.reviverId === playerId)) continue;
      switch (event.type) {
        case 'weaponHit': this.marker = event.hitZone === 'head' ? 'head' : 'body'; this.markerUntil = tick + 12; break;
        case 'meleeHit': this.marker = 'body'; this.markerUntil = tick + 12; break;
        case 'grenadeHit': this.marker = 'body'; this.markerUntil = tick + 12; break;
        case 'zombieDied':
          this.marker = 'kill'; this.markerUntil = tick + 16;
          break;
        case 'playerDamaged': this.hurtStart = tick; this.hurtUntil = tick + 32; break;
        case 'wallWeaponAmmoFull': say('AMMO ALREADY FULL', 3); break;
        case 'equipmentFull': say('EQUIPMENT FULL', 3); break;
        case 'mysteryBoxUnavailable': say('NO NEW WEAPONS IN BOX', 3); break;
        case 'pointsSpendRejected': say('NOT ENOUGH POINTS', 4); break;
        case 'powerActivated': say('THE POWER IS ON', 9); break;
        case 'playerDowned': say('YOU ARE DOWN', 10); break;
        case 'playerRevived': say(event.reviverId === playerId && event.playerId !== playerId ? 'TEAMMATE REVIVED' : 'REVIVED', 9); break;
        case 'playerRespawned': say('BACK IN THE FIGHT', 9); break;
        case 'mysteryBoxTeddy': say('BYE BYE — THE BOX IS MOVING', 6); break;
        case 'powerupCollected': say(event.kind === 'maxAmmo' ? 'MAX AMMO'
          : event.kind === 'doublePoints' ? 'DOUBLE POINTS'
            : event.kind === 'instaKill' ? 'INSTA-KILL' : event.kind === 'carpenter' ? 'CARPENTER' : 'NUKE', 8); break;
      }
    }
    if (message) { this.message = message; this.messageUntil = tick + 105; }
  }

  snapshot(tick: number): FeedbackSnapshot {
    const hurt = tick < this.hurtUntil ? Math.max(0, Math.min(1, (this.hurtUntil - tick) / Math.max(1, this.hurtUntil - this.hurtStart))) : 0;
    return {
      message: tick < this.messageUntil ? this.message : null,
      hitMarker: tick < this.markerUntil ? this.marker : null,
      damageVignette: hurt > 0,
      // Sixteen visual steps over the half-second pulse are smooth enough while avoiding a full HUD texture upload every frame.
      damagePulse: Math.round(hurt * hurt * 16) / 16,
    };
  }
}
