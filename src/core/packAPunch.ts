import { spendPoints, type EconomyEvent } from './economy.ts';
import { createInteractableState, type InteractionEvent } from './interaction.ts';
import { POWER_REQUIRED_PROMPT } from './perks.ts';
import type { CollisionBox } from './collision.ts';
import type { EntityId, InteractableState, PlayerState, Vec3 } from './types.ts';
import { isUpgradedWeapon, upgradeIdFor } from './upgrades.ts';
import { WEAPON_SWITCH_TICKS, equipWeapon, weaponName } from './weapon.ts';

/**
 * The Pack-a-Punch machine (issue #147). A player puts the gun they are holding into it for `cost` points, and the
 * machine takes `upgradeTicks` to turn it into its upgraded version (see upgrades.ts); the player then has
 * `collectTicks` to take it, or it is lost, as in Black Ops. The times and the price are balance choices near the
 * original's (5000 points, about five seconds, about twelve to take it).
 */
export const PACK_A_PUNCH_RULES = { cost: 5000, upgradeTicks: 300, collectTicks: 720 } as const;
/** The machine's solid body, in metres: across its front, front to back, and tall. */
export const PACK_A_PUNCH_BODY = { width: 1.6, depth: 1.0, height: 2.3 } as const;
/** How far in front of the machine's face the buy point is, and how high (chest height, as for the perk machines). */
const USE_GAP = 0.75;
const USE_HEIGHT = 1;

/**
 * Where a machine stands and which way it faces. `position` is the middle of its footprint on the floor and `yaw`
 * which way its front looks (0 faces +z, so a quarter turn is +x); the yaw must be a multiple of a quarter turn, as
 * the body is an axis-aligned box.
 */
export interface PackAPunchDefinition { id: string; position: Vec3; yaw: number; cost?: number }

/**
 * `upgrading`: the gun is inside; `ready`: the upgraded gun is out, for its owner to take. `weaponId` is the upgraded
 * gun's id from the moment the gun goes in (the base gun's model is what is shown until it is ready).
 */
export interface PackAPunchState {
  id: string; interactableId: EntityId; cost: number;
  position: Vec3; yaw: number;
  phase: 'idle' | 'upgrading' | 'ready';
  ownerId: EntityId | null;
  weaponId: string | null;
  cooldownTicks: number;
}

/** The phases in snapshot order: a snapshot sends a machine's phase as an index into this. */
export const PACK_A_PUNCH_PHASES = ['idle', 'upgrading', 'ready'] as const satisfies readonly PackAPunchState['phase'][];

export type PackAPunchRefusal = 'noSecondWeapon' | 'notUpgradable' | 'alreadyUpgraded' | 'busy';
export type PackAPunchEvent =
  | { type: 'packAPunchStarted'; playerId: EntityId; machineId: string; weaponId: string }
  | { type: 'packAPunchReady'; playerId: EntityId; machineId: string; weaponId: string }
  | { type: 'packAPunchCollected'; playerId: EntityId; machineId: string; weaponId: string }
  /** The upgraded gun was not taken in time, or its owner is gone. */
  | { type: 'packAPunchLost'; machineId: string; weaponId: string }
  | { type: 'packAPunchRefused'; playerId: EntityId; machineId: string; reason: PackAPunchRefusal };

/** The unit vector out of the machine's front, on the floor: (x, z). */
function frontOf(yaw: number): { x: number; z: number } { return { x: Math.sin(yaw), z: Math.cos(yaw) }; }

/** The machine's solid body. Its front and back are the sides the yaw points along and away from. */
export function packAPunchBlocker(machine: Pick<PackAPunchState, 'position' | 'yaw'>): CollisionBox {
  const facingZ = Math.abs(Math.cos(machine.yaw)) > 0.5;
  const hx = (facingZ ? PACK_A_PUNCH_BODY.width : PACK_A_PUNCH_BODY.depth) / 2;
  const hz = (facingZ ? PACK_A_PUNCH_BODY.depth : PACK_A_PUNCH_BODY.width) / 2;
  const { x, y, z } = machine.position;
  return { min: { x: x - hx, y, z: z - hz }, max: { x: x + hx, y: y + PACK_A_PUNCH_BODY.height, z: z + hz } };
}

