import { spendPoints, type EconomyEvent } from './economy.ts';
import { createInteractableState, type InteractionEvent } from './interaction.ts';
import { SeededRng } from './rng.ts';
import { equipWeapon, ownedWeapon, weaponName, WEAPON_DEFINITIONS } from './weapon.ts';
import type { EntityId, InteractableState, PlayerState, Vec3 } from './types.ts';

export const BOX_RULES = { rollTicks: 180, claimTicks: 600, closingTicks: 120 } as const;
export interface MysteryBoxDefinition {
  id: string; position: Vec3; cost: number; weapons: readonly string[];
  /** Relative odds per weapon; unlisted weapons weigh 1. Rare wonder weapons get less. */
  weights?: Readonly<Record<string, number>>;
}
export interface MysteryBoxState {
  id: string; interactableId: EntityId; cost: number; weapons: string[]; weights: Record<string, number>;
  rolls: number; cooldownTicks: number; lastWeapon: string | null;
  phase: 'idle' | 'rolling' | 'offering' | 'closing';
  ownerId: EntityId | null;
}
export type MysteryBoxEvent =
  | { type: 'mysteryBoxUsed' | 'mysteryBoxClaimed'; playerId: EntityId; boxId: string; weaponId: string }
  | { type: 'mysteryBoxUnavailable'; playerId: EntityId; boxId: string };


export function mysteryBoxPrompt(box: MysteryBoxState, playerId?: EntityId): string {
  if (box.phase === 'rolling') return 'Mystery Box — rolling…';
  if (box.phase === 'closing') return 'Mystery Box — closing…';
  if (box.phase === 'offering') return box.ownerId === playerId
    ? `E  Take ${weaponName(box.lastWeapon!)} [${Math.ceil(box.cooldownTicks / 60)}s]`
    : 'Mystery Box — reserved for its buyer';
  return `E  Mystery Box [${box.cost}]`;
}
export function createMysteryBox(definition: MysteryBoxDefinition, id: EntityId): {
  state: MysteryBoxState; interactable: InteractableState;
} {
  if (!definition.weapons.length || definition.weapons.some(id => !WEAPON_DEFINITIONS[id])) {
    throw new Error('Mystery box requires a nonempty pool of known weapons.');
  }
  const weights = Object.fromEntries(definition.weapons.map(id => [id, definition.weights?.[id] ?? 1]));
  if (Object.values(weights).some(weight => !Number.isFinite(weight) || weight <= 0)) {
    throw new Error('Mystery box weights must be positive.');
  }
  return {
    state: { id: definition.id, interactableId: id, cost: definition.cost, weapons: [...definition.weapons], weights,
      rolls: 0, cooldownTicks: 0, lastWeapon: null, phase: 'idle', ownerId: null },
    interactable: createInteractableState(id, definition.position, {
      interactionType: 'mysteryBox', actionId: `box:${definition.id}`,
      prompt: `E  Mystery Box [${definition.cost}]`, interactionRange: 2.4, minFacingDot: 0.3,
    }),
  };
}
export function tickMysteryBoxes(boxes: MysteryBoxState[], interactables: readonly InteractableState[],
  players?: readonly PlayerState[]): void {
  for (const box of boxes) {
    if (box.ownerId && players && !players.some(player => player.id === box.ownerId && player.alive)) {
      box.ownerId = null; box.phase = 'closing'; box.cooldownTicks = BOX_RULES.closingTicks;
    }
    if (box.cooldownTicks > 0) box.cooldownTicks -= 1;
    if (box.cooldownTicks === 0) {
      if (box.phase === 'rolling') { box.phase = 'offering'; box.cooldownTicks = BOX_RULES.claimTicks; }
      else if (box.phase === 'offering') { box.phase = 'closing'; box.ownerId = null; box.cooldownTicks = BOX_RULES.closingTicks; }
      else if (box.phase === 'closing') { box.phase = 'idle'; box.lastWeapon = null; }
    }
    const item = interactables.find(item => item.id === box.interactableId);
    if (item) { item.enabled = true; item.prompt = mysteryBoxPrompt(box); }
  }
}
function pickWeighted(pool: readonly string[], weights: Readonly<Record<string, number>>, rng: SeededRng): string {
  const total = pool.reduce((sum, id) => sum + weights[id], 0);
  let roll = rng.next() * total;
  for (const id of pool) {
    roll -= weights[id];
    if (roll < 0) return id;
  }
  return pool[pool.length - 1];
}

export function useMysteryBox(player: PlayerState, interaction: InteractionEvent,
  boxes: MysteryBoxState[], seed: number): Array<EconomyEvent | MysteryBoxEvent> {
  if (interaction.interactionType !== 'mysteryBox') return [];
  const box = boxes.find(box => box.interactableId === interaction.interactableId);
  if (!box || !player.alive) return [];
  if (box.phase === 'offering' && box.ownerId === player.id && box.lastWeapon) {
    equipWeapon(player, box.lastWeapon);
    box.phase = 'closing'; box.ownerId = null; box.cooldownTicks = BOX_RULES.closingTicks;
    return [{ type: 'mysteryBoxClaimed', playerId: player.id, boxId: box.id, weaponId: box.lastWeapon }];
  }
  if (box.phase !== 'idle') return [];
  const pool = box.weapons.filter(id => !ownedWeapon(player, id));
  if (!pool.length) return [{ type: 'mysteryBoxUnavailable', playerId: player.id, boxId: box.id }];
  const spend = spendPoints(player, box.cost, `box:${box.id}`);
  if (spend.type === 'pointsSpendRejected') return [spend];
  const rng = new SeededRng(seed ^ Math.imul(box.rolls + 1, 0x9e3779b9));
  const weaponId = pickWeighted(pool, box.weights, rng);
  box.rolls += 1;
  box.phase = 'rolling'; box.ownerId = player.id;
  box.cooldownTicks = BOX_RULES.rollTicks;
  box.lastWeapon = weaponId;
  return [spend, { type: 'mysteryBoxUsed', playerId: player.id, boxId: box.id, weaponId }];
}
