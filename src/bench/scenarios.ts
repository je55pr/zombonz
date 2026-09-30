import {
  GameSimulation, SIMULATION_STAGES, SimulationProbe, addEntity, allocateEntityId, createZombieState, distribution,
  readWork, shortestNavigationPath, type Distribution, type EntityId, type SimulationStage, type StageTimes, type Vec3,
  type WorkCounter, type WorkCounters, type ZombieState,
} from '../core/index.ts';
import { ASYLUM_MAP } from '../maps/asylum.ts';
import { BUNKER_MAP } from '../maps/bunker.ts';
import type { GameMap } from '../maps/gameMap.ts';
import { simulationMap } from '../maps/match.ts';

/**
 * Reproducible stress runs for the simulation, used by `npm run benchmark` (wall-clock times) and by the tests
 * (the work counters, which do not depend on the machine). Everything is seeded and scripted, so two runs do the
 * same work tick for tick.
 */

export interface StallReport {
  /** Zombie-seconds spent on the spot, out of reach of the player, while trying to move and not swinging. */
  stalledSeconds: number;
  /** The longest unbroken run of such seconds by any one zombie. */
  longestSeconds: number;
  /** Zombies still stalled at the end for at least `STUCK_SECONDS`. */
  stuckZombies: number;
}

export interface BenchmarkResult {
  scenario: string;
  ticks: number;
  zombies: number;
  /** Whole-tick wall time, and each stage's share of it, in milliseconds. */
  tickMs: Distribution;
  stageMs: Record<SimulationStage, Distribution>;
  /** The slowest tick, with what it spent its time on and what work it did. */
  worst: { tick: number; ms: number; stage: SimulationStage; stages: StageTimes; work: WorkCounters };
  /** Work per tick on average, and the most any one tick did. */
  workPerTick: WorkCounters;
  workMax: WorkCounters;
  stalls: StallReport;
  /** Player laps of the route completed (training runs). */
  laps: number;
}

/** A zombie that has not gone anywhere for this long, while wanting to, is stuck. */
export const STUCK_SECONDS = 5;

// ---- routes -------------------------------------------------------------------------------------------------------

/** Named navigation nodes, in order, of a lap of Asylum with the power on: German stair, power room, American stair. */
export const ASYLUM_TRAIN_LAP = ['spawn', 'german-stair-foot', 'german-stair-head', 'left-upstairs-1', 'left-upstairs--1',
  'power-west--1', 'power-west-1', 'power-east--1', 'power-east-1', 'kitchen--1', 'kitchen-1', 'right-upstairs--1',
  'right-upstairs-1', 'american-stair-head', 'american-stair-foot', 'american-hallway-1', 'american-hallway--1',
  'start-gate-1', 'start-gate--1', 'spawn'] as const;

/** The points of a route through the map's navigation graph, visiting the named nodes in turn. */
export function routeThrough(map: GameMap, ids: readonly string[]): Vec3[] {
  const points: Vec3[] = [];
  for (let i = 1; i < ids.length; i++) {
    const path = shortestNavigationPath(map.navigation, ids[i - 1], ids[i]);
    if (!path.length) throw new Error(`No route from ${ids[i - 1]} to ${ids[i]}`);
    for (const node of path.slice(i === 1 ? 0 : 1)) points.push({ ...node.position });
  }
  return points;
}

/** Walks a closed route at a steady pace: where the runner is after each step. */
export class RouteRunner {
  private index = 0;
  private along = 0;
  laps = 0;
  constructor(private readonly points: readonly Vec3[], private readonly metresPerStep: number) {}

  step(): Vec3 {
    this.along += this.metresPerStep;
    for (;;) {
      const a = this.points[this.index], b = this.points[(this.index + 1) % this.points.length];
      const length = Math.hypot(b.x - a.x, b.z - a.z);
      if (this.along < length) break;
      this.along -= length;
      this.index = (this.index + 1) % this.points.length;
      if (this.index === 0) this.laps += 1;
    }
    const a = this.points[this.index], b = this.points[(this.index + 1) % this.points.length];
    const t = this.along / (Math.hypot(b.x - a.x, b.z - a.z) || 1);
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
  }
}