/** Where a player stands to use the machine: in front of its face, at chest height (the interactable's position). */
export function packAPunchUsePoint(machine: Pick<PackAPunchState, 'position' | 'yaw'>): Vec3 {
  const front = frontOf(machine.yaw), reach = PACK_A_PUNCH_BODY.depth / 2 + USE_GAP;
  return { x: machine.position.x + front.x * reach, y: machine.position.y + USE_HEIGHT, z: machine.position.z + front.z * reach };
}

/** Why the gun in this player's hand cannot be put in the machine, or null when it can. */
export function packAPunchRefusal(player: PlayerState): Exclude<PackAPunchRefusal, 'busy'> | null {
  const held = player.weapon.weaponId;
  if (isUpgradedWeapon(held)) return 'alreadyUpgraded';
  if (!upgradeIdFor(held)) return 'notUpgradable';
  // The gun goes into the machine, so there must be another to hold meanwhile: a player is never empty-handed.
  if (!player.holsteredWeapon) return 'noSecondWeapon';
  return null;
}

/** What the machine's interactable says to this player (or, with none, to anyone). */
export function packAPunchPrompt(machine: PackAPunchState, player: PlayerState | undefined, powerOn: boolean): string {
  if (!powerOn) return POWER_REQUIRED_PROMPT;
  const mine = !!player && machine.ownerId === player.id;
  if (machine.phase === 'upgrading') return mine ? 'Pack-a-Punch  upgrading…' : 'Pack-a-Punch is in use';
  if (machine.phase === 'ready') {
    if (!mine) return 'Pack-a-Punch is in use';
    // With both hands full (a gun was bought meanwhile), taking it replaces the one in hand, as a wall buy would.
    const swap = player!.holsteredWeapon ? `  (replaces the ${weaponName(player!.weapon.weaponId)})` : '';
    return `E  Take ${weaponName(machine.weaponId!)} [${Math.ceil(machine.cooldownTicks / 60)}s]${swap}`;
  }
  const refusal = player && packAPunchRefusal(player);
  if (refusal === 'alreadyUpgraded') return `The ${weaponName(player!.weapon.weaponId)} is already Pack-a-Punched`;
  if (refusal === 'notUpgradable') return `The ${weaponName(player!.weapon.weaponId)} cannot be Pack-a-Punched`;
  if (refusal === 'noSecondWeapon') return 'Pack-a-Punch needs a second weapon to hold meanwhile';
  return `E  Pack-a-Punch [${machine.cost}]`;
}

export function createPackAPunch(definition: PackAPunchDefinition, id: EntityId): {
  state: PackAPunchState; interactable: InteractableState;
} {
  if (!Number.isFinite(definition.yaw) || Math.abs(Math.sin(2 * definition.yaw)) > 1e-6) {
    throw new RangeError(`Pack-a-Punch ${definition.id}: its yaw must be a multiple of a quarter turn.`);
  }
  const state: PackAPunchState = { id: definition.id, interactableId: id, cost: definition.cost ?? PACK_A_PUNCH_RULES.cost,
    position: { ...definition.position }, yaw: definition.yaw, phase: 'idle', ownerId: null, weaponId: null, cooldownTicks: 0 };
  return {
    state,
    interactable: createInteractableState(id, packAPunchUsePoint(state), {
      interactionType: 'packAPunch', actionId: `pap:${definition.id}`, prompt: POWER_REQUIRED_PROMPT,
      // Facing roughly toward the machine is enough, and standing right against it always is.
      interactionRange: 2.4, minFacingDot: 0,
    }),
  };
}

