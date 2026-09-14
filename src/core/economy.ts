import type { PlayerState } from './types.ts';
import type { WeaponEvent } from './weapon.ts';

export interface EconomyConfig {
  startingPoints: number;
  hitReward: number;
  killBonus: number;
}

export const DEFAULT_ECONOMY_CONFIG: Readonly<EconomyConfig> = {
  startingPoints: 500,
  hitReward: 10,
  killBonus: 50,
};

export type EconomyEvent =
  | { type: 'pointsAwarded'; playerId: PlayerState['id']; amount: number; reason: 'hit' | 'kill'; balance: number }
  | { type: 'pointsSpent'; playerId: PlayerState['id']; amount: number; reason: string; balance: number }
  | { type: 'pointsSpendRejected'; playerId: PlayerState['id']; amount: number; reason: string; balance: number };
function award(
  player: PlayerState,
  amount: number,
  reason: 'hit' | 'kill',
): EconomyEvent {
  player.points += amount;
  return { type: 'pointsAwarded', playerId: player.id, amount, reason, balance: player.points };
}

export function awardCombatPoints(
  player: PlayerState,
  weaponEvents: readonly WeaponEvent[],
  config: EconomyConfig = DEFAULT_ECONOMY_CONFIG,
): EconomyEvent[] {
  const events: EconomyEvent[] = [];
  for (const event of weaponEvents) {
    if (event.type === 'weaponHit' && config.hitReward > 0) {
      events.push(award(player, config.hitReward, 'hit'));
    } else if (event.type === 'zombieDied' && config.killBonus > 0) {
      events.push(award(player, config.killBonus, 'kill'));
    }
  }
  return events;
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
