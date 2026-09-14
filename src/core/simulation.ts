import type { CollisionBox, WalkSurface } from './collision.ts';
import {
  closedDoorBlockers, createDoorInteractable, createDoorState, handleDoorInteraction,
  type DoorDefinition, type DoorEvent, type DoorState,
} from './door.ts';
import {
  DEFAULT_ECONOMY_CONFIG, awardCombatPoints,
  type EconomyConfig, type EconomyEvent,
} from './economy.ts';
import { livingEntityCount, livingPlayers, type DamageEvent } from './health.ts';
import { createInputFrame, type InputFrame } from './input.ts';
import {
  findInteractionCandidate, triggerInteraction,
  type InteractionCandidate, type InteractionEvent,
} from './interaction.ts';
import { PLAYER_MOVEMENT, createPlayerState, updatePlayerMovement } from './player.ts';
import {
  createRoundState, updateRoundState, type RoundConfig, type RoundEvent, type RoundState,
} from './rounds.ts';
import {
  createSpawnDirector, remainingSpawns, tickSpawnDirector,
  type SpawnDirectorConfig, type SpawnDirectorState,
} from './spawning.ts';
import type { NavigationGraph } from './navigation.ts';
import type { EntityId, InteractableState, PlayerState, Vec3, WorldState, ZombieState } from './types.ts';
import { addEntity, allocateEntityId, createWorld } from './world.ts';
import {
  createZombieState, tickZombieMelee, updateZombiePursuit, type ZombieAttackEvent,
} from './zombie.ts';
import {
  beginReload, firePlayerWeapon, rayFromPlayer, tickWeaponState, wantsToFire, type WeaponEvent,
} from './weapon.ts';
import {
  createWallWeaponInteractable, createWallWeaponState, handleWallWeaponInteraction,
  type WallWeaponDefinition, type WallWeaponEvent, type WallWeaponState,
} from './wallWeapon.ts';

export interface SimulationMap {
  collisionBoxes: readonly CollisionBox[];
  walkSurfaces: readonly WalkSurface[];
  zombieSpawns: readonly Vec3[];
  navigationGraph?: NavigationGraph;
  doors?: readonly DoorDefinition[];
  wallWeapons?: readonly WallWeaponDefinition[];
}

export interface SimulationState {
  world: WorldState;
  round: RoundState;
  spawnDirector: SpawnDirectorState | null;
  doors: DoorState[];
  wallWeapons: WallWeaponState[];
}
export interface ZombieSpawnedEvent {
  type: 'zombieSpawned';
  zombieId: EntityId;
  round: number;
  spawnIndex: number;
}

export type SimulationEvent = RoundEvent | ZombieSpawnedEvent | ZombieAttackEvent | DamageEvent | WeaponEvent | EconomyEvent | InteractionEvent | DoorEvent | WallWeaponEvent;
export type PlayerInputFrames = Readonly<Partial<Record<EntityId, InputFrame>>>;

export interface GameSimulationOptions {
  seed: number;
  map: SimulationMap;
  playerSpawns: readonly Vec3[];
  roundConfig?: RoundConfig;
  spawnConfig?: SpawnDirectorConfig;
  economyConfig?: EconomyConfig;
}

export class GameSimulation {
  readonly state: SimulationState;
  readonly playerIds: EntityId[] = [];
  private readonly map: SimulationMap;
  private readonly roundConfig?: RoundConfig;
  private readonly spawnConfig?: SpawnDirectorConfig;
  private readonly economyConfig: EconomyConfig;

  constructor(options: GameSimulationOptions) {
    this.map = options.map;
    this.roundConfig = options.roundConfig;
    this.spawnConfig = options.spawnConfig;
    this.economyConfig = options.economyConfig ?? DEFAULT_ECONOMY_CONFIG;
    const world = createWorld(options.seed);
    for (const spawn of options.playerSpawns) {
      const id = allocateEntityId(world);
      addEntity(world, createPlayerState(id, spawn, this.economyConfig.startingPoints));
      this.playerIds.push(id);
    }
    const doors: DoorState[] = [];
    for (const definition of options.map.doors ?? []) {
      const interactableId = allocateEntityId(world);
      addEntity(world, createDoorInteractable(interactableId, definition));
      doors.push(createDoorState(definition, interactableId));
    }
    const wallWeapons: WallWeaponState[] = [];
    for (const definition of options.map.wallWeapons ?? []) {
      const interactableId = allocateEntityId(world);
      addEntity(world, createWallWeaponInteractable(interactableId, definition));
      wallWeapons.push(createWallWeaponState(definition, interactableId));
    }
    this.state = { world, round: createRoundState(), spawnDirector: null, doors, wallWeapons };
  }