/**
 * A press of use at a machine. When it is idle, the gun in hand goes in (for the price) and the player's other gun
 * becomes the one in hand; when the upgraded gun is ready, its owner takes it, and it goes where a bought gun would.
 */
export function handlePackAPunchInteraction(player: PlayerState, interaction: InteractionEvent,
  machines: readonly PackAPunchState[], powerOn: boolean): Array<EconomyEvent | PackAPunchEvent> {
  if (interaction.interactionType !== 'packAPunch') return [];
  const machine = machines.find(candidate => candidate.interactableId === interaction.interactableId);
  if (!machine || !player.alive || player.downed || !powerOn) return [];
  if (machine.phase === 'ready' && machine.ownerId === player.id && machine.weaponId) {
    equipWeapon(player, machine.weaponId);
    const weaponId = machine.weaponId;
    Object.assign(machine, { phase: 'idle', ownerId: null, weaponId: null, cooldownTicks: 0 });
    return [{ type: 'packAPunchCollected', playerId: player.id, machineId: machine.id, weaponId }];
  }
  if (machine.phase !== 'idle') return [{ type: 'packAPunchRefused', playerId: player.id, machineId: machine.id, reason: 'busy' }];
  const refusal = packAPunchRefusal(player);
  if (refusal) return [{ type: 'packAPunchRefused', playerId: player.id, machineId: machine.id, reason: refusal }];
  const spend = spendPoints(player, machine.cost, `pap:${machine.id}`);
  if (spend.type === 'pointsSpendRejected') return [spend];
  const weaponId = upgradeIdFor(player.weapon.weaponId)!;
  // The gun goes into the machine; the other one comes to hand, and is drawn.
  player.weapon = player.holsteredWeapon!; player.holsteredWeapon = null;
  player.weapon.reloadTicksRemaining = 0;
  player.switchTicksRemaining = WEAPON_SWITCH_TICKS;
  Object.assign(machine, { phase: 'upgrading', ownerId: player.id, weaponId, cooldownTicks: PACK_A_PUNCH_RULES.upgradeTicks });
  return [spend, { type: 'packAPunchStarted', playerId: player.id, machineId: machine.id, weaponId }];
}

/** Runs each machine's clock: upgrading finishes, an untaken gun is lost, and a gone owner's gun with them. */
export function tickPackAPunch(machines: PackAPunchState[], players: readonly PlayerState[]): PackAPunchEvent[] {
  const events: PackAPunchEvent[] = [];
  const lose = (machine: PackAPunchState) => {
    events.push({ type: 'packAPunchLost', machineId: machine.id, weaponId: machine.weaponId! });
    Object.assign(machine, { phase: 'idle', ownerId: null, weaponId: null, cooldownTicks: 0 });
  };
  for (const machine of machines) {
    if (machine.phase === 'idle') continue;
    if (!players.some(player => player.id === machine.ownerId && player.alive)) { lose(machine); continue; }
    if (machine.cooldownTicks > 0) machine.cooldownTicks -= 1;
    if (machine.cooldownTicks > 0) continue;
    if (machine.phase === 'upgrading') {
      machine.phase = 'ready'; machine.cooldownTicks = PACK_A_PUNCH_RULES.collectTicks;
      events.push({ type: 'packAPunchReady', playerId: machine.ownerId!, machineId: machine.id, weaponId: machine.weaponId! });
    } else lose(machine);
  }
  return events;
}

/** The machines' interactables carry the generic prompt (each player's own is worked out where it is asked for). */
export function syncPackAPunchInteractables(machines: readonly PackAPunchState[], interactables: readonly InteractableState[],
  powerOn: boolean): void {
  for (const machine of machines) {
    const item = interactables.find(candidate => candidate.id === machine.interactableId);
    if (item) { item.enabled = true; item.prompt = packAPunchPrompt(machine, undefined, powerOn); }
  }
}
