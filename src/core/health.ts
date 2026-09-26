import type { EntityState, PlayerState, WorldState } from './types.ts';

export interface DamageEvent {
  type: 'playerDamaged' | 'playerDied';
  playerId: PlayerState['id'];
  amount: number;
  health: number;
}

export function damagePlayer(player: PlayerState, amount: number): DamageEvent[] {
  if (!player.alive || player.godMode || amount <= 0) return [];
  const nextHealth = Math.max(0, player.health - amount);
  const applied = player.health - nextHealth;
  player.health = nextHealth;
  const events: DamageEvent[] = [{
    type: 'playerDamaged', playerId: player.id, amount: applied, health: player.health,
  }];
  if (player.health === 0) {
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
