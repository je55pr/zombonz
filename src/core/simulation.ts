import type { CollisionBox, WalkSurface } from './collision.ts';
import { createBarrier, createZombieEntry, prepareBarriers, updateZombieEntry,
  repairBarriers, syncBarrierInteractables, type BarrierDefinition, type BarrierState, type BarrierEvent } from './barrier.ts';
import { createMysteryBox, tickMysteryBoxes, useMysteryBox, mysteryBoxPrompt,
  type MysteryBoxDefinition, type MysteryBoxState, type MysteryBoxEvent } from './mysteryBox.ts';
import {
  closedDoorBlockers, createDoorInteractable, createDoorState, handleDoorInteraction,
  type DoorDefinition, type DoorEvent, type DoorState,
} from './door.ts';
import {
  DEFAULT_ECONOMY_CONFIG, awardCombatPoints, awardRepairPoints, awardNukePoints,
  type EconomyConfig, type EconomyEvent,
} from './economy.ts';
import { livingEntityCount, livingPlayers, tickPlayerRecovery, type DamageEvent } from './health.ts';
import { createInputFrame, type InputFrame } from './input.ts';
import { GRENADE_RULES, createGrenadePool, tickGrenades, throwGrenade,
  type GrenadeEvent, type GrenadePool } from './grenade.ts';
import { collectPowerups, createPowerupState, tickPowerupLifetime, tryDropPowerup,
  DEFAULT_POWERUP_CONFIG, type PowerupConfig, type PowerupEvent, type PowerupState } from './powerups.ts';
import {
  findInteractionCandidate, triggerInteraction,
  type InteractionCandidate, type InteractionEvent,
} from './interaction.ts';
import { PLAYER_MOVEMENT, createPlayerState, updatePlayerMovement } from './player.ts';
import {
  createRoundState, updateRoundState, type RoundConfig, type RoundEvent, type RoundState,
} from './rounds.ts';
import {
  createSpawnDirector, remainingSpawns, tickSpawnDirector, DEFAULT_SPAWN_CONFIG,
  type SpawnDirectorConfig, type SpawnDirectorState, type ZombieSpawnPoint,
} from './spawning.ts';
import { createNavigationQuery, hasClearNavigationLine, type NavigationGraph, type NavigationQuery } from './navigation.ts';
import type { EntityId, InteractableState, PlayerState, Vec3, WorldState, ZombieState } from './types.ts';
import { addEntity, allocateEntityId, createWorld, removeEntity } from './world.ts';
import { SeededRng } from './rng.ts';
import {
  createZombieState, tickZombieMelee, updateZombiePursuit, zombieGaitForRound, type ZombieAttackEvent,
} from './zombie.ts';
import {
  beginReload, firePlayerWeapon, meleeAttack, rayFromPlayer, tickWeaponState, wantsToFire, switchWeapon, type WeaponEvent,
} from './weapon.ts';
import {
  createWallWeaponInteractable, createWallWeaponState, handleWallWeaponInteraction,
  type WallWeaponDefinition, type WallWeaponEvent, type WallWeaponState,
} from './wallWeapon.ts';

export interface SimulationMap {
  collisionBoxes: readonly CollisionBox[];
  shotBlockers?: readonly CollisionBox[];
  walkSurfaces: readonly WalkSurface[];
  zombieSpawns: readonly ZombieSpawnPoint[];
  barriers?: readonly BarrierDefinition[];
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
  barriers: BarrierState[];
  powerups: PowerupState;
  grenades: GrenadePool;
}
export interface ZombieSpawnedEvent {
  type: 'zombieSpawned';
  zombieId: EntityId;
  round: number;
  spawnIndex: number;
  barrierId?: string;
}

export interface MatchRestartedEvent {
  type: 'matchRestarted';
  previousSeed: number;
  seed: number;
}

export function nextMatchSeed(seed: number): number {
  return (seed + 0x9e3779b9) >>> 0;
}

