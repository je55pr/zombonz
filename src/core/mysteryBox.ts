import { spendPoints, type EconomyEvent } from './economy.ts';
import { createInteractableState, type InteractionEvent } from './interaction.ts';
import { SeededRng } from './rng.ts';
import { createWeaponState, WEAPON_DEFINITIONS } from './weapon.ts';
import type { EntityId, InteractableState, PlayerState, Vec3 } from './types.ts';

export interface MysteryBoxDefinition { id: string; position: Vec3; cost: number; weapons: readonly string[] }
export interface MysteryBoxState {
  id: string; interactableId: EntityId; cost: number; weapons: string[];
  rolls: number; cooldownTicks: number; lastWeapon: string | null;
}
export interface MysteryBoxEvent { type: 'mysteryBoxUsed'; playerId: EntityId; boxId: string; weaponId: string }
export function createMysteryBox(definition: MysteryBoxDefinition, id: EntityId): {
  state: MysteryBoxState; interactable: InteractableState;
} {
  if (!definition.weapons.length || definition.weapons.some(id => !WEAPON_DEFINITIONS[id])) {
    throw new Error('Mystery box requires a nonempty pool of known weapons.');
  }
  return {
    state: { id: definition.id, interactableId: id, cost: definition.cost, weapons: [...definition.weapons],
      rolls: 0, cooldownTicks: 0, lastWeapon: null },
    interactable: createInteractableState(id, definition.position, {
      interactionType: 'mysteryBox', actionId: `box:${definition.id}`,
      prompt: `E  Mystery Box [${definition.cost}] — replaces weapon`, interactionRange: 2.4, minFacingDot: 0.3,
    }),
  };
}
export function tickMysteryBoxes(boxes: MysteryBoxState[], interactables: readonly InteractableState[]): void {
  for (const box of boxes) {
    if (box.cooldownTicks > 0) box.cooldownTicks -= 1;
    const item = interactables.find(item => item.id === box.interactableId);
    if (item) item.enabled = box.cooldownTicks === 0;
  }
}
export function useMysteryBox(player: PlayerState, interaction: InteractionEvent,
  boxes: MysteryBoxState[], seed: number): Array<EconomyEvent | MysteryBoxEvent> {
  if (interaction.interactionType !== 'mysteryBox') return [];
  const box = boxes.find(box => box.interactableId === interaction.interactableId);
  if (!box || box.cooldownTicks > 0 || !player.alive) return [];
  const spend = spendPoints(player, box.cost, `box:${box.id}`);
  if (spend.type === 'pointsSpendRejected') return [spend];
  const rng = new SeededRng(seed ^ Math.imul(box.rolls + 1, 0x9e3779b9));
  const weaponId = box.weapons[rng.int(0, box.weapons.length)];
  player.weapon = createWeaponState(weaponId);
  box.rolls += 1;
  box.cooldownTicks = 180;
  box.lastWeapon = weaponId;
  return [spend, { type: 'mysteryBoxUsed', playerId: player.id, boxId: box.id, weaponId }];
}
