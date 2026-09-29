import { spendPoints, type EconomyEvent } from './economy.ts';
import { createInteractableState, type InteractionEvent } from './interaction.ts';
import type { EntityId, InteractableState, PlayerState, Vec3 } from './types.ts';

/** World at War's four perk-a-colas, as Verrückt sells them. */
export type PerkId = 'juggernog' | 'double-tap' | 'speed-cola' | 'quick-revive';
export const PERKS: Readonly<Record<PerkId, { name: string; cost: number }>> = {
  juggernog: { name: 'Jugger-Nog', cost: 2500 },
  'double-tap': { name: 'Double Tap Root Beer', cost: 2000 },
  'speed-cola': { name: 'Speed Cola', cost: 3000 },
  'quick-revive': { name: 'Quick Revive', cost: 1500 },
};
export const PERK_RULES = {
  /** Jugger-Nog: zombies need five hits instead of two. */
  juggernogHealth: 250,
  /** Double Tap: a third faster rate of fire. */
  doubleTapInterval: 0.75,
  /** Speed Cola: reloads take half as long. */
  speedColaReload: 0.5,
} as const;

export interface PerkMachineDefinition { id: string; perk: PerkId; position: Vec3 }
export interface PerkMachineState { id: string; perk: PerkId; interactableId: EntityId }
export interface PerkEvent { type: 'perkBought'; playerId: EntityId; perk: PerkId }

export const POWER_REQUIRED_PROMPT = 'The power must be on';
export const SOLO_QUICK_REVIVE_COST = 500;
export const SOLO_QUICK_REVIVE_LIMIT = 3;

export function perkCost(perk: PerkId, playerCount: number): number {
  return perk === 'quick-revive' && playerCount === 1 ? SOLO_QUICK_REVIVE_COST : PERKS[perk].cost;
}
export function perkPrompt(perk: PerkId, powerOn: boolean, playerCount = 2, soloUses = 0): string {
  if (perk === 'quick-revive' && playerCount === 1 && soloUses >= SOLO_QUICK_REVIVE_LIMIT) return 'Quick Revive depleted';
  return powerOn || perk === 'quick-revive' && playerCount === 1
    ? `E  ${PERKS[perk].name} [${perkCost(perk, playerCount)}]` : POWER_REQUIRED_PROMPT;
}
export function createPerkMachine(definition: PerkMachineDefinition, id: EntityId): {
  state: PerkMachineState; interactable: InteractableState;
} {
  return {
    state: { id: definition.id, perk: definition.perk, interactableId: id },
    interactable: createInteractableState(id, definition.position, {
      interactionType: 'perk', actionId: `perk:${definition.id}`, prompt: perkPrompt(definition.perk, false),
      // Facing roughly toward the machine is enough, and standing right against it always is.
      interactionRange: 2.2, minFacingDot: 0,
    }),
  };
}

export function hasPerk(player: PlayerState, perk: PerkId): boolean {
  return player.perks.includes(perk);
}
export function playerMaxHealth(player: PlayerState, base: number): number {
  return hasPerk(player, 'juggernog') ? PERK_RULES.juggernogHealth : base;
}

export function buyPerk(player: PlayerState, interaction: InteractionEvent, machines: readonly PerkMachineState[],
  powerOn: boolean, playerCount = 2): Array<EconomyEvent | PerkEvent> {
  if (interaction.interactionType !== 'perk') return [];
  const machine = machines.find(candidate => candidate.interactableId === interaction.interactableId);
  const soloRevive = machine?.perk === 'quick-revive' && playerCount === 1;
  if (!machine || !player.alive || hasPerk(player, machine.perk) || (!powerOn && !soloRevive)
    || (soloRevive && player.selfRevives >= SOLO_QUICK_REVIVE_LIMIT)) return [];
  const spend = spendPoints(player, perkCost(machine.perk, playerCount), `perk:${machine.perk}`);
  if (spend.type === 'pointsSpendRejected') return [spend];
  player.perks.push(machine.perk);
  // Jugger-Nog's extra health arrives with the drink.
  if (machine.perk === 'juggernog') player.health += PERK_RULES.juggernogHealth - 100;
  return [spend, { type: 'perkBought', playerId: player.id, perk: machine.perk }];
}

/** Machines show their price once the power is on. */
export function syncPerkInteractables(machines: readonly PerkMachineState[], interactables: readonly InteractableState[],
  powerOn: boolean, playerCount = 2, soloUses = 0): void {
  for (const machine of machines) {
    const item = interactables.find(candidate => candidate.id === machine.interactableId);
    if (item) {
      item.prompt = perkPrompt(machine.perk, powerOn, playerCount, soloUses);
      item.enabled = !(machine.perk === 'quick-revive' && playerCount === 1 && soloUses >= SOLO_QUICK_REVIVE_LIMIT);
    }
  }
}