// ---- measuring ----------------------------------------------------------------------------------------------------

/** Watches every zombie's progress once a second, from positions alone, so it judges any implementation alike. */
class StallWatch {
  private readonly last = new Map<EntityId, { x: number; z: number; run: number }>();
  stalledSeconds = 0;
  longestSeconds = 0;

  check(zombies: readonly ZombieState[], player: Vec3): void {
    for (const zombie of zombies) {
      const before = this.last.get(zombie.id);
      const moved = before ? Math.hypot(zombie.position.x - before.x, zombie.position.z - before.z) : Infinity;
      const far = Math.hypot(player.x - zombie.position.x, player.z - zombie.position.z) > 4;
      const wanting = Math.hypot(zombie.velocity.x, zombie.velocity.z) > 0;
      const stalled = before !== undefined && moved < 0.4 && far && wanting && zombie.attackTicks === 0 && !zombie.entry;
      const run = stalled ? before!.run + 1 : 0;
      if (stalled) this.stalledSeconds += 1;
      this.longestSeconds = Math.max(this.longestSeconds, run);
      this.last.set(zombie.id, { x: zombie.position.x, z: zombie.position.z, run });
    }
  }

  report(zombies: readonly ZombieState[]): StallReport {
    return { stalledSeconds: this.stalledSeconds, longestSeconds: this.longestSeconds,
      stuckZombies: zombies.filter(zombie => (this.last.get(zombie.id)?.run ?? 0) >= STUCK_SECONDS).length };
  }
}

const COUNTER_KEYS = Object.keys(readWork()) as WorkCounter[];

/** Collects a run's per-tick measurements from the simulation's probe. */
class Recorder {
  readonly probe = new SimulationProbe(() => performance.now());
  private readonly ticks: number[] = [];
  private readonly stages = Object.fromEntries(SIMULATION_STAGES.map(stage => [stage, [] as number[]])) as Record<SimulationStage, number[]>;
  private readonly totals = readWork();
  private readonly maxima = readWork();
  private worst: BenchmarkResult['worst'] | null = null;

  constructor(sim: GameSimulation) {
    for (const key of COUNTER_KEYS) this.totals[key] = this.maxima[key] = 0;
    sim.probe = this.probe;
  }

  record(tick: number): void {
    const { probe } = this;
    this.ticks.push(probe.tickMs);
    for (const stage of SIMULATION_STAGES) this.stages[stage].push(probe.stages[stage]);
    for (const key of COUNTER_KEYS) {
      this.totals[key] += probe.work[key];
      this.maxima[key] = Math.max(this.maxima[key], probe.work[key]);
    }
    if (!this.worst || probe.tickMs > this.worst.ms) {
      const stage = SIMULATION_STAGES.reduce((best, name) => probe.stages[name] > probe.stages[best] ? name : best);
      this.worst = { tick, ms: probe.tickMs, stage, stages: { ...probe.stages }, work: { ...probe.work } };
    }
  }

  result(scenario: string, zombies: number, stalls: StallReport, laps: number): BenchmarkResult {
    const perTick = readWork();
    for (const key of COUNTER_KEYS) perTick[key] = this.totals[key] / Math.max(1, this.ticks.length);
    return { scenario, ticks: this.ticks.length, zombies, tickMs: distribution(this.ticks),
      stageMs: Object.fromEntries(SIMULATION_STAGES.map(stage => [stage, distribution(this.stages[stage])])) as Record<SimulationStage, Distribution>,
      worst: this.worst!, workPerTick: perTick, workMax: this.maxima, stalls, laps };
  }
}

// ---- scenarios ----------------------------------------------------------------------------------------------------

