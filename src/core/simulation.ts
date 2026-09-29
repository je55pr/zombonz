import type { CollisionBox, WalkSurface } from './collision.ts';
import { createBarrier, createZombieEntry, prepareBarriers, updateZombieEntry,
  repairBarriers, syncBarrierInteractables, type BarrierDefinition, type BarrierState, type BarrierEvent } from './barrier.ts';
import { createMysteryBox, mysteryBoxBlocker, tickMysteryBoxes, useMysteryBox, mysteryBoxPrompt,
  type MysteryBoxDefinition, type MysteryBoxState, type MysteryBoxEvent } from './mysteryBox.ts';
import {
  activatePower, closedDoorBlockers, createDoorInteractable, createDoorState, createPowerSwitchInteractable, handleDoorInteraction,
  type DoorDefinition, type DoorEvent, type DoorState, type PowerEvent, type PowerSwitchDefinition,
} from './door.ts';
import { buyPerk, createPerkMachine, syncPerkInteractables,
  type PerkEvent, type PerkMachineDefinition, type PerkMachineState } from './perks.ts';
import { activateTrap, createTrap, syncTrapInteractables, tickTraps,
  type TrapDefinition, type TrapEvent, type TrapState } from './traps.ts';
import {
  DEFAULT_ECONOMY_CONFIG, awardCombatPoints, awardRepairPoints, awardNukePoints, awardCarpenterPoints,
  type EconomyConfig, type EconomyEvent,
} from './economy.ts';
import { PLAYER_HEALTH, livingEntityCount, livingPlayers, tickPlayerRecovery, type DamageEvent } from './health.ts';
import { DOWN_RULES, armDowned, bleedOut, reviveTarget, tickDowns, type DownEvent } from './downs.ts';
import { createInputFrame, type InputFrame } from './input.ts';
import { GRENADE_RULES, createGrenadePool, placeMine, tickGrenades, tickMines, throwGrenade,
  type GrenadeEvent, type GrenadePool } from './grenade.ts';
import { createHazard, hazardSolids, hazardTargets, hazardWrecks, tickHazards,
  type HazardDefinition, type HazardEvent, type HazardState } from './hazard.ts';
import { createEquipmentInteractable, createEquipmentState, handleEquipmentInteraction,
  type EquipmentBuyDefinition, type EquipmentBuyState, type EquipmentEvent } from './equipment.ts';
