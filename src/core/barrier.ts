import { moveWithCollision, type CollisionBox } from './collision.ts';
import { createInteractableState } from './interaction.ts';
import type { EntityId, InteractableState, Vec3, ZombieState } from './types.ts';

export const BARRIER_RULES = { tearTicks: 75, repairTicks: 60, vaultTicks: 90, vaultHeight: 1 } as const;

export interface BarrierDefinition {
  id: string;
  position: Vec3;
  outward: Vec3;
  width: number;
  /** Zero for an open climb (such as a balcony railing): nothing to tear down or rebuild. */
  maxBoards: number;
  /** How long the crossing takes; a climb up a wall takes longer than a vault through a window. */
  vaultTicks?: number;
  /** Ordered, collision-free exterior waypoints ending at the window. */
  approachPath: readonly Vec3[];
  insidePoint: Vec3;
}
export interface BarrierState extends BarrierDefinition {
  interactableId: EntityId;
  boards: number;
  tearTicks: number;
  repairTicks: number;
  repairerId: EntityId | null;
  vaultingZombieId: EntityId | null;
  lastTornTick: number;
}
export interface ZombieEntryState {
  barrierId: string;
  phase: 'approach' | 'breaking' | 'vaulting';
  waypointIndex: number;
  phaseTicks: number;
  lane: number;
  vaultStart: Vec3 | null;
}
export type BarrierEvent =
  | { type: 'barrierBoardRemoved'; barrierId: string; zombieId: EntityId; boards: number }
  | { type: 'barrierBoardRepaired'; barrierId: string; playerId: EntityId; boards: number }
  | { type: 'zombieVaultStarted' | 'zombieEntered'; barrierId: string; zombieId: EntityId };

export function createBarrier(definition: BarrierDefinition, id: EntityId): {
  state: BarrierState; interactable: InteractableState;
} {
  if (!Number.isInteger(definition.maxBoards) || definition.maxBoards < 0 || definition.approachPath.length < 2) {
    throw new Error('A barrier needs a board count and an exterior approach path.');
  }
  return {
    state: { ...definition, position: { ...definition.position }, outward: { ...definition.outward },
      insidePoint: { ...definition.insidePoint }, approachPath: definition.approachPath.map(point => ({ ...point })),
      interactableId: id, boards: definition.maxBoards, tearTicks: 0, repairTicks: 0,
      repairerId: null, vaultingZombieId: null, lastTornTick: -1 },
    interactable: createInteractableState(id,
      { x: definition.position.x - definition.outward.x * 0.25,
        y: definition.position.y + 1.2, z: definition.position.z - definition.outward.z * 0.25 }, {
        interactionType: 'barrier', actionId: `repair:${definition.id}`,
        prompt: 'Hold E to rebuild barrier', interactionRange: 2.25, minFacingDot: 0.1,
      }),
  };
}

export function createZombieEntry(barrierId: string, ordinal: number): ZombieEntryState {
  return { barrierId, phase: 'approach', waypointIndex: 1, phaseTicks: 0,
    lane: (ordinal % 3 - 1) * 0.5, vaultStart: null };
}

function stop(zombie: ZombieState): void { zombie.velocity = { x: 0, y: 0, z: 0 }; }

function moveToward(zombie: ZombieState, point: Vec3, dt: number, boxes: readonly CollisionBox[]): boolean {
  const dx = point.x - zombie.position.x, dz = point.z - zombie.position.z;
  const distance = Math.hypot(dx, dz);
  if (distance < 0.025) { stop(zombie); return true; }
  const step = Math.min(distance, zombie.moveSpeed * dt);
  const delta = { x: dx / distance * step, y: 0, z: dz / distance * step };
  const next = moveWithCollision(zombie.position, delta, 0.32, 1.72, boxes);
  zombie.velocity = { x: (next.x - zombie.position.x) / dt, y: 0, z: (next.z - zombie.position.z) / dt };
  zombie.position = next;
  return Math.hypot(next.x - point.x, next.z - point.z) < 0.025;
}

/** Releases the crossing slot if its occupant was shot; no dead zombie can jam a window. */
export function prepareBarriers(barriers: BarrierState[], zombies: readonly ZombieState[]): void {
  for (const barrier of barriers) {
    if (!zombies.some(zombie => zombie.id === barrier.vaultingZombieId && zombie.alive
      && zombie.entry?.phase === 'vaulting')) barrier.vaultingZombieId = null;
    if (!zombies.some(zombie => zombie.alive && zombie.entry?.barrierId === barrier.id
      && zombie.entry.phase === 'breaking')) barrier.tearTicks = 0;
  }
}