export type SimulationEvent = RoundEvent | ZombieSpawnedEvent | ZombieAttackEvent | DamageEvent | WeaponEvent | EconomyEvent | InteractionEvent | DoorEvent | WallWeaponEvent | MysteryBoxEvent | BarrierEvent | PowerupEvent | GrenadeEvent | MatchRestartedEvent;
export type PlayerInputFrames = Readonly<Partial<Record<EntityId, InputFrame>>>;

export interface GameSimulationOptions {
  seed: number;
  map: SimulationMap;
  playerSpawns: readonly Vec3[];
  roundConfig?: RoundConfig;
  spawnConfig?: SpawnDirectorConfig;
  economyConfig?: EconomyConfig;
  powerupConfig?: PowerupConfig;
}

export class GameSimulation {
  state: SimulationState;
  readonly playerIds: EntityId[] = [];
  private readonly map: SimulationMap;
  private readonly roundConfig?: RoundConfig;
  private readonly spawnConfig?: SpawnDirectorConfig;
  private readonly economyConfig: EconomyConfig;
  private readonly powerupConfig: PowerupConfig;
  private readonly playerSpawns: readonly Vec3[];
  private navigationCache?: { doors: string; query: NavigationQuery };

  constructor(options: GameSimulationOptions) {
    this.map = options.map;
    this.roundConfig = options.roundConfig;
    this.spawnConfig = options.spawnConfig;
    this.economyConfig = options.economyConfig ?? DEFAULT_ECONOMY_CONFIG;
    this.powerupConfig = options.powerupConfig ?? DEFAULT_POWERUP_CONFIG;
    this.playerSpawns = options.playerSpawns.map((spawn) => ({ ...spawn }));
    for (const spawn of this.map.zombieSpawns) {
      if (spawn.barrierId && !this.map.barriers?.some(barrier => barrier.id === spawn.barrierId)) {
        throw new Error(`Spawn references unknown barrier: ${spawn.barrierId}`);
      }
    }
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
    const barriers: BarrierState[] = [];
    for (const definition of this.map.barriers ?? []) {
      const barrier = createBarrier(definition, allocateEntityId(world));
      barriers.push(barrier.state); addEntity(world, barrier.interactable);
    }
    syncBarrierInteractables(barriers, Object.values(world.entities).filter(
      (entity): entity is InteractableState => entity.kind === 'interactable'));
    return { world, round: createRoundState(), spawnDirector: null, doors, wallWeapons, mysteryBoxes, barriers,
      powerups: createPowerupState(), grenades: createGrenadePool() };
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
    const candidate = player ? findInteractionCandidate(player, this.reachableInteractables(player)) : null;
    const box = this.state.mysteryBoxes.find(box => box.interactableId === candidate?.interactableId);
    return candidate && box ? { ...candidate, prompt: mysteryBoxPrompt(box, playerId) } : candidate;
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
      if (!item.enabled || Math.hypot(item.position.x - player.position.x,
        item.position.y - player.position.y, item.position.z - player.position.z) > item.interactionRange) return false;
      const blockers = [...this.map.collisionBoxes, ...closedDoorBlockers(this.state.doors
        .filter(door => door.interactableId !== item.id)), ...(this.map.shotBlockers ?? [])];
      return hasClearNavigationLine(eye, item.position, blockers, 0, 0);
    });
  }

  tick(inputs: PlayerInputFrames = {}, deltaSeconds = 1 / 60): SimulationEvent[] {
    if (this.state.round.phase === 'gameOver') {
      const restartRequested = Object.values(inputs).some((frame) => frame?.actions.restart?.pressed);
      if (restartRequested) return [this.restart()];
      return [];
    }
    const events: SimulationEvent[] = [];
    const world = this.state.world;
    events.push(...tickPowerupLifetime(this.state.powerups));
    tickMysteryBoxes(this.state.mysteryBoxes, this.interactables(), livingPlayers(world));
    const repairers = new Map<string, EntityId>();

    const playerFrames = new Map<EntityId, InputFrame>();
    for (const player of livingPlayers(world)) {
      events.push(...tickPlayerRecovery(player));
      if (player.meleeCooldownTicks > 0) player.meleeCooldownTicks -= 1;
      const frame = inputs[player.id] ?? createInputFrame(world.tick);
      playerFrames.set(player.id, frame);
      updatePlayerMovement(player, frame, deltaSeconds, this.collisionBoxes(), this.map.walkSurfaces,
        [...this.collisionBoxes(), ...(this.map.shotBlockers ?? [])]);
      events.push(...tickWeaponState(player));
      if (frame.actions.switchWeapon?.pressed) events.push(...switchWeapon(player));
      if (frame.actions.reload?.pressed) events.push(...beginReload(player));
      if (frame.actions.throwGrenade?.pressed) events.push(...throwGrenade(this.state.grenades, player));
      if (frame.actions.interact?.held) {
        const candidate = findInteractionCandidate(player, this.reachableInteractables(player));
        const barrier = this.state.barriers.find(barrier => barrier.interactableId === candidate?.interactableId);
        if (barrier && !repairers.has(barrier.id)) repairers.set(barrier.id, player.id);
      }
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
      if (frame.actions.melee?.pressed) {
        const meleeEvents = meleeAttack(player, this.zombies(), [...this.collisionBoxes(), ...(this.map.shotBlockers ?? [])],
          this.state.powerups.instaKillTicksRemaining > 0);
        events.push(...meleeEvents, ...awardCombatPoints(player, meleeEvents, this.economyConfig,
          this.state.powerups.doublePointsTicksRemaining > 0 ? 2 : 1));
      }
      const fire = frame.actions.fire;
      if (!wantsToFire(player, fire?.pressed ?? false, fire?.held ?? false)) continue;
      const weaponEvents = firePlayerWeapon(
        player, rayFromPlayer(player, PLAYER_MOVEMENT.eyeHeight), this.zombies(),
        [...this.collisionBoxes(), ...(this.map.shotBlockers ?? [])],
        this.state.powerups.instaKillTicksRemaining > 0,
        world.seed ^ world.tick,
      );
      events.push(...weaponEvents);
      events.push(...awardCombatPoints(player, weaponEvents, this.economyConfig,
        this.state.powerups.doublePointsTicksRemaining > 0 ? 2 : 1));
    }

    if (this.state.grenades.active.length) {
      const grenadeEvents = tickGrenades(this.state.grenades, this.zombies(), livingPlayers(world),
        [...this.collisionBoxes(), ...(this.map.shotBlockers ?? [])], this.map.walkSurfaces, deltaSeconds,
        this.state.powerups.instaKillTicksRemaining > 0);
      events.push(...grenadeEvents);
      const grenadeCombat = grenadeEvents.filter((event): event is WeaponEvent =>
        event.type === 'grenadeHit' || event.type === 'zombieDamaged' || event.type === 'zombieDied');
      if (grenadeCombat.length) for (const player of livingPlayers(world)) events.push(...awardCombatPoints(player,
        grenadeCombat, this.economyConfig, this.state.powerups.doublePointsTicksRemaining > 0 ? 2 : 1));
    }

    for (const event of events) if (event.type === 'zombieDied') {
      const zombie = world.entities[event.zombieId];
      if (zombie?.kind === 'zombie') events.push(...tryDropPowerup(this.state.powerups, zombie,
        this.state.barriers, world.seed, world.tick, this.powerupConfig));
    }
    if (this.state.powerups.drops.length) {
      const pickupEvents = collectPowerups(this.state.powerups, livingPlayers(world), this.collisionBoxes(),
        this.powerupConfig, this.zombies());
      events.push(...pickupEvents);
      if (pickupEvents.some(event => event.type === 'nukeDetonated')) for (const player of livingPlayers(world)) {
        events.push(...awardNukePoints(player));
      }
    }

    const navigate = this.navigationQuery();
    if (this.state.round.phase === 'spawning' && this.state.spawnDirector) {
      // Never strand a round's enemies behind unopened rooms or stair debris.
      const director = this.state.spawnDirector;
      const needsSpawn = director.spawned < director.total && director.ticksUntilNext <= 0
        && livingEntityCount(world, 'zombie') < (this.spawnConfig?.maxAlive ?? DEFAULT_SPAWN_CONFIG.maxAlive);
      // The director still ticks every fixed step. Only resolve routes when it can spawn.
      const availableSpawns = this.map.zombieSpawns.map((spawn, index) => ({ spawn, index }))
        .filter(({ spawn }) => {
          if (!needsSpawn) return true;
          const destination = spawn.barrierId
            ? this.state.barriers.find(barrier => barrier.id === spawn.barrierId)!.insidePoint : spawn;
          return !this.map.navigationGraph || livingPlayers(world).some(player => navigate(destination, player.position) !== destination);
        });
      const request = tickSpawnDirector(
        this.state.spawnDirector,
        livingEntityCount(world, 'zombie'),
        availableSpawns.map(({ spawn }) => spawn),
        world.seed,
        this.spawnConfig,
      );
      if (request) {
        const id = allocateEntityId(world);
        const source = availableSpawns[request.spawnIndex];
        const round = this.state.round.round;
        const gait = zombieGaitForRound(round, new SeededRng(world.seed ^ Math.imul(Number(id.slice(2)), 0x85ebca6b)));
        const zombie = createZombieState(id, request.position, round, gait);
        if (source.spawn.barrierId) zombie.entry = createZombieEntry(source.spawn.barrierId, this.state.spawnDirector.spawned - 1);
        addEntity(world, zombie);
        events.push({
          type: 'zombieSpawned', zombieId: id, round: this.state.round.round,
          spawnIndex: source.index,
          ...(source.spawn.barrierId ? { barrierId: source.spawn.barrierId } : {}),
        });
      }
    }

    const players = livingPlayers(world);
    const zombies = this.zombies();
    prepareBarriers(this.state.barriers, zombies);
    for (const zombie of zombies) {
      if (zombie.entry) {
        const barrier = this.state.barriers.find(barrier => barrier.id === zombie.entry!.barrierId)!;
        events.push(...updateZombieEntry(zombie, barrier, zombies, deltaSeconds, this.collisionBoxes(), world.tick));
        continue;
      }
      updateZombiePursuit(
        zombie, players, deltaSeconds, this.collisionBoxes(), this.map.walkSurfaces,
        this.map.navigationGraph,
        navigate,
      );
      events.push(...tickZombieMelee(zombie, players, this.collisionBoxes()));
    }
    // Repair resolves after entry decisions, so rebuilding cannot trap an active vault.
    const repairEvents = repairBarriers(this.state.barriers, repairers);
    events.push(...repairEvents);
    for (const event of repairEvents) if (event.type === 'barrierBoardRepaired') {
      const player = this.getPlayer(event.playerId);
      if (player) events.push(...awardRepairPoints(player, this.state.round.round,
        this.state.powerups.doublePointsTicksRemaining > 0 ? 2 : 1));
    }
    syncBarrierInteractables(this.state.barriers, this.interactables());

    const roundEvents = updateRoundState(this.state.round, {
      livingPlayers: livingPlayers(world).length,
      zombiesAlive: livingEntityCount(world, 'zombie'),
      spawnsRemaining: remainingSpawns(this.state.spawnDirector),
    }, this.roundConfig);
    events.push(...roundEvents);

    for (const event of roundEvents) {
      if (event.to === 'spawning') {
        this.state.spawnDirector = createSpawnDirector(event.round, this.spawnConfig, this.playerIds.length);
        for (const player of livingPlayers(world)) player.grenadeCharges = GRENADE_RULES.maximum;
      }
    }
    for (const event of events) if (event.type === 'zombieDied') {
      const killer = this.getPlayer(event.playerId);
      if (!killer) continue;
      killer.kills += 1;
      if (event.method === 'head') killer.headshots += 1;
    }
    // Keep the body through its death animation, then reclaim authoritative state.
    for (const entity of Object.values(world.entities)) if (entity.kind === 'zombie' && !entity.alive) {
      entity.deadTicks += 1;
      if (entity.deadTicks >= 300) removeEntity(world, entity.id);
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