export interface TrainingOptions {
  /** How many zombies chase (default 24, the most the game keeps alive). */
  zombies?: number;
  /** Simulation ticks to run (default: one lap and a bit). */
  ticks?: number;
  /** Ticks to leave out of the timings while everything warms up (default 60). */
  warmup?: number;
  /** The player's pace in metres per second (default: walking, 4.2, a hair faster than a sprinter). */
  pace?: number;
}

/** Doors open as the player comes within this far of them, as they would when bought. */
const UNLOCK_RANGE = 3.5;

/**
 * The player trains a horde round Asylum: out of the German start, up its stair, along the upstairs rooms, down the
 * American stair, through the hallway and back, with each door opening as the player reaches it. Two thirds of the
 * zombies run and a third sprint, and they begin in the open a few metres behind.
 */
export function runAsylumTraining(options: TrainingOptions = {}): BenchmarkResult {
  const map = ASYLUM_MAP, count = options.zombies ?? 24, pace = (options.pace ?? 4.2) / 60;
  const route = routeThrough(map, ASYLUM_TRAIN_LAP);
  const sim = new GameSimulation({ seed: 1, map: { ...simulationMap(map), zombieSpawns: [] }, playerSpawns: [map.playerSpawn],
    roundConfig: { initialWaitTicks: 2147483647, intermissionTicks: 2147483647 } });
  const player = sim.getPlayer(sim.playerIds[0])!;
  player.godMode = true;
  sim.state.power.on = true;
  const spawnPoint = map.playerSpawn;
  const horde = map.navigation.nodes.filter(node => node.position.y === 0
    && Math.hypot(node.position.x - spawnPoint.x, node.position.z - spawnPoint.z) > 4)
    .sort((a, b) => Math.hypot(a.position.x + 8, a.position.z - 8) - Math.hypot(b.position.x + 8, b.position.z - 8)
      || a.id.localeCompare(b.id)).slice(0, count);
  horde.forEach((node, index) => addEntity(sim.state.world, createZombieState(allocateEntityId(sim.state.world),
    { ...node.position }, 15, index % 3 === 0 ? 'sprint' : 'run')));

  const doorAt = new Map(map.doors.map(door => [door.id, door.position]));
  const runner = new RouteRunner(route, pace);
  const ticks = options.ticks ?? 3300, warmup = options.warmup ?? 60;
  const recorder = new Recorder(sim), watch = new StallWatch();
  for (let tick = 0; tick < ticks; tick++) {
    player.position = runner.step();
    for (const door of sim.state.doors) {
      const at = doorAt.get(door.id)!;
      if (!door.open && Math.abs(at.y - player.position.y) < 2.5
        && Math.hypot(at.x - player.position.x, at.z - player.position.z) < UNLOCK_RANGE) door.open = true;
    }
    sim.tick();
    if (tick >= warmup) recorder.record(tick);
    if (tick % 60 === 59) watch.check(sim.zombies(), player.position);
  }
  return recorder.result(`Asylum: ${count} zombies train round the power side`, count, watch.report(sim.zombies()), runner.laps);
}

export interface WaveOptions { ticks?: number; warmup?: number; maxAlive?: number }

/**
 * A round's worth of spawning at the start: the player stands in the German start room while zombies keep coming in
 * at the windows, and the oldest is shot every second so a new one is always wanted. This is where the spawn
 * director's route checks and the windows' logic get their turn.
 */
export function runAsylumWave(options: WaveOptions = {}): BenchmarkResult {
  const map = ASYLUM_MAP, maxAlive = options.maxAlive ?? 24;
  const sim = new GameSimulation({ seed: 7, map: simulationMap(map), playerSpawns: [map.playerSpawn],
    roundConfig: { initialWaitTicks: 1, intermissionTicks: 600 },
    spawnConfig: { baseZombieCount: 100_000, additionalPerRound: 0, spawnIntervalTicks: 6, maxAlive } });
  const player = sim.getPlayer(sim.playerIds[0])!;
  player.godMode = true;
  const ticks = options.ticks ?? 3600, warmup = options.warmup ?? 60;
  const recorder = new Recorder(sim), watch = new StallWatch();
  for (let tick = 0; tick < ticks; tick++) {
    if (tick % 60 === 30) {
      const oldest = sim.zombies().sort((a, b) => Number(a.id.slice(2)) - Number(b.id.slice(2)))[0];
      if (oldest) { oldest.health = 0; oldest.alive = false; }
    }
    sim.tick();
    if (tick >= warmup) recorder.record(tick);
    if (tick % 60 === 59) watch.check(sim.zombies(), player.position);
  }
  return recorder.result(`Asylum: spawn wave, ${maxAlive} alive, one shot a second`, sim.zombies().length, watch.report(sim.zombies()), 0);
}