  getPlayer(id: EntityId): PlayerState | null {
    const entity = this.state.world.entities[id];
    return entity?.kind === 'player' ? entity : null;
  }

  collisionBoxes(): CollisionBox[] {
    return [...this.map.collisionBoxes, ...closedDoorBlockers(this.state.doors)];
  }

  zombies(): ZombieState[] {
    return Object.values(this.state.world.entities).filter(
      (entity): entity is ZombieState => entity.kind === 'zombie' && entity.alive,
    );
  }

  interactables(): InteractableState[] {
    return Object.values(this.state.world.entities).filter(
      (entity): entity is InteractableState => entity.kind === 'interactable' && entity.alive,
    );
  }

  interactionCandidate(playerId: EntityId): InteractionCandidate | null {
    const player = this.getPlayer(playerId);
    return player ? findInteractionCandidate(player, this.interactables()) : null;
  }

  tick(inputs: PlayerInputFrames = {}, deltaSeconds = 1 / 60): SimulationEvent[] {
    const events: SimulationEvent[] = [];
    const world = this.state.world;

    const playerFrames = new Map<EntityId, InputFrame>();
    for (const player of livingPlayers(world)) {
      const frame = inputs[player.id] ?? createInputFrame(world.tick);
      playerFrames.set(player.id, frame);
      updatePlayerMovement(player, frame, deltaSeconds, this.collisionBoxes(), this.map.walkSurfaces);
      events.push(...tickWeaponState(player));
      if (frame.actions.reload?.pressed) events.push(...beginReload(player));
      if (frame.actions.interact?.pressed) {
        const interactionEvents = triggerInteraction(player, this.interactables(), true);
        events.push(...interactionEvents);
        for (const interaction of interactionEvents) {
          events.push(...handleDoorInteraction(player, interaction, this.state.doors, this.interactables()));
          events.push(...handleWallWeaponInteraction(player, interaction, this.state.wallWeapons));
        }
      }
    }

    for (const player of livingPlayers(world)) {
      const frame = playerFrames.get(player.id)!;
      const fire = frame.actions.fire;
      if (!wantsToFire(player, fire?.pressed ?? false, fire?.held ?? false)) continue;
      const weaponEvents = firePlayerWeapon(
        player, rayFromPlayer(player, PLAYER_MOVEMENT.eyeHeight), this.zombies(), this.collisionBoxes(),
      );
      events.push(...weaponEvents);
      events.push(...awardCombatPoints(player, weaponEvents, this.economyConfig));
    }

    if (this.state.round.phase === 'spawning' && this.state.spawnDirector) {
      const request = tickSpawnDirector(
        this.state.spawnDirector,
        livingEntityCount(world, 'zombie'),
        this.map.zombieSpawns,
        world.seed,
        this.spawnConfig,
      );
      if (request) {
        const id = allocateEntityId(world);
        addEntity(world, createZombieState(id, request.position, this.state.round.round));
        events.push({
          type: 'zombieSpawned', zombieId: id, round: this.state.round.round,
          spawnIndex: request.spawnIndex,
        });
      }
    }

    const players = livingPlayers(world);
    for (const zombie of this.zombies()) {
      updateZombiePursuit(
        zombie, players, deltaSeconds, this.collisionBoxes(), this.map.walkSurfaces,
        this.map.navigationGraph,
      );
      events.push(...tickZombieMelee(zombie, players));
    }

    const roundEvents = updateRoundState(this.state.round, {
      livingPlayers: livingPlayers(world).length,
      zombiesAlive: livingEntityCount(world, 'zombie'),
      spawnsRemaining: remainingSpawns(this.state.spawnDirector),
    }, this.roundConfig);
    events.push(...roundEvents);

    for (const event of roundEvents) {
      if (event.to === 'spawning') {
        this.state.spawnDirector = createSpawnDirector(event.round, this.spawnConfig);
      }
    }
    world.tick += 1;
    return events;
  }
}
export type HeadlessInputProvider = (
  tick: number,
  simulation: GameSimulation,
) => PlayerInputFrames;

export function runHeadlessTicks(
  simulation: GameSimulation,
  count: number,
  inputProvider?: HeadlessInputProvider,
): SimulationState {
  if (!Number.isInteger(count) || count < 0) throw new RangeError('count must be a non-negative integer.');
  for (let tick = 0; tick < count; tick += 1) {
    simulation.tick(inputProvider?.(tick, simulation) ?? {});
  }
  return simulation.state;
}
