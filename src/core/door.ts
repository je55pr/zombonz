import type { CollisionBox } from './collision.ts';
import { spendPoints, type EconomyEvent } from './economy.ts';
import { createInteractableState, type InteractionEvent } from './interaction.ts';
import type { EntityId, InteractableState, PlayerState, Vec3 } from './types.ts';

export interface DoorDefinition {
  id: string;
  position: Vec3;
  cost: number;
  blocker: CollisionBox;
  prompt?: string;
  interactionRange?: number;
  minFacingDot?: number;
}

export interface DoorState {
  id: string;
  interactableId: EntityId;
  cost: number;
  open: boolean;
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
    prompt: definition.prompt ?? `Press E to open [${definition.cost}]`,
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
  if (!door || door.open) return [];

  const spend = spendPoints(player, door.cost, `door:${door.id}`);
  if (spend.type === 'pointsSpendRejected') return [spend];

  door.open = true;
  const interactable = interactables.find((entry) => entry.id === door.interactableId);
  if (interactable) interactable.enabled = false;
  return [spend, { type: 'doorOpened', doorId: door.id, playerId: player.id }];
}
