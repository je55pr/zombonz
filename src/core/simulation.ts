import type { CollisionBox, WalkSurface } from './collision.ts';
import { createMysteryBox, tickMysteryBoxes, useMysteryBox,
  type MysteryBoxDefinition, type MysteryBoxState, type MysteryBoxEvent } from './mysteryBox.ts';
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
import { createNavigationQuery, hasClearNavigationLine, type NavigationGraph, type NavigationQuery } from './navigation.ts';
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
  shotBlockers?: readonly CollisionBox[];
  walkSurfaces: readonly WalkSurface[];
  zombieSpawns: readonly Vec3[];
  navigationGraph?: NavigationGraph;
  doors?: readonly DoorDefinition[];
  wallWeapons?: readonly WallWeaponDefinition[];
  mysteryBoxes?: readonly MysteryBoxDefinition[];
}

export interface SimulationState {
  world: WorldState;
  round: RoundState;
  spawnDirector: SpawnDirectorState | null;
  doors: DoorState[];
  wallWeapons: WallWeaponState[];
  mysteryBoxes: MysteryBoxState[];
}
export interface ZombieSpawnedEvent {
  type: 'zombieSpawned';
  zombieId: EntityId;
  round: number;
  spawnIndex: number;
}

export interface MatchRestartedEvent {
  type: 'matchRestarted';
  previousSeed: number;
  seed: number;
}

export function nextMatchSeed(seed: number): number {
  return (seed + 0x9e3779b9) >>> 0;
}

