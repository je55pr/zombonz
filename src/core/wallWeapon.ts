import { spendPoints, type EconomyEvent } from './economy.ts';
import { createInteractableState, type InteractionEvent } from './interaction.ts';
import type { EntityId, InteractableState, PlayerState, Vec3 } from './types.ts';
import { createWeaponState, WEAPON_DEFINITIONS } from './weapon.ts';

export interface WallWeaponDefinition {
  id: string;
  position: Vec3;
  weaponId: string;
  weaponCost: number;
  ammoCost: number;
  prompt?: string;
  interactionRange?: number;
  minFacingDot?: number;
}

export interface WallWeaponState {
  id: string;
  interactableId: EntityId;
  weaponId: string;
  weaponCost: number;
  ammoCost: number;
}
export type WallWeaponEvent =
  | { type: 'wallWeaponPurchased'; playerId: EntityId; wallWeaponId: string; weaponId: string }
  | { type: 'wallWeaponAmmoPurchased'; playerId: EntityId; wallWeaponId: string; weaponId: string };

export function createWallWeaponInteractable(
  id: EntityId,
  definition: WallWeaponDefinition,
): InteractableState {
  if (!WEAPON_DEFINITIONS[definition.weaponId]) {
    throw new Error(`Unknown wall weapon: ${definition.weaponId}`);
  }
  return createInteractableState(id, definition.position, {
    interactionType: 'wallWeapon',
    actionId: `wallWeapon:${definition.id}`,
    prompt: definition.prompt
      ?? `Press E: ${definition.weaponId} [${definition.weaponCost}] / Ammo [${definition.ammoCost}]`,
    interactionRange: definition.interactionRange,
    minFacingDot: definition.minFacingDot,
  });
}
export function createWallWeaponState(
  definition: WallWeaponDefinition,
  interactableId: EntityId,
): WallWeaponState {
  return {
    id: definition.id,
    interactableId,
    weaponId: definition.weaponId,
    weaponCost: definition.weaponCost,
    ammoCost: definition.ammoCost,
  };
}

function refillWeapon(player: PlayerState, weaponId: string): void {
  player.weapon = createWeaponState(weaponId);
}

export function handleWallWeaponInteraction(
  player: PlayerState,
  interaction: InteractionEvent,
  wallWeapons: readonly WallWeaponState[],
): Array<EconomyEvent | WallWeaponEvent> {
  if (interaction.interactionType !== 'wallWeapon') return [];
  const wall = wallWeapons.find((candidate) => candidate.interactableId === interaction.interactableId);
  if (!wall) return [];
  const ownsWeapon = player.weapon.weaponId === wall.weaponId;
  const cost = ownsWeapon ? wall.ammoCost : wall.weaponCost;
  const reason = ownsWeapon ? `wallAmmo:${wall.id}` : `wallWeapon:${wall.id}`;
  const spend = spendPoints(player, cost, reason);
  if (spend.type === 'pointsSpendRejected') return [spend];

  refillWeapon(player, wall.weaponId);
  const event: WallWeaponEvent = ownsWeapon
    ? { type: 'wallWeaponAmmoPurchased', playerId: player.id, wallWeaponId: wall.id, weaponId: wall.weaponId }
    : { type: 'wallWeaponPurchased', playerId: player.id, wallWeaponId: wall.id, weaponId: wall.weaponId };
  return [spend, event];
}
