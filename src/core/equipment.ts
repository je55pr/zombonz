import { spendPoints, type EconomyEvent } from './economy.ts';
import { MINE_RULES } from './grenade.ts';
import { createInteractableState, type InteractionEvent } from './interaction.ts';
import type { EntityId, InteractableState, PlayerState, Vec3 } from './types.ts';

/** Equipment bought from a wall (as opposed to a gun): what it is called and how many come with a purchase. */
export const EQUIPMENT_ITEMS = {
  'bouncing-betty': {
    name: 'Bouncing Betty', perPurchase: MINE_RULES.perPurchase, maximum: MINE_RULES.maximum, chargeField: 'mineCharges',
  },
} as const;
export type EquipmentItem = keyof typeof EQUIPMENT_ITEMS;

export interface EquipmentBuyDefinition {
  id: string;
  item: EquipmentItem;
  position: Vec3;
  /** Price with none left, and price of topping up a pack that is only part used. */
  cost: number;
  refillCost: number;
  interactionRange?: number;
  minFacingDot?: number;
}

export interface EquipmentBuyState {
  id: string;
  interactableId: EntityId;
  item: EquipmentItem;
  cost: number;
  refillCost: number;
}

export type EquipmentEvent =
  | { type: 'equipmentPurchased'; playerId: EntityId; buyId: string; item: EquipmentItem; charges: number }
  | { type: 'equipmentFull'; playerId: EntityId; buyId: string; item: EquipmentItem };

export function equipmentName(item: EquipmentItem): string { return EQUIPMENT_ITEMS[item].name; }

/** How many of an item the player carries. */
export function equipmentCharges(player: PlayerState, item: EquipmentItem): number {
  return player[EQUIPMENT_ITEMS[item].chargeField];
}

/** Set carried equipment without ever exceeding that item's configured capacity. */
export function setEquipmentCharges(player: PlayerState, item: EquipmentItem, charges: number): void {
  const definition = EQUIPMENT_ITEMS[item];
  player[definition.chargeField] = Math.max(0, Math.min(definition.maximum, charges));
}

/** Max Ammo and similar full refills use the equipment catalogue rather than naming individual items. */
export function refillEquipment(player: PlayerState): void {
  for (const item of Object.keys(EQUIPMENT_ITEMS) as EquipmentItem[]) {
    setEquipmentCharges(player, item, EQUIPMENT_ITEMS[item].maximum);
  }
}

export function createEquipmentInteractable(id: EntityId, definition: EquipmentBuyDefinition): InteractableState {
  if (!EQUIPMENT_ITEMS[definition.item]) throw new Error(`Unknown equipment: ${definition.item}`);
  return createInteractableState(id, definition.position, {
    interactionType: 'equipment',
    actionId: `equipment:${definition.id}`,
    prompt: `E  ${equipmentName(definition.item)} [${definition.cost}] / Refill [${definition.refillCost}]`,
    interactionRange: definition.interactionRange ?? 2.5,
    minFacingDot: definition.minFacingDot ?? 0.25,
  });
}

export function createEquipmentState(definition: EquipmentBuyDefinition, interactableId: EntityId): EquipmentBuyState {
  return { id: definition.id, interactableId, item: definition.item, cost: definition.cost, refillCost: definition.refillCost };
}

/** Buying tops the player up to the most they can carry; a full pack is not sold to. */
export function handleEquipmentInteraction(player: PlayerState, interaction: InteractionEvent,
  buys: readonly EquipmentBuyState[]): Array<EconomyEvent | EquipmentEvent> {
  if (interaction.interactionType !== 'equipment') return [];
  const buy = buys.find(candidate => candidate.interactableId === interaction.interactableId);
  if (!buy || !player.alive || player.downed) return [];
  const held = equipmentCharges(player, buy.item), { maximum } = EQUIPMENT_ITEMS[buy.item];
  if (held >= maximum) return [{ type: 'equipmentFull', playerId: player.id, buyId: buy.id, item: buy.item }];
  const spend = spendPoints(player, held > 0 ? buy.refillCost : buy.cost, `equipment:${buy.id}`);
  if (spend.type === 'pointsSpendRejected') return [spend];
  setEquipmentCharges(player, buy.item, held + EQUIPMENT_ITEMS[buy.item].perPurchase);
  return [spend, { type: 'equipmentPurchased', playerId: player.id, buyId: buy.id, item: buy.item,
    charges: equipmentCharges(player, buy.item) }];
}
