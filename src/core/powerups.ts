import type { BarrierState } from './barrier.ts';
import type { CollisionBox } from './collision.ts';
import { SeededRng } from './rng.ts';
import type { EntityId, PlayerState, Vec3, ZombieState } from './types.ts';
import { WEAPON_DEFINITIONS } from './weapon.ts';
import { rayAabbDistance } from './weapon.ts';

export type PowerupKind = 'maxAmmo';

export interface PowerupDrop {
  id: string;
  kind: PowerupKind;
  position: Vec3;
  ticksRemaining: number;
}

export interface PowerupState {
  drops: PowerupDrop[];
  nextId: number;
  lastDropTick: number;
}

export interface PowerupConfig {
  dropChanceDenominator: number;
  minimumTicksBetweenDrops: number;
  lifetimeTicks: number;
  pickupRadius: number;
}

export const DEFAULT_POWERUP_CONFIG: Readonly<PowerupConfig> = {
  dropChanceDenominator: 18,
  minimumTicksBetweenDrops: 600,
  lifetimeTicks: 900,
  pickupRadius: 1.25,
};

export type PowerupEvent =
  | { type: 'powerupSpawned'; dropId: string; kind: PowerupKind; position: Vec3 }
  | { type: 'powerupCollected'; dropId: string; kind: PowerupKind; playerId: EntityId }
  | { type: 'powerupExpired'; dropId: string; kind: PowerupKind };

export function createPowerupState(): PowerupState {
  return { drops: [], nextId: 1, lastDropTick: -1_000_000 };
}

export function tickPowerupLifetime(state: PowerupState): PowerupEvent[] {
  const events: PowerupEvent[] = [];
  for (const drop of state.drops) {
    drop.ticksRemaining -= 1;
    if (drop.ticksRemaining <= 0) events.push({ type: 'powerupExpired', dropId: drop.id, kind: drop.kind });
  }
  state.drops = state.drops.filter(drop => drop.ticksRemaining > 0);
  return events;
}

/** A kill only creates a pickup; its gameplay effect happens on physical collection. */
export function tryDropPowerup(
  state: PowerupState,
  zombie: ZombieState,
  barriers: readonly BarrierState[],
  worldSeed: number,
  tick: number,
  config: PowerupConfig = DEFAULT_POWERUP_CONFIG,
): PowerupEvent[] {
  if (state.drops.length || tick - state.lastDropTick < config.minimumTicksBetweenDrops) return [];
  const zombieNumber = Number(zombie.id.slice(2));
  const rng = new SeededRng(worldSeed ^ Math.imul(zombieNumber, 0x9e3779b9) ^ tick);
  if (rng.int(0, config.dropChanceDenominator) !== 0) return [];
  // Zombies shot before entering would otherwise drop an unreachable reward outdoors.
  const entrance = zombie.entry && barriers.find(barrier => barrier.id === zombie.entry!.barrierId);
  const position = { ...(entrance ? entrance.insidePoint : zombie.position) };
  const drop: PowerupDrop = { id: `p:${state.nextId++}`, kind: 'maxAmmo', position,
    ticksRemaining: config.lifetimeTicks };
  state.drops.push(drop);
  state.lastDropTick = tick;
  return [{ type: 'powerupSpawned', dropId: drop.id, kind: drop.kind, position: { ...position } }];
}

function unobstructed(player: PlayerState, drop: PowerupDrop, boxes: readonly CollisionBox[]): boolean {
  const from = { x: player.position.x, y: player.position.y + 1, z: player.position.z };
  const to = { x: drop.position.x, y: drop.position.y + 0.5, z: drop.position.z };
  const distance = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
  if (distance < 0.001) return true;
  const ray = { origin: from, direction: { x: (to.x - from.x) / distance,
    y: (to.y - from.y) / distance, z: (to.z - from.z) / distance } };
  return boxes.every(box => rayAabbDistance(ray, box.min, box.max, distance - 0.01) === null);
}

function refillAmmo(player: PlayerState): void {
  for (const weapon of [player.weapon, player.holsteredWeapon]) {
    if (!weapon) continue;
    const definition = WEAPON_DEFINITIONS[weapon.weaponId];
    if (definition) weapon.reserveAmmo = Math.max(weapon.reserveAmmo, definition.startingReserveAmmo);
  }
}

/** Stable player/drop ordering gives a single collector even in overlapping co-op pickups. */
export function collectPowerups(
  state: PowerupState,
  players: readonly PlayerState[],
  boxes: readonly CollisionBox[],
  config: PowerupConfig = DEFAULT_POWERUP_CONFIG,
): PowerupEvent[] {
  const events: PowerupEvent[] = [];
  const living = players.filter(player => player.alive).sort((a, b) => a.id.localeCompare(b.id));
  for (const drop of state.drops) {
    const collector = living.find(player => Math.hypot(player.position.x - drop.position.x,
      player.position.z - drop.position.z) <= config.pickupRadius
      && Math.abs(player.position.y - drop.position.y) <= 1.5 && unobstructed(player, drop, boxes));
    if (!collector) continue;
    if (drop.kind === 'maxAmmo') for (const player of living) refillAmmo(player);
    events.push({ type: 'powerupCollected', dropId: drop.id, kind: drop.kind, playerId: collector.id });
  }
  const collected = new Set(events.map(event => event.dropId));
  state.drops = state.drops.filter(drop => !collected.has(drop.id));
  return events;
}