import { collectPowerups, createPowerupState, startPowerupRound, tickPowerupLifetime, tryDropPowerup, updatePowerupThreshold,
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
  createZombieState, tickWindowAttack, tickZombieMelee, updateZombiePursuit, zombieGaitForRound,
  type ZombieAttackEvent,
} from './zombie.ts';
import {
  beginReload, createWeaponState, firePlayerWeapon, meleeAttack, rayFromPlayer, tickWeaponState, wantsToFire, switchWeapon,
  type WeaponEvent,
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
  /** A map with a power switch starts with the power off. */
  powerSwitch?: PowerSwitchDefinition;
  perkMachines?: readonly PerkMachineDefinition[];
  traps?: readonly TrapDefinition[];
  /** Barrels and vehicles that explode when shot; their bodies collide until they go off. */
  hazards?: readonly HazardDefinition[];
  /** Equipment (Bouncing Betties) sold from the wall. */
  equipment?: readonly EquipmentBuyDefinition[];
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
  /** Always on for maps without a switch. */
  power: { on: boolean };
  perkMachines: PerkMachineState[];
  traps: TrapState[];
  /** One per map hazard, in the map's order. */
  hazards: HazardState[];
  equipment: EquipmentBuyState[];
  /** Players who left a co-op match: out for good, even across restarts. */
  leftPlayers: EntityId[];
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

export type SimulationEvent = RoundEvent | ZombieSpawnedEvent | ZombieAttackEvent | DamageEvent | WeaponEvent | EconomyEvent | InteractionEvent | DoorEvent | WallWeaponEvent | MysteryBoxEvent | BarrierEvent | PowerupEvent | GrenadeEvent | MatchRestartedEvent
  | PowerEvent | PerkEvent | TrapEvent | DownEvent | HazardEvent | EquipmentEvent;
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
    // Allocated last, so maps without them keep their entity ids.
    if (this.map.powerSwitch) addEntity(world, createPowerSwitchInteractable(allocateEntityId(world), this.map.powerSwitch));
    const perkMachines: PerkMachineState[] = [];
    for (const definition of this.map.perkMachines ?? []) {
      const machine = createPerkMachine(definition, allocateEntityId(world));
      perkMachines.push(machine.state); addEntity(world, machine.interactable);
    }
    const traps: TrapState[] = [];
    for (const definition of this.map.traps ?? []) {
      const trap = createTrap(definition, allocateEntityId(world));
      traps.push(trap.state); addEntity(world, trap.interactable);
    }
    const equipment: EquipmentBuyState[] = [];
    for (const definition of this.map.equipment ?? []) {
      const interactableId = allocateEntityId(world);
      addEntity(world, createEquipmentInteractable(interactableId, definition));
      equipment.push(createEquipmentState(definition, interactableId));
    }
    const power = { on: !this.map.powerSwitch };
    const interactables = Object.values(world.entities).filter(
      (entity): entity is InteractableState => entity.kind === 'interactable');
    syncPerkInteractables(perkMachines, interactables, power.on);
    syncTrapInteractables(traps, interactables, power.on);
    return { world, round: createRoundState(), spawnDirector: null, doors, wallWeapons, mysteryBoxes, barriers,
      powerups: createPowerupState(this.playerIds.length * this.economyConfig.startingPoints, this.powerupConfig),
      grenades: createGrenadePool(), power, perkMachines, traps, hazards: (this.map.hazards ?? []).map(createHazard),
      equipment, leftPlayers: [] };
  }

  restart(seed = nextMatchSeed(this.state.world.seed)): MatchRestartedEvent {
    const previousSeed = this.state.world.seed;
    const left = this.state.leftPlayers;
    this.state = this.createMatchState(seed);
    for (const id of left) this.removePlayer(id);
    return { type: 'matchRestarted', previousSeed, seed: this.state.world.seed };
  }

  /** Takes a player who left (a disconnected co-op peer) out of the match for good. */
  removePlayer(id: EntityId): void {
    if (!this.state.leftPlayers.includes(id)) this.state.leftPlayers.push(id);
    const player = this.getPlayer(id);
    if (player) { player.alive = false; player.downed = null; player.velocity = { x: 0, y: 0, z: 0 }; }
  }

  /**
   * Re-derives every interactable's prompt, availability and position from the rest of the state.
   * A networked client applies the host's state without the interactables, then calls this.
   */
  refreshInteractables(): void {
    const items = this.interactables();
    const byId = new Map(items.map(item => [item.id, item]));
    for (const door of this.state.doors) { const item = byId.get(door.interactableId); if (item) item.enabled = !door.open; }
    for (const box of this.state.mysteryBoxes) {
      const item = byId.get(box.interactableId);
      if (!item) continue;
      item.enabled = true; item.prompt = mysteryBoxPrompt(box);
      if (box.locations.length) item.position = { ...box.locations[box.locationIndex].position };
    }
    for (const item of items) if (item.interactionType === 'powerSwitch') item.enabled = !this.state.power.on;
    syncBarrierInteractables(this.state.barriers, items);
    syncPerkInteractables(this.state.perkMachines, items, this.state.power.on);
    syncTrapInteractables(this.state.traps, items, this.state.power.on);
  }

  getPlayer(id: EntityId): PlayerState | null {
    const entity = this.state.world.entities[id];
    return entity?.kind === 'player' ? entity : null;
  }

  /** The map's own walls, closed doors and the box: what hazards are placed against. */
  private wallBoxes(): CollisionBox[] {
    const boxes = this.state.mysteryBoxes.filter(box => box.locations.length && box.phase !== 'away')
      .map(box => mysteryBoxBlocker(box.locations[box.locationIndex]));
    return [...this.map.collisionBoxes, ...closedDoorBlockers(this.state.doors), ...boxes];
  }

  /** Everything solid to walk into: the walls, and every hazard that has not vanished. */
  collisionBoxes(): CollisionBox[] {
    return [...this.wallBoxes(), ...hazardSolids(this.map.hazards ?? [], this.state.hazards)];
  }

  /**
   * What stops a shot or a blast: the walls, upper floors and the burnt-out shells of vehicles. Whole hazards
   * are not among them (a shot hits one and a blast reaches it; see hazardTargets).
   */
  private shotBlockers(): CollisionBox[] {
    return [...this.wallBoxes(), ...hazardWrecks(this.map.hazards ?? [], this.state.hazards), ...(this.map.shotBlockers ?? [])];
  }

  /** The hazards that can be shot or hurt right now. */
  hazardTargets() { return hazardTargets(this.map.hazards ?? [], this.state.hazards); }

  /** Every player entity, dead or alive. */
  players(): PlayerState[] {
    return this.playerIds.map(id => this.getPlayer(id)).filter((player): player is PlayerState => !!player);
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
    if (player?.downed) return null;
    const downed = player ? reviveTarget(player, this.players()) : null;
    if (downed) return { interactableId: downed.id, interactionType: 'revive', actionId: `revive:${downed.id}`,
      prompt: 'Hold E to revive', distance: Math.hypot(downed.position.x - player!.position.x, downed.position.z - player!.position.z),
      facingDot: 1 };
    const candidate = player ? findInteractionCandidate(player, this.reachableInteractables(player)) : null;
    const box = this.state.mysteryBoxes.find(box => box.interactableId === candidate?.interactableId);
    return candidate && box ? { ...candidate, prompt: mysteryBoxPrompt(box, playerId) } : candidate;
  }

  private navigationQuery(): NavigationQuery {
    // Opening doors and the box moving both change what blocks the way.
    const doors = [...this.state.doors.map(door => `${door.id}:${door.open}`),
      ...this.state.mysteryBoxes.map(box => `${box.id}:${box.phase === 'away' ? -1 : box.locationIndex}`),
      ...this.state.hazards.map(hazard => `${hazard.id}:${hazard.phase === 'exploded'}`)].join('|');
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

  /**
   * After this tick's damage: hands the newly downed their pistol (and solo Quick Revive its
   * self-revive), runs revives and bleed-outs, and ends it for everyone when no one is left standing
   * to revive the downed.
   */
  private resolveDowns(revivers: ReadonlyMap<EntityId, PlayerState>): Array<DownEvent | DamageEvent> {
    const players = this.players();
    for (const player of players) {
      const pistol = createWeaponState(DOWN_RULES.pistol);
      pistol.reserveAmmo = DOWN_RULES.pistolReserve;
      if (!armDowned(player, pistol)) continue;
      if (this.playerIds.length === 1 && player.downed!.lostPerks.includes('quick-revive')
        && player.selfRevives < DOWN_RULES.soloQuickReviveLimit) {
        player.downed!.selfRevive = true;
        player.selfRevives += 1;
      }
    }
    const events: Array<DownEvent | DamageEvent> = tickDowns(players, revivers, PLAYER_HEALTH.maximum);
    const hope = players.some(player => player.alive && (!player.downed || player.downed.selfRevive));
    if (!hope) for (const player of players) if (player.alive && player.downed) {
      bleedOut(player);
      events.push({ type: 'playerDied', playerId: player.id, amount: 0, health: 0 });
    }
    return events;
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
    events.push(...tickMysteryBoxes(this.state.mysteryBoxes, this.interactables(), livingPlayers(world), world.seed ^ world.tick));
    const repairers = new Map<string, EntityId>();

    const playerFrames = new Map<EntityId, InputFrame>();
    /** Downed players, and the teammate holding use beside each this tick. */
    const revivers = new Map<EntityId, PlayerState>();
    for (const player of livingPlayers(world)) {
      events.push(...tickPlayerRecovery(player));
      if (player.meleeCooldownTicks > 0) player.meleeCooldownTicks -= 1;
      const frame = inputs[player.id] ?? createInputFrame(world.tick);
      playerFrames.set(player.id, frame);
      if (player.downed) {
        // In last stand a player can look around, shoot and reload the pistol, and nothing else.
        player.yaw += frame.look.yaw;
        player.pitch = Math.max(-PLAYER_MOVEMENT.maxPitch, Math.min(PLAYER_MOVEMENT.maxPitch, player.pitch + frame.look.pitch));
        events.push(...tickWeaponState(player));
        if (frame.actions.reload?.pressed) events.push(...beginReload(player));
        continue;
      }
      updatePlayerMovement(player, frame, deltaSeconds, this.collisionBoxes(), this.map.walkSurfaces,
        [...this.collisionBoxes(), ...(this.map.shotBlockers ?? [])]);
      events.push(...tickWeaponState(player));
      if (frame.actions.switchWeapon?.pressed) events.push(...switchWeapon(player));
      if (frame.actions.reload?.pressed) events.push(...beginReload(player));
      if (frame.actions.throwGrenade?.pressed) events.push(...throwGrenade(this.state.grenades, player));
      if (frame.actions.placeMine?.pressed) events.push(...placeMine(this.state.grenades, player, this.shotBlockers(), this.map.walkSurfaces));
      // Holding use beside a downed teammate revives them, ahead of anything else in reach.
      const downedTeammate = frame.actions.interact?.held ? reviveTarget(player, this.players()) : null;
      if (downedTeammate) {
        if (!revivers.has(downedTeammate.id)) revivers.set(downedTeammate.id, player);
        continue;
      }
      if (frame.actions.interact?.held) {
        const candidate = findInteractionCandidate(player, this.reachableInteractables(player));
        const barrier = this.state.barriers.find(barrier => barrier.interactableId === candidate?.interactableId);
        if (barrier && !repairers.has(barrier.id)) repairers.set(barrier.id, player.id);
      }
      if (frame.actions.interact?.pressed) {
        const interactionEvents = triggerInteraction(player, this.reachableInteractables(player), true);
        events.push(...interactionEvents);
        for (const interaction of interactionEvents) {
          // Solo Quick Revive sells only as many times as it can be used, as in Black Ops.
          const machine = this.state.perkMachines.find(entry => entry.interactableId === interaction.interactableId);
          if (machine?.perk === 'quick-revive' && this.playerIds.length === 1
            && player.selfRevives >= DOWN_RULES.soloQuickReviveLimit) continue;
          events.push(...handleDoorInteraction(player, interaction, this.state.doors, this.interactables()));
          events.push(...handleWallWeaponInteraction(player, interaction, this.state.wallWeapons));
          events.push(...useMysteryBox(player, interaction, this.state.mysteryBoxes, world.seed));
          events.push(...activatePower(player, interaction, this.state.power, this.state.doors, this.interactables()));
          events.push(...buyPerk(player, interaction, this.state.perkMachines, this.state.power.on));
          events.push(...activateTrap(player, interaction, this.state.traps, this.state.power.on));
          events.push(...handleEquipmentInteraction(player, interaction, this.state.equipment));
        }
      }
    }

    for (const player of livingPlayers(world)) {
      const frame = playerFrames.get(player.id)!;
      if (frame.actions.melee?.pressed && !player.downed) {
        const meleeEvents = meleeAttack(player, this.zombies(), this.shotBlockers(),
          this.state.powerups.instaKillTicksRemaining > 0);
        events.push(...meleeEvents, ...awardCombatPoints(player, meleeEvents, this.economyConfig,
          this.state.powerups.doublePointsTicksRemaining > 0 ? 2 : 1));
      }
      const fire = frame.actions.fire;
      if (!wantsToFire(player, fire?.pressed ?? false, fire?.held ?? false)) continue;
      const weaponEvents = firePlayerWeapon(
        player, rayFromPlayer(player, player.downed ? DOWN_RULES.eyeHeight : PLAYER_MOVEMENT.eyeHeight), this.zombies(),
        this.shotBlockers(),
        this.state.powerups.instaKillTicksRemaining > 0,
        world.seed ^ world.tick,
        this.hazardTargets(),
      );
      events.push(...weaponEvents);
      events.push(...awardCombatPoints(player, weaponEvents, this.economyConfig,
        this.state.powerups.doublePointsTicksRemaining > 0 ? 2 : 1));
    }

    // Everything that goes bang this tick: grenades, Bouncing Betties, then burning barrels and vehicles.
    const instaKill = this.state.powerups.instaKillTicksRemaining > 0;
    const blastEvents: SimulationEvent[] = [];
    const burning = this.state.hazards.some(hazard => hazard.phase === 'burning');
    if (this.state.grenades.active.length || this.state.grenades.mines.length || burning) {
      const walls = this.shotBlockers(), targets = this.hazardTargets();
      if (this.state.grenades.active.length) blastEvents.push(...tickGrenades(this.state.grenades, this.zombies(), livingPlayers(world),
        walls, this.map.walkSurfaces, deltaSeconds, instaKill, targets));
      if (this.state.grenades.mines.length) blastEvents.push(...tickMines(this.state.grenades, this.zombies(), livingPlayers(world),
        walls, instaKill, targets));
      if (burning) blastEvents.push(...tickHazards(this.map.hazards ?? [], this.state.hazards,
        { zombies: this.zombies(), players: livingPlayers(world), boxes: walls, instaKill }));
      events.push(...blastEvents);
      const blastCombat = blastEvents.filter((event): event is WeaponEvent =>
        event.type === 'grenadeHit' || event.type === 'zombieDamaged' || event.type === 'zombieDied');
      if (blastCombat.length) for (const player of livingPlayers(world)) events.push(...awardCombatPoints(player,
        blastCombat, this.economyConfig, this.state.powerups.doublePointsTicksRemaining > 0 ? 2 : 1));
    }

    updatePowerupThreshold(this.state.powerups, this.playerIds.map(id => this.getPlayer(id)!), this.powerupConfig);
    for (const event of events) if (event.type === 'zombieDied') {
      const zombie = world.entities[event.zombieId];
      if (zombie?.kind === 'zombie') events.push(...tryDropPowerup(this.state.powerups, zombie,
        this.state.barriers, world.seed, world.tick, this.powerupConfig));
    }
    if (this.state.powerups.drops.length) {
      const pickupEvents = collectPowerups(this.state.powerups, livingPlayers(world), this.collisionBoxes(),
        this.powerupConfig, this.zombies(), this.state.barriers);
      events.push(...pickupEvents);
      if (pickupEvents.some(event => event.type === 'carpenterRepaired')) for (const player of livingPlayers(world)) {
        events.push(...awardCarpenterPoints(player));
      }
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
        const swipe = tickWindowAttack(zombie, barrier, players);
        events.push(...swipe.events);
        if (!swipe.engaged) {
          events.push(...updateZombieEntry(zombie, barrier, zombies, deltaSeconds, this.collisionBoxes(), world.tick, world.seed));
        }
        continue;
      }
      updateZombiePursuit(
        zombie, players, deltaSeconds, this.collisionBoxes(), this.map.walkSurfaces,
        this.map.navigationGraph,
        navigate,
      );
      events.push(...tickZombieMelee(zombie, players, this.collisionBoxes()));
    }
    if (this.state.traps.length) {
      events.push(...tickTraps(this.state.traps, this.zombies(), livingPlayers(world), world.tick));
      syncTrapInteractables(this.state.traps, this.interactables(), this.state.power.on);
    }
    if (this.state.perkMachines.length) syncPerkInteractables(this.state.perkMachines, this.interactables(), this.state.power.on);
    // Repair resolves after entry decisions, so rebuilding cannot trap an active vault.
    const repairEvents = repairBarriers(this.state.barriers, repairers, world.seed, world.tick);
    events.push(...repairEvents);
    for (const event of repairEvents) if (event.type === 'barrierBoardRepaired') {
      const player = this.getPlayer(event.playerId);
      if (player) events.push(...awardRepairPoints(player, this.state.round.round,
        this.state.powerups.doublePointsTicksRemaining > 0 ? 2 : 1, this.economyConfig));
    }
    syncBarrierInteractables(this.state.barriers, this.interactables());

    events.push(...this.resolveDowns(revivers));

    const roundEvents = updateRoundState(this.state.round, {
      livingPlayers: livingPlayers(world).length,
      zombiesAlive: livingEntityCount(world, 'zombie'),
      spawnsRemaining: remainingSpawns(this.state.spawnDirector),
    }, this.roundConfig);
    events.push(...roundEvents);

    for (const event of roundEvents) {
      if (event.to === 'spawning') {
        this.state.spawnDirector = createSpawnDirector(event.round, this.spawnConfig, this.playerIds.length);
        startPowerupRound(this.state.powerups);
        if (event.round > 1) for (const player of livingPlayers(world)) {
          player.grenadeCharges = Math.min(GRENADE_RULES.maximum, player.grenadeCharges + GRENADE_RULES.perRound);
        }
        // Players who bled out come back at the start of the next round, as in World at War co-op.
        this.playerIds.forEach((id, index) => {
          const player = this.getPlayer(id);
          if (!player || player.alive || this.state.leftPlayers.includes(id)) return;
          const fresh = createPlayerState(id, this.playerSpawns[index] ?? this.playerSpawns[0], player.points);
          Object.assign(player, { ...fresh, pointsEarned: player.pointsEarned, kills: player.kills, headshots: player.headshots,
            selfRevives: player.selfRevives, godMode: player.godMode });
          events.push({ type: 'playerRespawned', playerId: id });
        });
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
