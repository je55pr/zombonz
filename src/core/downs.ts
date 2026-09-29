import type { DamageEvent } from './health.ts';
import { hasPerk, SOLO_QUICK_REVIVE_LIMIT, type PerkId } from './perks.ts';
import type { EntityId, PlayerState, WeaponState } from './types.ts';

/**
 * World at War's last stand. A killing blow puts a player down with a pistol instead: zombies ignore
 * them, a teammate holding use beside them revives them, and otherwise they bleed out. Going down
 * costs every perk. With no one left standing to revive, the downed die and the game is over.
 */
export const DOWN_RULES = {
  bleedoutTicks: 30 * 60,
  reviveTicks: 3 * 60,
  /** Quick Revive halves the time it takes to revive a teammate. */
  quickReviveTicks: 1.5 * 60,
  /** Solo Quick Revive, as in Black Ops: the player gets back up by themselves, at most three times. */
  selfReviveTicks: 10 * 60,
  soloQuickReviveLimit: SOLO_QUICK_REVIVE_LIMIT,
  reviveRange: 1.6,
  /** The last-stand pistol and its spare ammo. */
  pistol: 'starter-pistol', pistolReserve: 48,
  /** Eye height while down, for the camera and shooting. */
  eyeHeight: 0.62,
} as const;

export interface DownedState {
  bleedoutTicks: number;
  /** Progress of the revive under way, in ticks; it resets whenever the reviver lets go. */
  reviveTicks: number;
  reviverId: EntityId | null;
  /** Getting back up alone with solo Quick Revive, rather than waiting for a teammate. */
  selfRevive: boolean;
  lostPerks: PerkId[];
  /** The guns put away for the pistol, handed back on revive. */
  stashed: { weapon: WeaponState; holstered: WeaponState | null };
}
export type DownEvent =
  | { type: 'playerRevived'; playerId: EntityId; reviverId: EntityId | null }
  | { type: 'playerBledOut'; playerId: EntityId }
  | { type: 'playerRespawned'; playerId: EntityId };

export function isDowned(player: PlayerState): boolean {
  return player.downed !== null;
}
/** Up and fighting: alive and not down. Zombies only go after standing players. */
export function isStanding(player: PlayerState): boolean {
  return player.alive && player.downed === null;
}

/**
 * Puts a player down in place of death. The simulation then hands over the last-stand pistol (see
 * `armDowned`), since the weapon code depends on this module's caller.
 */
export function goDown(player: PlayerState): DamageEvent[] {
  player.downed = {
    bleedoutTicks: DOWN_RULES.bleedoutTicks, reviveTicks: 0, reviverId: null, selfRevive: false,
    lostPerks: [...player.perks], stashed: { weapon: player.weapon, holstered: player.holsteredWeapon },
  };
  player.perks = [];
  player.health = 0;
  player.velocity = { x: 0, y: 0, z: 0 };
  player.sprinting = false; player.aiming = false;
  return [{ type: 'playerDowned', playerId: player.id, amount: 0, health: 0 }];
}

/** Swaps a newly downed player's guns for the last-stand pistol. Returns whether it did. */
export function armDowned(player: PlayerState, pistol: WeaponState): boolean {
  if (!player.downed || player.weapon !== player.downed.stashed.weapon) return false;
  player.weapon = pistol;
  player.holsteredWeapon = null;
  player.switchTicksRemaining = 0;
  return true;
}

export function revivePlayer(player: PlayerState, reviverId: EntityId | null, health: number): DownEvent[] {
  if (!player.downed) return [];
  player.weapon = player.downed.stashed.weapon;
  player.holsteredWeapon = player.downed.stashed.holstered;
  player.weapon.reloadTicksRemaining = 0;
  player.downed = null;
  player.health = health;
  player.recoveryDelayTicks = 0;
  return [{ type: 'playerRevived', playerId: player.id, reviverId }];
}

/** The downed teammate a standing player is close enough to revive, nearest first. */
export function reviveTarget(reviver: PlayerState, players: readonly PlayerState[]): PlayerState | null {
  if (!isStanding(reviver)) return null;
  let best: PlayerState | null = null, bestDistance: number = DOWN_RULES.reviveRange;
  for (const player of players) {
    if (player.id === reviver.id || !player.alive || !player.downed || Math.abs(player.position.y - reviver.position.y) > 1) continue;
    const distance = Math.hypot(player.position.x - reviver.position.x, player.position.z - reviver.position.z);
    if (distance <= bestDistance) { best = player; bestDistance = distance; }
  }
  return best;
}

/**
 * Advances every downed player one tick. `revivers` maps each downed player to the teammate holding
 * use beside them this tick. Returns the events, including bleed-outs (the player is then dead).
 */
export function tickDowns(players: readonly PlayerState[], revivers: ReadonlyMap<EntityId, PlayerState>,
  reviveHealth: number): DownEvent[] {
  const events: DownEvent[] = [];
  for (const player of players) {
    const downed = player.downed;
    if (!player.alive || !downed) continue;
    const reviver = revivers.get(player.id);
    if (downed.selfRevive) {
      downed.reviveTicks += 1;
      if (downed.reviveTicks >= DOWN_RULES.selfReviveTicks) events.push(...revivePlayer(player, player.id, reviveHealth));
      continue;
    }
    if (reviver) {
      if (downed.reviverId !== reviver.id) { downed.reviverId = reviver.id; downed.reviveTicks = 0; }
      downed.reviveTicks += 1;
      const needed = hasPerk(reviver, 'quick-revive') ? DOWN_RULES.quickReviveTicks : DOWN_RULES.reviveTicks;
      if (downed.reviveTicks >= needed) events.push(...revivePlayer(player, reviver.id, reviveHealth));
      continue; // The bleed-out clock stops while someone is reviving.
    }
    downed.reviverId = null; downed.reviveTicks = 0;
    downed.bleedoutTicks -= 1;
    if (downed.bleedoutTicks <= 0) { bleedOut(player); events.push({ type: 'playerBledOut', playerId: player.id }); }
  }
  return events;
}

export function bleedOut(player: PlayerState): void {
  player.downed = null;
  player.alive = false;
  player.health = 0;
}

/** The revive under way on a player (or by them), from 0 to 1, for the HUD. */
export function reviveProgress(downed: DownedState, reviver?: PlayerState): number {
  const needed = downed.selfRevive ? DOWN_RULES.selfReviveTicks
    : reviver && hasPerk(reviver, 'quick-revive') ? DOWN_RULES.quickReviveTicks : DOWN_RULES.reviveTicks;
  return Math.min(1, downed.reviveTicks / needed);
}