/** Only this short, explicit window traversal may cross the solid sill. */
export function updateZombieEntry(zombie: ZombieState, barrier: BarrierState,
  zombies: readonly ZombieState[], dt: number, boxes: readonly CollisionBox[], tick: number): BarrierEvent[] {
  const entry = zombie.entry;
  if (!zombie.alive || !entry) return [];
  zombie.targetId = null;
  if (entry.phase === 'approach') {
    const waypoint = barrier.approachPath[entry.waypointIndex];
    const point = { ...waypoint, x: waypoint.x + barrier.outward.z * entry.lane,
      z: waypoint.z - barrier.outward.x * entry.lane };
    if (moveToward(zombie, point, dt, boxes)) {
      entry.waypointIndex += 1;
      if (entry.waypointIndex >= barrier.approachPath.length) {
        entry.phase = 'breaking'; entry.phaseTicks = 0; stop(zombie);
      }
    }
    return [];
  }
  if (entry.phase === 'breaking') {
    stop(zombie);
    entry.phaseTicks += 1;
    // One shared tear timer avoids a group removing all boards in one simulation tick.
    const leader = zombies.find(other => other.alive && other.entry?.barrierId === barrier.id
      && other.entry.phase === 'breaking');
    if (barrier.boards > 0) {
      if (leader?.id !== zombie.id || ++barrier.tearTicks < BARRIER_RULES.tearTicks) return [];
      barrier.tearTicks = 0;
      barrier.boards -= 1;
      barrier.lastTornTick = tick;
      return [{ type: 'barrierBoardRemoved', barrierId: barrier.id, zombieId: zombie.id, boards: barrier.boards }];
    }
    if (barrier.vaultingZombieId !== null || leader?.id !== zombie.id) return [];
    barrier.vaultingZombieId = zombie.id;
    entry.phase = 'vaulting'; entry.phaseTicks = 0; entry.vaultStart = { ...zombie.position };
    return [{ type: 'zombieVaultStarted', barrierId: barrier.id, zombieId: zombie.id }];
  }
  entry.phaseTicks += 1;
  const t = Math.min(1, entry.phaseTicks / (barrier.vaultTicks ?? BARRIER_RULES.vaultTicks));
  const from = entry.vaultStart!;
  // Lift outside, traverse at sill height, then land inside (rather than teleporting). A climb also
  // rises from where it started to the floor it lands on, over the lift and traverse.
  const traverse = Math.max(0, Math.min(1, (t - 0.2) / 0.6));
  const lift = t < 0.2 ? t / 0.2 : t > 0.8 ? (1 - t) / 0.2 : 1;
  const rise = Math.min(1, t / 0.7);
  const next = { x: from.x + (barrier.insidePoint.x - from.x) * traverse,
    z: from.z + (barrier.insidePoint.z - from.z) * traverse,
    y: from.y + (barrier.insidePoint.y - from.y) * rise + BARRIER_RULES.vaultHeight * lift };
  zombie.velocity = { x: (next.x - zombie.position.x) / dt,
    y: (next.y - zombie.position.y) / dt, z: (next.z - zombie.position.z) / dt };
  zombie.position = next;
  if (t < 1) return [];
  zombie.position = { ...barrier.insidePoint };
  zombie.entry = null; barrier.vaultingZombieId = null; stop(zombie);
  return [{ type: 'zombieEntered', barrierId: barrier.id, zombieId: zombie.id }];
}

export function repairBarriers(barriers: BarrierState[], repairers: ReadonlyMap<string, EntityId>): BarrierEvent[] {
  const events: BarrierEvent[] = [];
  for (const barrier of barriers) {
    const playerId = repairers.get(barrier.id);
    if (!playerId || barrier.boards === barrier.maxBoards || barrier.vaultingZombieId !== null) {
      barrier.repairTicks = 0; barrier.repairerId = null; continue;
    }
    if (barrier.repairerId !== playerId) barrier.repairTicks = 0;
    barrier.repairerId = playerId;
    if (++barrier.repairTicks < BARRIER_RULES.repairTicks) continue;
    barrier.repairTicks = 0; barrier.boards += 1;
    events.push({ type: 'barrierBoardRepaired', barrierId: barrier.id, playerId, boards: barrier.boards });
  }
  return events;
}

export function syncBarrierInteractables(barriers: readonly BarrierState[], items: readonly InteractableState[]): void {
  for (const barrier of barriers) {
    const item = items.find(item => item.id === barrier.interactableId);
    if (!item) continue;
    item.enabled = barrier.boards < barrier.maxBoards && barrier.vaultingZombieId === null;
    item.prompt = `Hold E to rebuild  [${barrier.boards}/${barrier.maxBoards} boards]`;
  }
}
