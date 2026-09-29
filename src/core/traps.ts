import type { CollisionBox } from './collision.ts';
import { spendPoints, type EconomyEvent } from './economy.ts';
import { damagePlayer, type DamageEvent } from './health.ts';
import { createInteractableState, type InteractionEvent } from './interaction.ts';
import { POWER_REQUIRED_PROMPT } from './perks.ts';
import type { EntityId, InteractableState, PlayerState, Vec3, ZombieState } from './types.ts';

/** Verrückt's balcony electric traps: a paid switch that electrifies a stretch of floor for a while. */
export const TRAP_RULES = {
  activeTicks: 25 * 60, cooldownTicks: 25 * 60,
  /** Players caught in the current take this much every half second. */
  playerDamage: 25, playerDamageIntervalTicks: 30,
} as const;

export interface TrapDefinition {
  id: string; name: string; cost: number;
  /** Where players pull the handle. */
  switchPosition: Vec3;
  /** The electrified space. */
  zone: CollisionBox;
}
export interface TrapState {
  id: string; name: string; cost: number; zone: CollisionBox; interactableId: EntityId;
  activeTicks: number; cooldownTicks: number; ownerId: EntityId | null;
}
export type TrapEvent =
  | { type: 'trapActivated'; trapId: string; playerId: EntityId }
  | { type: 'trapReady'; trapId: string }
  | { type: 'zombieDied'; zombieId: EntityId; playerId: EntityId; method: 'trap' };

export function trapPrompt(trap: TrapState, powerOn: boolean): string {
  if (!powerOn) return POWER_REQUIRED_PROMPT;
  if (trap.activeTicks > 0) return `${trap.name} — active`;
  if (trap.cooldownTicks > 0) return `${trap.name} — recharging`;
  return `E  Activate ${trap.name} [${trap.cost}]`;
}
export function createTrap(definition: TrapDefinition, id: EntityId): { state: TrapState; interactable: InteractableState } {
  const state: TrapState = { id: definition.id, name: definition.name, cost: definition.cost,
    zone: { min: { ...definition.zone.min }, max: { ...definition.zone.max } }, interactableId: id,
    activeTicks: 0, cooldownTicks: 0, ownerId: null };
  return { state, interactable: createInteractableState(id, definition.switchPosition, {
    interactionType: 'trap', actionId: `trap:${definition.id}`, prompt: trapPrompt(state, false),
    interactionRange: 2, minFacingDot: 0.25,
  }) };
}

export function activateTrap(player: PlayerState, interaction: InteractionEvent, traps: TrapState[],
  powerOn: boolean): Array<EconomyEvent | TrapEvent> {
  if (interaction.interactionType !== 'trap') return [];
  const trap = traps.find(candidate => candidate.interactableId === interaction.interactableId);
  if (!trap || !powerOn || trap.activeTicks > 0 || trap.cooldownTicks > 0) return [];
  const spend = spendPoints(player, trap.cost, `trap:${trap.id}`);
  if (spend.type === 'pointsSpendRejected') return [spend];
  trap.activeTicks = TRAP_RULES.activeTicks;
  trap.ownerId = player.id;
  return [spend, { type: 'trapActivated', trapId: trap.id, playerId: player.id }];
}

const inside = (zone: CollisionBox, p: Vec3) => p.x >= zone.min.x && p.x <= zone.max.x
  && p.y >= zone.min.y && p.y <= zone.max.y && p.z >= zone.min.z && p.z <= zone.max.z;

/**
 * Runs each trap's timers. A live trap kills every zombie that walks into it (for no points, as in
 * World at War) and hurts players who stand in it.
 */
export function tickTraps(traps: TrapState[], zombies: readonly ZombieState[], players: readonly PlayerState[],
  tick: number): Array<TrapEvent | DamageEvent> {
  const events: Array<TrapEvent | DamageEvent> = [];
  for (const trap of traps) {
    if (trap.activeTicks > 0) {
      for (const zombie of zombies) if (zombie.alive && !zombie.entry && inside(trap.zone, zombie.position)) {
        zombie.health = 0; zombie.alive = false; zombie.velocity = { x: 0, y: 0, z: 0 };
        events.push({ type: 'zombieDied', zombieId: zombie.id, playerId: trap.ownerId!, method: 'trap' });
      }
      if (tick % TRAP_RULES.playerDamageIntervalTicks === 0) for (const player of players) {
        if (player.alive && inside(trap.zone, player.position)) events.push(...damagePlayer(player, TRAP_RULES.playerDamage));
      }
      trap.activeTicks -= 1;
      if (trap.activeTicks === 0) trap.cooldownTicks = TRAP_RULES.cooldownTicks;
    } else if (trap.cooldownTicks > 0) {
      trap.cooldownTicks -= 1;
      if (trap.cooldownTicks === 0) { trap.ownerId = null; events.push({ type: 'trapReady', trapId: trap.id }); }
    }
  }
  return events;
}

export function syncTrapInteractables(traps: readonly TrapState[], interactables: readonly InteractableState[],
  powerOn: boolean): void {
  for (const trap of traps) {
    const item = interactables.find(candidate => candidate.id === trap.interactableId);
    if (item) item.prompt = trapPrompt(trap, powerOn);
  }
}
