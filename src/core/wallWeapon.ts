import { spendPoints, type EconomyEvent } from './economy.ts';
import { createInteractableState, type InteractionEvent } from './interaction.ts';
import type { EntityId, InteractableState, PlayerState, Vec3 } from './types.ts';
import { equipWeapon, ownedWeaponOrUpgrade, weaponDefinition, WEAPON_DEFINITIONS } from './weapon.ts';

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
  purchased: boolean;
}
export type WallWeaponEvent =
  | { type: 'wallWeaponPurchased'; playerId: EntityId; wallWeaponId: string; weaponId: string }
  | { type: 'wallWeaponAmmoFull'; playerId: EntityId; wallWeaponId: string; weaponId: string }
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
    purchased: false,
  };
}

export function handleWallWeaponInteraction(
  player: PlayerState,
  interaction: InteractionEvent,
  wallWeapons: readonly WallWeaponState[],
): Array<EconomyEvent | WallWeaponEvent> {
  if (interaction.interactionType !== 'wallWeapon') return [];
  const wall = wallWeapons.find((candidate) => candidate.interactableId === interaction.interactableId);
  if (!wall || !player.alive) return [];
  // A player holding the gun's Pack-a-Punched version is sold its ammo, and not the gun again.
  const owned = ownedWeaponOrUpgrade(player, wall.weaponId);
  const ownsWeapon = !!owned;
  const definition = weaponDefinition(owned?.weaponId ?? wall.weaponId)!;
  if (owned && owned.reserveAmmo >= definition.startingReserveAmmo) {
    return [{ type: 'wallWeaponAmmoFull', playerId: player.id, wallWeaponId: wall.id, weaponId: wall.weaponId }];
  }
  const cost = ownsWeapon ? wall.ammoCost : wall.weaponCost;
  const reason = ownsWeapon ? `wallAmmo:${wall.id}` : `wallWeapon:${wall.id}`;
  const spend = spendPoints(player, cost, reason);
  if (spend.type === 'pointsSpendRejected') return [spend];

  // Reserve refill preserves the magazine, reload progress and fire cadence.
  if (owned) owned.reserveAmmo = definition.startingReserveAmmo;
  else { equipWeapon(player, wall.weaponId); wall.purchased = true; }
  const event: WallWeaponEvent = ownsWeapon
    ? { type: 'wallWeaponAmmoPurchased', playerId: player.id, wallWeaponId: wall.id, weaponId: wall.weaponId }
    : { type: 'wallWeaponPurchased', playerId: player.id, wallWeaponId: wall.id, weaponId: wall.weaponId };
  return [spend, event];
}
