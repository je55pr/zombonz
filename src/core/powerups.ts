import { restoreBarrier, type BarrierState } from './barrier.ts';
import type { CollisionBox } from './collision.ts';
import { GRENADE_RULES } from './grenade.ts';
import { SeededRng } from './rng.ts';
import type { EntityId, PlayerState, Vec3, ZombieState } from './types.ts';
import { weaponDefinition } from './weapon.ts';
import { rayAabbDistance } from './weapon.ts';

export type PowerupKind = 'maxAmmo' | 'doublePoints' | 'instaKill' | 'nuke' | 'carpenter';

export interface PowerupDrop {
  id: string;
  kind: PowerupKind;
  position: Vec3;
  ticksRemaining: number;
}

export interface PowerupState {
  drops: PowerupDrop[];
  nextId: number;
  dropsThisRound: number;
  /** Team points earned (starting points included) that arm the next guaranteed drop. */
  scoreToDrop: number;
  dropIncrement: number;
  dropArmed: boolean;
  /** Shuffled deck: every kind drops once before any repeats. */
  cycle: PowerupKind[];
  cycleIndex: number;
  cyclesDealt: number;
  doublePointsTicksRemaining: number;
  instaKillTicksRemaining: number;
}

export interface PowerupConfig {
  /** Chance, out of 100, that any kill drops even before the points threshold is reached. */
  randomDropPercent: number;
  scoreDropIncrement: number;
  scoreDropGrowth: number;
  maxDropsPerRound: number;
  lifetimeTicks: number;
  pickupRadius: number;
  kinds: readonly PowerupKind[];
  doublePointsDurationTicks: number;
  instaKillDurationTicks: number;
  /**
   * A Carpenter only drops once this many barriers have lost every board (or all of them, on a map
   * with fewer), so it never arrives with nothing to rebuild.
   */
  carpenterMinBroken: number;
}

/** WaW/BO1 drop rules: 2000-point threshold growing 14% per drop, 3% per-kill luck, four per round. */
export const DEFAULT_POWERUP_CONFIG: Readonly<PowerupConfig> = {
  randomDropPercent: 3,
  scoreDropIncrement: 2000,
  scoreDropGrowth: 1.14,
  maxDropsPerRound: 4,
  // Fifteen seconds solid, then about eleven and a half seconds of blinking.
  lifetimeTicks: 1590,
  pickupRadius: 1.25,
  kinds: ['maxAmmo', 'doublePoints', 'instaKill', 'nuke', 'carpenter'],
  doublePointsDurationTicks: 1800,
  instaKillDurationTicks: 1800,
  carpenterMinBroken: 5,
};

export type PowerupEvent =
  | { type: 'powerupSpawned'; dropId: string; kind: PowerupKind; position: Vec3 }
  | { type: 'powerupCollected'; dropId: string; kind: PowerupKind; playerId: EntityId }
  | { type: 'nukeDetonated'; dropId: string; killed: number }
  /** Every damaged barrier was rebuilt to full; `repaired` is how many needed it. */
  | { type: 'carpenterRepaired'; dropId: string; repaired: number }
  | { type: 'powerupExpired'; dropId: string; kind: PowerupKind };

/** `teamStartingScore` is every player's starting points combined. */
export function createPowerupState(teamStartingScore = 0,
  config: PowerupConfig = DEFAULT_POWERUP_CONFIG): PowerupState {
  return { drops: [], nextId: 1, dropsThisRound: 0,
    scoreToDrop: teamStartingScore + config.scoreDropIncrement, dropIncrement: config.scoreDropIncrement,
    dropArmed: false, cycle: [], cycleIndex: 0, cyclesDealt: 0,
    doublePointsTicksRemaining: 0, instaKillTicksRemaining: 0 };
}

export function startPowerupRound(state: PowerupState): void {
  state.dropsThisRound = 0;
}

/** Arms a guaranteed drop each time the team's total earned points pass the moving threshold. */
export function updatePowerupThreshold(state: PowerupState, players: readonly PlayerState[],
  config: PowerupConfig = DEFAULT_POWERUP_CONFIG): void {
  const earned = players.reduce((total, player) => total + player.pointsEarned, 0);
  if (earned <= state.scoreToDrop) return;
  state.dropIncrement *= config.scoreDropGrowth;
  state.scoreToDrop = earned + state.dropIncrement;
  state.dropArmed = true;
}

export function tickPowerupLifetime(state: PowerupState): PowerupEvent[] {
  const events: PowerupEvent[] = [];
  if (state.doublePointsTicksRemaining > 0) state.doublePointsTicksRemaining -= 1;
  if (state.instaKillTicksRemaining > 0) state.instaKillTicksRemaining -= 1;
  for (const drop of state.drops) {
    drop.ticksRemaining -= 1;
    if (drop.ticksRemaining <= 0) events.push({ type: 'powerupExpired', dropId: drop.id, kind: drop.kind });
  }
  state.drops = state.drops.filter(drop => drop.ticksRemaining > 0);
  return events;
}

