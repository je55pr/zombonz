import { spendPoints, type EconomyEvent } from './economy.ts';
import { createInteractableState, type InteractionEvent } from './interaction.ts';
import { SeededRng } from './rng.ts';
import { equipWeapon, ownedWeapon, weaponName, WEAPON_DEFINITIONS } from './weapon.ts';
import type { CollisionBox } from './collision.ts';
import type { EntityId, InteractableState, PlayerState, Vec3 } from './types.ts';

export const BOX_RULES = { rollTicks: 180, claimTicks: 600, closingTicks: 120, teddyTicks: 240, awayTicks: 300 } as const;
/** A spot the box can stand on: where buyers use it, the middle of its body, and which way it faces. */
export interface MysteryBoxLocation { id: string; position: Vec3; center: Vec3; yaw: number }
export interface MysteryBoxDefinition {
  id: string; position: Vec3; cost: number; weapons: readonly string[];
  /** Relative odds per weapon; unlisted weapons weigh 1. Rare wonder weapons get less. */
  weights?: Readonly<Record<string, number>>;
  /**
   * Where the box can move to. The first is where it starts, and should match `position`. With more
   * than one, a teddy bear eventually sends the box to another. Without any, the box never moves.
   */
  locations?: readonly MysteryBoxLocation[];
}
export interface MysteryBoxState {
  id: string; interactableId: EntityId; cost: number; weapons: string[]; weights: Record<string, number>;
  rolls: number; cooldownTicks: number; lastWeapon: string | null;
  /** `teddy`: the bear has come up instead of a gun; `away`: the box is gone, on its way elsewhere. */
  phase: 'idle' | 'rolling' | 'offering' | 'closing' | 'teddy' | 'away';
  ownerId: EntityId | null;
  locations: MysteryBoxLocation[]; locationIndex: number;
  /** Rolls at the current spot, and how many times the box has moved: the teddy odds use both. */
  usesHere: number; moves: number;
  /** Whether the current roll will end in the bear. */
  teddy: boolean;
}
export type MysteryBoxEvent =
  | { type: 'mysteryBoxUsed' | 'mysteryBoxClaimed'; playerId: EntityId; boxId: string; weaponId: string }
  | { type: 'mysteryBoxUnavailable'; playerId: EntityId; boxId: string }
  | { type: 'mysteryBoxTeddy'; playerId: EntityId; boxId: string }
  | { type: 'mysteryBoxMoved'; boxId: string; locationId: string };

const BOX_HALF = { long: 2.35 / 2, short: 0.95 / 2, height: 1.04 / 2 };
/** The box's solid body at a location; its long side runs across its facing. */
export function mysteryBoxBlocker(location: MysteryBoxLocation): CollisionBox {
  const acrossX = Math.abs(Math.sin(location.yaw)) > 0.5;
  const hx = acrossX ? BOX_HALF.long : BOX_HALF.short, hz = acrossX ? BOX_HALF.short : BOX_HALF.long;
  const { x, y, z } = location.center;
  return { min: { x: x - hx, y: y - BOX_HALF.height, z: z - hz }, max: { x: x + hx, y: y + BOX_HALF.height, z: z + hz } };
}

/**
 * The teddy odds for a roll, given the rolls already made at this spot, after Black Ops' box script:
 * never in a spot's first four rolls, then 15%. At the starting spot, the roll after the eighth
 * always brings the bear; once the box has moved, the odds rise to 30% after eight rolls and 50%
 * after thirteen.
 */
export function teddyChance(usesHere: number, moves: number): number {
  if (usesHere < 4) return 0;
  if (usesHere < 8) return 0.15;
  if (moves === 0) return 1;
  return usesHere < 13 ? 0.3 : 0.5;
}


export function mysteryBoxPrompt(box: MysteryBoxState, playerId?: EntityId): string {
  if (box.phase === 'teddy' || box.phase === 'away') return 'The box is moving';
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
      rolls: 0, cooldownTicks: 0, lastWeapon: null, phase: 'idle', ownerId: null,
      locations: (definition.locations ?? []).map(location => ({ ...location })), locationIndex: 0,
      usesHere: 0, moves: 0, teddy: false },
    interactable: createInteractableState(id, definition.position, {
      interactionType: 'mysteryBox', actionId: `box:${definition.id}`,
      prompt: `E  Mystery Box [${definition.cost}]`, interactionRange: 2.4, minFacingDot: 0.3,
    }),
  };
}
export function tickMysteryBoxes(boxes: MysteryBoxState[], interactables: readonly InteractableState[],
  players?: readonly PlayerState[], seed = 0): MysteryBoxEvent[] {
  const events: MysteryBoxEvent[] = [];
  for (const box of boxes) {
    if (box.ownerId && players && !players.some(player => player.id === box.ownerId && player.alive)) {
      box.ownerId = null; box.phase = 'closing'; box.cooldownTicks = BOX_RULES.closingTicks;
    }
    if (box.cooldownTicks > 0) box.cooldownTicks -= 1;
    if (box.cooldownTicks === 0) {
      if (box.phase === 'rolling' && box.teddy) {
        // The bear comes up instead of a gun: the buyer gets the price back and the box leaves.
        const owner = players?.find(player => player.id === box.ownerId);
        if (owner) { owner.points += box.cost; events.push({ type: 'mysteryBoxTeddy', playerId: owner.id, boxId: box.id }); }
        box.phase = 'teddy'; box.ownerId = null; box.lastWeapon = null; box.cooldownTicks = BOX_RULES.teddyTicks;
      }
      else if (box.phase === 'rolling') { box.phase = 'offering'; box.cooldownTicks = BOX_RULES.claimTicks; }
      else if (box.phase === 'offering') { box.phase = 'closing'; box.ownerId = null; box.cooldownTicks = BOX_RULES.closingTicks; }
      else if (box.phase === 'closing') { box.phase = 'idle'; box.lastWeapon = null; }
      else if (box.phase === 'teddy') { box.phase = 'away'; box.cooldownTicks = BOX_RULES.awayTicks; }
      else if (box.phase === 'away') {
        const rng = new SeededRng(seed ^ Math.imul(box.moves + 1, 0x632be5ab));
        const next = Math.floor(rng.next() * (box.locations.length - 1));
        box.locationIndex = next >= box.locationIndex ? next + 1 : next;
        box.phase = 'idle'; box.teddy = false; box.usesHere = 0; box.moves += 1;
        events.push({ type: 'mysteryBoxMoved', boxId: box.id, locationId: box.locations[box.locationIndex].id });
      }
    }
    const item = interactables.find(item => item.id === box.interactableId);
    if (item) {
      item.enabled = true; item.prompt = mysteryBoxPrompt(box);
      if (box.locations.length) item.position = { ...box.locations[box.locationIndex].position };
    }
  }
  return events;
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
  box.teddy = box.locations.length > 1 && rng.next() < teddyChance(box.usesHere, box.moves);
  box.rolls += 1; box.usesHere += 1;
  box.phase = 'rolling'; box.ownerId = player.id;
  box.cooldownTicks = BOX_RULES.rollTicks;
  box.lastWeapon = weaponId;
  return [spend, { type: 'mysteryBoxUsed', playerId: player.id, boxId: box.id, weaponId }];
}
