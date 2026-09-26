import type { PlayerState } from './types.ts';
import type { WeaponEvent } from './weapon.ts';

export interface EconomyConfig {
  startingPoints: number;
  hitReward: number;
  killBonus: number;
  headshotBonus?: number;
  meleeKillReward?: number;
}

export const DEFAULT_ECONOMY_CONFIG: Readonly<EconomyConfig> = {
  startingPoints: 500,
  hitReward: 10,
  killBonus: 50,
  headshotBonus: 90,
  meleeKillReward: 130,
};

export type EconomyEvent =
  | { type: 'pointsAwarded'; playerId: PlayerState['id']; amount: number; reason: 'hit' | 'kill' | 'headshot' | 'melee' | 'repair' | 'nuke'; balance: number }
  | { type: 'pointsSpent'; playerId: PlayerState['id']; amount: number; reason: string; balance: number }
  | { type: 'pointsSpendRejected'; playerId: PlayerState['id']; amount: number; reason: string; balance: number };
function award(
  player: PlayerState,
  amount: number,
  reason: 'hit' | 'kill' | 'headshot' | 'melee' | 'repair' | 'nuke',
): EconomyEvent {
  player.points += amount;
  return { type: 'pointsAwarded', playerId: player.id, amount, reason, balance: player.points };
}

export function awardCombatPoints(
  player: PlayerState,
  weaponEvents: readonly WeaponEvent[],
  config: EconomyConfig = DEFAULT_ECONOMY_CONFIG,
  multiplier = 1,
): EconomyEvent[] {
  const events: EconomyEvent[] = [];
  for (const event of weaponEvents) {
    if ('playerId' in event && event.playerId !== player.id) continue;
    if (event.type === 'weaponHit' && config.hitReward > 0) {
      events.push(award(player, config.hitReward * multiplier, 'hit'));
    } else if ((event.type === 'meleeHit' || event.type === 'grenadeHit')
      && !weaponEvents.some(other => other.type === 'zombieDied' && other.zombieId === event.zombieId)) {
      events.push(award(player, config.hitReward * multiplier, 'hit'));
    } else if (event.type === 'zombieDied') {
      const reason = event.method === 'melee' ? 'melee' : event.method === 'head' ? 'headshot' : 'kill';
      const amount = reason === 'melee' ? (config.meleeKillReward ?? 130)
        : reason === 'headshot' ? (config.headshotBonus ?? 90) : config.killBonus;
      if (amount > 0) events.push(award(player, amount * multiplier, reason));
    }
  }
  return events;
}

export function awardRepairPoints(player: PlayerState, round: number, multiplier = 1): EconomyEvent[] {
  const currentRound = Math.max(1, round);
  if (player.repairRewardRound !== currentRound) {
    player.repairRewardRound = currentRound; player.repairPointsEarned = 0;
  }
  const cap = Math.min(500, currentRound * 40);
  const amount = Math.min(10, cap - player.repairPointsEarned);
  if (!player.alive || amount <= 0) return [];
  player.repairPointsEarned += amount;
  return [award(player, amount * multiplier, 'repair')];
}

export function awardNukePoints(player: PlayerState): EconomyEvent[] {
  return player.alive ? [award(player, 400, 'nuke')] : [];
}
export function spendPoints(
  player: PlayerState,
  amount: number,
  reason: string,
): EconomyEvent {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new RangeError('Point spend amount must be positive.');
  }
  if (player.points < amount) {
    return {
      type: 'pointsSpendRejected', playerId: player.id,
      amount, reason, balance: player.points,
    };
  }
  player.points -= amount;
  return {
    type: 'pointsSpent', playerId: player.id,
    amount, reason, balance: player.points,
  };
}