export type SimulationEvent = RoundEvent | ZombieSpawnedEvent | ZombieAttackEvent | DamageEvent | WeaponEvent | EconomyEvent | InteractionEvent | DoorEvent | WallWeaponEvent | MysteryBoxEvent | MatchRestartedEvent;
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
  state: SimulationState;
  readonly playerIds: EntityId[] = [];
  private readonly map: SimulationMap;
  private readonly roundConfig?: RoundConfig;
  private readonly spawnConfig?: SpawnDirectorConfig;
  private readonly economyConfig: EconomyConfig;
  private readonly playerSpawns: readonly Vec3[];
  private navigationCache?: { doors: string; query: NavigationQuery };

  constructor(options: GameSimulationOptions) {
    this.map = options.map;
    this.roundConfig = options.roundConfig;
    this.spawnConfig = options.spawnConfig;
    this.economyConfig = options.economyConfig ?? DEFAULT_ECONOMY_CONFIG;
    this.playerSpawns = options.playerSpawns.map((spawn) => ({ ...spawn }));
    this.state = this.createMatchState(options.seed);
  }

  private createMatchState(seed: number): SimulationState {
    const world = createWorld(seed);
    this.playerIds.length = 0;
    for (const spawn of this.playerSpawns) {
      const id = allocateEntityId(world);
      addEntity(world, createPlayerState(id, spawn, this.economyConfig.startingPoints));
      this.playerIds.push(id);
    }
    const doors: DoorState[] = [];
    for (const definition of this.map.doors ?? []) {
      const interactableId = allocateEntityId(world);
      addEntity(world, createDoorInteractable(interactableId, definition));
      doors.push(createDoorState(definition, interactableId));
    }
    const wallWeapons: WallWeaponState[] = [];
    for (const definition of this.map.wallWeapons ?? []) {
      const interactableId = allocateEntityId(world);
      addEntity(world, createWallWeaponInteractable(interactableId, definition));
      wallWeapons.push(createWallWeaponState(definition, interactableId));
    }
    const mysteryBoxes: MysteryBoxState[] = [];
    for (const definition of this.map.mysteryBoxes ?? []) {
      const box = createMysteryBox(definition, allocateEntityId(world));
      addEntity(world, box.interactable);
      mysteryBoxes.push(box.state);
    }
    return { world, round: createRoundState(), spawnDirector: null, doors, wallWeapons, mysteryBoxes };
  }

  restart(seed = nextMatchSeed(this.state.world.seed)): MatchRestartedEvent {
    const previousSeed = this.state.world.seed;
    this.state = this.createMatchState(seed);
    return { type: 'matchRestarted', previousSeed, seed: this.state.world.seed };
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
    return player ? findInteractionCandidate(player, this.reachableInteractables(player)) : null;
  }

  private navigationQuery(): NavigationQuery {
    const doors = this.state.doors.map(door => `${door.id}:${door.open}`).join('|');
    if (this.navigationCache?.doors !== doors) {
      this.navigationCache = { doors, query: createNavigationQuery(this.map.navigationGraph,
        this.collisionBoxes(), 0.32, this.map.walkSurfaces) };
    }
    return this.navigationCache!.query;
  }

  private reachableInteractables(player: PlayerState): InteractableState[] {
    const eye = { ...player.position, y: player.position.y + PLAYER_MOVEMENT.eyeHeight };
    return this.interactables().filter(item => {
      const blockers = [...this.map.collisionBoxes, ...closedDoorBlockers(this.state.doors
        .filter(door => door.interactableId !== item.id)), ...(this.map.shotBlockers ?? [])];
      return hasClearNavigationLine(eye, item.position, blockers, 0, 0);
    });
  }

  tick(inputs: PlayerInputFrames = {}, deltaSeconds = 1 / 60): SimulationEvent[] {
    if (this.state.round.phase === 'gameOver') {
      const restartRequested = Object.values(inputs).some((frame) => frame?.actions.restart?.pressed);
      if (restartRequested) return [this.restart()];
    }
    const events: SimulationEvent[] = [];
    const world = this.state.world;
    tickMysteryBoxes(this.state.mysteryBoxes, this.interactables());

    const playerFrames = new Map<EntityId, InputFrame>();
    for (const player of livingPlayers(world)) {
      const frame = inputs[player.id] ?? createInputFrame(world.tick);
      playerFrames.set(player.id, frame);
      updatePlayerMovement(player, frame, deltaSeconds, this.collisionBoxes(), this.map.walkSurfaces);
      events.push(...tickWeaponState(player));
      if (frame.actions.reload?.pressed) events.push(...beginReload(player));
      if (frame.actions.interact?.pressed) {
        const interactionEvents = triggerInteraction(player, this.reachableInteractables(player), true);
        events.push(...interactionEvents);
        for (const interaction of interactionEvents) {
          events.push(...handleDoorInteraction(player, interaction, this.state.doors, this.interactables()));
          events.push(...handleWallWeaponInteraction(player, interaction, this.state.wallWeapons));
          events.push(...useMysteryBox(player, interaction, this.state.mysteryBoxes, world.seed));
        }
      }
    }

    for (const player of livingPlayers(world)) {
      const frame = playerFrames.get(player.id)!;
      const fire = frame.actions.fire;
      if (!wantsToFire(player, fire?.pressed ?? false, fire?.held ?? false)) continue;
      const weaponEvents = firePlayerWeapon(
        player, rayFromPlayer(player, PLAYER_MOVEMENT.eyeHeight), this.zombies(),
        [...this.collisionBoxes(), ...(this.map.shotBlockers ?? [])],
      );
      events.push(...weaponEvents);
      events.push(...awardCombatPoints(player, weaponEvents, this.economyConfig));
    }

    const navigate = this.navigationQuery();
    if (this.state.round.phase === 'spawning' && this.state.spawnDirector) {
      // Never strand a round's enemies behind unopened rooms or stair debris.
      const availableSpawns = this.map.navigationGraph ? this.map.zombieSpawns.filter(spawn =>
        livingPlayers(world).some(player => {
          const waypoint = navigate(spawn, player.position);
          return waypoint !== spawn;
        })) : this.map.zombieSpawns;
      const request = tickSpawnDirector(
        this.state.spawnDirector,
        livingEntityCount(world, 'zombie'),
        availableSpawns,
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
        navigate,
      );
      events.push(...tickZombieMelee(zombie, players, this.collisionBoxes()));
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
