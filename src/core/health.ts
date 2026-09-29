import { goDown } from './downs.ts';
import { playerMaxHealth } from './perks.ts';
import type { EntityState, PlayerState, WorldState } from './types.ts';

export interface DamageEvent {
  /** `playerDowned`: a killing blow put the player into last stand (see downs.ts). */
  type: 'playerDamaged' | 'playerDied' | 'playerHealed' | 'playerDowned';
  playerId: PlayerState['id'];
  amount: number;
  health: number;
}

export const PLAYER_HEALTH = { maximum: 100, recoveryDelayTicks: 300, recoveryPerTick: 2 } as const;

export function maxPlayerHealth(player: PlayerState): number {
  return playerMaxHealth(player, PLAYER_HEALTH.maximum);
}

export function tickPlayerRecovery(player: PlayerState): DamageEvent[] {
  if (player.hurtGraceTicks > 0) player.hurtGraceTicks -= 1;
  if (!player.alive || player.downed) return [];
  if (player.recoveryDelayTicks > 0) { player.recoveryDelayTicks -= 1; return []; }
  const maximum = maxPlayerHealth(player);
  if (player.health >= maximum) return [];
  const amount = Math.min(PLAYER_HEALTH.recoveryPerTick, maximum - player.health);
  player.health += amount;
  return [{ type: 'playerHealed', playerId: player.id, amount, health: player.health }];
}

export function damagePlayer(player: PlayerState, amount: number): DamageEvent[] {
  if (!player.alive || player.downed || player.godMode || amount <= 0) return [];
  const nextHealth = Math.max(0, player.health - amount);
  const applied = player.health - nextHealth;
  player.health = nextHealth;
  player.recoveryDelayTicks = PLAYER_HEALTH.recoveryDelayTicks;
  const events: DamageEvent[] = [{
    type: 'playerDamaged', playerId: player.id, amount: applied, health: player.health,
  }];
  if (player.health === 0) events.push(...goDown(player));
  return events;
}

export function livingPlayers(world: WorldState): PlayerState[] {
  return Object.values(world.entities).filter(
    (entity): entity is PlayerState => entity.kind === 'player' && entity.alive,
  );
}

export function livingEntityCount(world: WorldState, kind: EntityState['kind']): number {
  return Object.values(world.entities).filter((entity) => entity.kind === kind && entity.alive).length;
}
