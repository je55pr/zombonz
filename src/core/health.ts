import { hasPerk, playerMaxHealth } from './perks.ts';
import type { EntityState, PlayerState, WorldState } from './types.ts';

export interface DamageEvent {
  /** `playerRevived`: Quick Revive spent itself, and every perk, to cancel a killing blow. */
  type: 'playerDamaged' | 'playerDied' | 'playerHealed' | 'playerRevived';
  playerId: PlayerState['id'];
  amount: number;
  health: number;
}

export const PLAYER_HEALTH = { maximum: 100, recoveryDelayTicks: 300, recoveryPerTick: 2 } as const;

export function maxPlayerHealth(player: PlayerState): number {
  return playerMaxHealth(player, PLAYER_HEALTH.maximum);
}

export function tickPlayerRecovery(player: PlayerState): DamageEvent[] {
  if (!player.alive) return [];
  if (player.recoveryDelayTicks > 0) { player.recoveryDelayTicks -= 1; return []; }
  const maximum = maxPlayerHealth(player);
  if (player.health >= maximum) return [];
  const amount = Math.min(PLAYER_HEALTH.recoveryPerTick, maximum - player.health);
  player.health += amount;
  return [{ type: 'playerHealed', playerId: player.id, amount, health: player.health }];
}

export function damagePlayer(player: PlayerState, amount: number): DamageEvent[] {
  if (!player.alive || player.godMode || amount <= 0) return [];
  const nextHealth = Math.max(0, player.health - amount);
  const applied = player.health - nextHealth;
  player.health = nextHealth;
  player.recoveryDelayTicks = PLAYER_HEALTH.recoveryDelayTicks;
  const events: DamageEvent[] = [{
    type: 'playerDamaged', playerId: player.id, amount: applied, health: player.health,
  }];
  if (player.health === 0 && hasPerk(player, 'quick-revive')) {
    // There is no downed state, so this is Black Ops' solo Quick Revive: straight back up, perks gone.
    player.perks = [];
    player.health = PLAYER_HEALTH.maximum;
    events.push({ type: 'playerRevived', playerId: player.id, amount: 0, health: player.health });
  } else if (player.health === 0) {
    player.alive = false;
    player.velocity = { x: 0, y: 0, z: 0 };
    events.push({ type: 'playerDied', playerId: player.id, amount: 0, health: 0 });
  }
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