/** The scenario the first benchmark measured: 24 zombies on the Bunker with both stairs open and the HELP door shut. */
export function runBunkerRoute(options: { ticks?: number } = {}): BenchmarkResult {
  const map = BUNKER_MAP;
  const sim = new GameSimulation({ seed: 1, map: { ...simulationMap(map), zombieSpawns: [] }, playerSpawns: [{ x: 5.2, y: 0, z: 4.2 }],
    roundConfig: { initialWaitTicks: 999_999, intermissionTicks: 999_999 } });
  sim.getPlayer(sim.playerIds[0])!.godMode = true;
  for (const door of sim.state.doors) if (door.id !== 'help-room') door.open = true;
  for (let i = 0; i < 24; i++) {
    addEntity(sim.state.world, createZombieState(allocateEntityId(sim.state.world),
      { x: -6 + (i % 4) * 0.3, y: 0, z: -4 + Math.floor(i / 4) * 0.3 }, 1));
  }
  const ticks = options.ticks ?? 900, recorder = new Recorder(sim), watch = new StallWatch();
  for (let tick = 0; tick < ticks; tick++) {
    sim.tick();
    if (tick >= 60) recorder.record(tick);
    if (tick % 60 === 59) watch.check(sim.zombies(), sim.getPlayer(sim.playerIds[0])!.position);
  }
  return recorder.result('Bunker: 24 zombies, HELP door shut, both stairs open', 24, watch.report(sim.zombies()), 0);
}

export const SCENARIOS = { train: runAsylumTraining, wave: runAsylumWave, bunker: runBunkerRoute } as const;

/** One result as text, for the console. */
export function formatResult(result: BenchmarkResult): string {
  const ms = (value: number) => value.toFixed(2).padStart(7);
  const lines = [`${result.scenario}`, `  ${result.ticks} ticks timed, ${result.zombies} zombies at the end${result.laps ? `, ${result.laps} laps` : ''}`,
    `  tick ms    mean ${ms(result.tickMs.mean)}  p50 ${ms(result.tickMs.p50)}  p95 ${ms(result.tickMs.p95)}  p99 ${ms(result.tickMs.p99)}  max ${ms(result.tickMs.max)}`];
  for (const stage of SIMULATION_STAGES) {
    const d = result.stageMs[stage];
    if (d.max < 0.005) continue;
    lines.push(`    ${stage.padEnd(11)}mean ${ms(d.mean)}  p95 ${ms(d.p95)}  p99 ${ms(d.p99)}  max ${ms(d.max)}`);
  }
  lines.push(`  slowest tick #${result.worst.tick}: ${result.worst.ms.toFixed(2)} ms, mostly ${result.worst.stage} (${result.worst.stages[result.worst.stage].toFixed(2)} ms)`);
  const work = (counters: WorkCounters) => COUNTER_KEYS.filter(key => counters[key] > 0)
    .map(key => `${key} ${Math.round(counters[key]).toLocaleString('en')}`).join(', ');
  lines.push(`  work per tick: ${work(result.workPerTick)}`, `  most in one tick: ${work(result.workMax)}`);
  lines.push(`  stalls: ${result.stalls.stalledSeconds} zombie-seconds, longest ${result.stalls.longestSeconds} s, ${result.stalls.stuckZombies} stuck at the end`);
  return lines.join('\n');
}
