import type { GrenadePool } from '../core/grenade.ts';
import type { MysteryBoxState } from '../core/mysteryBox.ts';
import type { PowerupState } from '../core/powerups.ts';
import type { RoundState } from '../core/rounds.ts';
import type { GameSimulation } from '../core/simulation.ts';
import type { SpawnDirectorState } from '../core/spawning.ts';
import type { EntityId, PlayerState, ZombieState } from '../core/types.ts';

type BoxMotion = Pick<MysteryBoxState, 'phase' | 'cooldownTicks' | 'lastWeapon' | 'ownerId' | 'rolls' | 'locationIndex'
  | 'usesHere' | 'moves' | 'teddy'>;

/**
 * Everything about a match that changes while it runs. Doors, barriers, the box and traps travel as
 * just their changing fields, in the order the map defines them; a client builds the same match from
 * the map, so the rest (and every interactable) already matches or is re-derived.
 */
export interface WorldSnapshot {
  tick: number;
  seed: number;
  next: number;
  players: PlayerState[];
  zombies: ZombieState[];
  round: RoundState;
  director: SpawnDirectorState | null;
  doors: boolean[];
  /** Boards, last torn tick, vaulting zombie, repairer, tear ticks, repair ticks. */
  barriers: Array<[number, number, EntityId | null, EntityId | null, number, number]>;
  boxes: BoxMotion[];
  /** Active ticks, cooldown ticks, owner. */
  traps: Array<[number, number, EntityId | null]>;
  power: boolean;
  powerups: PowerupState;
  grenades: GrenadePool;
  left: EntityId[];
}

/** The live state, by reference: encode it (or clone it) before the simulation ticks again. */
export function captureSnapshot(simulation: GameSimulation): WorldSnapshot {
  const { state } = simulation;
  const entities = Object.values(state.world.entities);
  return {
    tick: state.world.tick,
    seed: state.world.seed,
    next: state.world.nextEntityNumber,
    players: simulation.players(),
    zombies: entities.filter((entity): entity is ZombieState => entity.kind === 'zombie'),
    round: state.round,
    director: state.spawnDirector,
    doors: state.doors.map(door => door.open),
    barriers: state.barriers.map(barrier => [barrier.boards, barrier.lastTornTick, barrier.vaultingZombieId,
      barrier.repairerId, barrier.tearTicks, barrier.repairTicks]),
    boxes: state.mysteryBoxes.map(box => ({ phase: box.phase, cooldownTicks: box.cooldownTicks, lastWeapon: box.lastWeapon,
      ownerId: box.ownerId, rolls: box.rolls, locationIndex: box.locationIndex, usesHere: box.usesHere, moves: box.moves,
      teddy: box.teddy })),
    traps: state.traps.map(trap => [trap.activeTicks, trap.cooldownTicks, trap.ownerId]),
    power: state.power.on,
    powerups: state.powerups,
    grenades: state.grenades,
    left: state.leftPlayers,
  };
}

/**
 * Makes a client's copy of the match match the snapshot, which it takes ownership of. `keep` is the
 * client's own predicted player, which stays in place of the snapshot's copy.
 */
export function applySnapshot(simulation: GameSimulation, snapshot: WorldSnapshot, keep?: PlayerState): void {
  const { state } = simulation;
  const world = state.world;
  world.tick = snapshot.tick;
  world.seed = snapshot.seed;
  world.nextEntityNumber = snapshot.next;
  for (const player of snapshot.players) world.entities[player.id] = keep?.id === player.id ? keep : player;
  for (const entity of Object.values(world.entities)) if (entity.kind === 'zombie') delete world.entities[entity.id];
  for (const zombie of snapshot.zombies) world.entities[zombie.id] = zombie;
  state.round = snapshot.round;
  state.spawnDirector = snapshot.director;
  snapshot.doors.forEach((open, index) => { if (state.doors[index]) state.doors[index].open = open; });
  snapshot.barriers.forEach(([boards, lastTornTick, vaultingZombieId, repairerId, tearTicks, repairTicks], index) => {
    const barrier = state.barriers[index];
    if (barrier) Object.assign(barrier, { boards, lastTornTick, vaultingZombieId, repairerId, tearTicks, repairTicks });
  });
  snapshot.boxes.forEach((motion, index) => { if (state.mysteryBoxes[index]) Object.assign(state.mysteryBoxes[index], motion); });
  snapshot.traps.forEach(([activeTicks, cooldownTicks, ownerId], index) => {
    if (state.traps[index]) Object.assign(state.traps[index], { activeTicks, cooldownTicks, ownerId });
  });
  state.power.on = snapshot.power;
  state.powerups = snapshot.powerups;
  state.grenades = snapshot.grenades;
  state.leftPlayers = snapshot.left;
  simulation.refreshInteractables();
}
