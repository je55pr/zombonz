import type { CollisionBox } from './collision.ts';
import { POWER_REQUIRED_PROMPT } from './perks.ts';
import { spendPoints, type EconomyEvent } from './economy.ts';
import { createInteractableState, type InteractionEvent } from './interaction.ts';
import type { EntityId, InteractableState, PlayerState, Vec3 } from './types.ts';

export interface DoorDefinition {
  id: string;
  position: Vec3;
  cost: number;
  blocker: CollisionBox;
  /** Purchase wording follows the obstacle rather than the room behind it. */
  kind?: 'door' | 'debris';
  prompt?: string;
  interactionRange?: number;
  minFacingDot?: number;
  /** An electric door: it cannot be bought, and opens by itself when the power comes on. */
  requiresPower?: boolean;
}

export function doorPrompt(definition: DoorDefinition): string {
  if (definition.requiresPower) return POWER_REQUIRED_PROMPT;
  return definition.prompt ?? `E  ${definition.kind === 'debris' ? 'Clear Debris' : 'Open Door'} [Cost: ${definition.cost}]`;
}

export interface DoorState {
  id: string;
  interactableId: EntityId;
  cost: number;
  open: boolean;
  requiresPower: boolean;
  blocker: CollisionBox;
}
export type DoorEvent = {
  type: 'doorOpened';
  doorId: string;
  playerId: EntityId;
};

export function createDoorInteractable(
  id: EntityId,
  definition: DoorDefinition,
): InteractableState {
  return createInteractableState(id, definition.position, {
    interactionType: 'door',
    actionId: `door:${definition.id}`,
    prompt: doorPrompt(definition),
    interactionRange: definition.interactionRange,
    minFacingDot: definition.minFacingDot,
  });
}

export function createDoorState(
  definition: DoorDefinition,
  interactableId: EntityId,
): DoorState {
  return {
    id: definition.id,
    interactableId,
    cost: definition.cost,
    open: false,
    requiresPower: definition.requiresPower ?? false,
    blocker: {
      min: { ...definition.blocker.min },
      max: { ...definition.blocker.max },
    },
  };
}
export function closedDoorBlockers(doors: readonly DoorState[]): CollisionBox[] {
  return doors.filter((door) => !door.open).map((door) => door.blocker);
}

export function handleDoorInteraction(
  player: PlayerState,
  interaction: InteractionEvent,
  doors: DoorState[],
  interactables: readonly InteractableState[],
): Array<EconomyEvent | DoorEvent> {
  if (interaction.interactionType !== 'door') return [];
  const door = doors.find((candidate) => candidate.interactableId === interaction.interactableId);
  if (!door || door.open || door.requiresPower) return [];

  const spend = spendPoints(player, door.cost, `door:${door.id}`);
  if (spend.type === 'pointsSpendRejected') return [spend];

  door.open = true;
  const interactable = interactables.find((entry) => entry.id === door.interactableId);
  if (interactable) interactable.enabled = false;
  return [spend, { type: 'doorOpened', doorId: door.id, playerId: player.id }];
}

/** The power switch: electric doors open, and machines and traps come alive. */
export interface PowerSwitchDefinition { position: Vec3 }
export type PowerEvent = { type: 'powerActivated'; playerId: EntityId };

export function createPowerSwitchInteractable(id: EntityId, definition: PowerSwitchDefinition): InteractableState {
  return createInteractableState(id, definition.position, {
    interactionType: 'powerSwitch', actionId: 'power', prompt: 'E  Turn on the power', interactionRange: 2, minFacingDot: 0.25,
  });
}

/** Throws the switch (once); every electric door opens, credited to whoever threw it. */
export function activatePower(player: PlayerState, interaction: InteractionEvent, powered: { on: boolean },
  doors: DoorState[], interactables: readonly InteractableState[]): Array<PowerEvent | DoorEvent> {
  if (interaction.interactionType !== 'powerSwitch' || powered.on) return [];
  powered.on = true;
  const item = interactables.find(entry => entry.id === interaction.interactableId);
  if (item) item.enabled = false;
  const events: Array<PowerEvent | DoorEvent> = [{ type: 'powerActivated', playerId: player.id }];
  for (const door of doors) if (door.requiresPower && !door.open) {
    door.open = true;
    const doorItem = interactables.find(entry => entry.id === door.interactableId);
    if (doorItem) doorItem.enabled = false;
    events.push({ type: 'doorOpened', doorId: door.id, playerId: player.id });
  }
  return events;
}