/** Barriers with no boards left at all (an open climb has none to lose, so never counts). */
function brokenBarrierCount(barriers: readonly BarrierState[]): number {
  return barriers.filter(barrier => barrier.maxBoards > 0 && barrier.boards === 0).length;
}

function carpenterNeeded(barriers: readonly BarrierState[], config: PowerupConfig): boolean {
  const boarded = barriers.filter(barrier => barrier.maxBoards > 0).length;
  const needed = Math.min(config.carpenterMinBroken, boarded);
  return needed > 0 && brokenBarrierCount(barriers) >= needed;
}

/**
 * Deals from the shuffled deck. A kind that cannot drop right now (a Carpenter with nothing to
 * rebuild) is passed over and its turn spent, as in Black Ops. Null when nothing in the deck can drop.
 */
function nextPowerupKind(state: PowerupState, config: PowerupConfig, worldSeed: number,
  barriers: readonly BarrierState[]): PowerupKind | null {
  for (let dealt = 0; dealt <= config.kinds.length; dealt += 1) {
    if (state.cycleIndex >= state.cycle.length) {
      const deck = [...config.kinds];
      const rng = new SeededRng(worldSeed ^ Math.imul(state.cyclesDealt + 1, 0x27d4eb2f));
      for (let i = deck.length - 1; i > 0; i -= 1) {
        const j = rng.int(0, i + 1);
        [deck[i], deck[j]] = [deck[j], deck[i]];
      }
      state.cycle = deck; state.cycleIndex = 0; state.cyclesDealt += 1;
    }
    const kind = state.cycle[state.cycleIndex++];
    if (kind !== 'carpenter' || carpenterNeeded(barriers, config)) return kind;
  }
  return null;
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
  if (state.dropsThisRound >= config.maxDropsPerRound || !config.kinds.length) return [];
  const zombieNumber = Number(zombie.id.slice(2));
  const rng = new SeededRng(worldSeed ^ Math.imul(zombieNumber, 0x9e3779b9) ^ tick);
  const lucky = rng.int(0, 100) < config.randomDropPercent;
  if (!lucky && !state.dropArmed) return [];
  const kind = nextPowerupKind(state, config, worldSeed, barriers);
  if (!kind) return [];
  state.dropArmed = false;
  state.dropsThisRound += 1;
  // Zombies shot before entering would otherwise drop an unreachable reward outdoors.
  const entrance = zombie.entry && barriers.find(barrier => barrier.id === zombie.entry!.barrierId);
  const position = { ...(entrance ? entrance.insidePoint : zombie.position) };
  const drop: PowerupDrop = { id: `p:${state.nextId++}`, kind, position,
    ticksRemaining: config.lifetimeTicks };
  state.drops.push(drop);
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
  player.grenadeCharges = GRENADE_RULES.maximum;
  for (const weapon of [player.weapon, player.holsteredWeapon]) {
    if (!weapon) continue;
    const definition = weaponDefinition(weapon.weaponId);
    if (definition) weapon.reserveAmmo = Math.max(weapon.reserveAmmo, definition.startingReserveAmmo);
  }
}

/** Stable player/drop ordering gives a single collector even in overlapping co-op pickups. */
export function collectPowerups(
  state: PowerupState,
  players: readonly PlayerState[],
  boxes: readonly CollisionBox[],
  config: PowerupConfig = DEFAULT_POWERUP_CONFIG,
  zombies: readonly ZombieState[] = [],
  barriers: readonly BarrierState[] = [],
): PowerupEvent[] {
  const events: PowerupEvent[] = [];
  const living = players.filter(player => player.alive).sort((a, b) => a.id.localeCompare(b.id));
  for (const drop of state.drops) {
    const collector = living.find(player => Math.hypot(player.position.x - drop.position.x,
      player.position.z - drop.position.z) <= config.pickupRadius
      && Math.abs(player.position.y - drop.position.y) <= 1.5 && unobstructed(player, drop, boxes));
    if (!collector) continue;
    if (drop.kind === 'maxAmmo') for (const player of living) refillAmmo(player);
    if (drop.kind === 'doublePoints') state.doublePointsTicksRemaining = config.doublePointsDurationTicks;
    if (drop.kind === 'instaKill') state.instaKillTicksRemaining = config.instaKillDurationTicks;
    if (drop.kind === 'nuke') {
      let killed = 0;
      for (const zombie of zombies) if (zombie.alive) {
        zombie.alive = false; zombie.health = 0; zombie.velocity = { x: 0, y: 0, z: 0 };
        killed += 1;
      }
      events.push({ type: 'nukeDetonated', dropId: drop.id, killed });
    }
    if (drop.kind === 'carpenter') {
      let repaired = 0;
      for (const barrier of barriers) if (barrier.boards < barrier.maxBoards) {
        restoreBarrier(barrier);
        repaired += 1;
      }
      events.push({ type: 'carpenterRepaired', dropId: drop.id, repaired });
    }
    events.push({ type: 'powerupCollected', dropId: drop.id, kind: drop.kind, playerId: collector.id });
  }
  const collected = new Set(events.map(event => event.dropId));
  state.drops = state.drops.filter(drop => !collected.has(drop.id));
  return events;
}
