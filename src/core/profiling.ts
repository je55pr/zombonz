/**
 * Diagnostics for the simulation's cost: counts of the work it does and, when a probe is attached, how long
 * each stage of a tick takes. Nothing here is ever read by game logic, so it cannot change what happens; it
 * only lets the F3 profiler, `npm run benchmark` and the tests see where a slow tick went.
 */

/** Units of work done since the last reset. They are exact and repeatable, unlike wall-clock time. */
export interface WorkCounters {
  /** Where-do-I-go-next questions a zombie asked the navigation query. */
  navigationQueries: number;
  /** Times the query found a clear straight line to the goal, and so did no searching at all. */
  navigationDirect: number;
  /** Nodes looked at while finding the nearest reachable one (a scan of the whole graph counts every node). */
  navigationNodeScans: number;
  /** Nodes whose reachability was answered from the cache instead of scanned for. */
  navigationNodeHits: number;
  /** Straight-line reachability tests (a wall test plus a floor-support test). */
  navigationLineTests: number;
  /** Wall boxes a line was tested against. */
  navigationBoxTests: number;
  /** Floor heights sampled along lines. */
  navigationFloorSamples: number;
  /** Breadth-first searches of the graph, and answers taken from the path cache instead. */
  navigationSearches: number;
  navigationSearchHits: number;
  /** Times the door-aware graph was rebuilt (a door opened, the box moved, a hazard blew). */
  navigationRebuilds: number;
  /** Zombies moved against the walls, and wall boxes that movement looked at. */
  moves: number;
  moveBoxTests: number;
  /** Pairs of zombies closer than a body apart that were pushed apart, and pairs looked at to find them. */
  separationPairs: number;
  separationShoves: number;
  /** Zombies that stood still too long and were freed. */
  stuckRecoveries: number;
}

export type WorkCounter = keyof WorkCounters;

const ZERO: WorkCounters = {
  navigationQueries: 0, navigationDirect: 0, navigationNodeScans: 0, navigationNodeHits: 0, navigationLineTests: 0,
  navigationBoxTests: 0, navigationFloorSamples: 0, navigationSearches: 0, navigationSearchHits: 0, navigationRebuilds: 0,
  moves: 0, moveBoxTests: 0, separationPairs: 0, separationShoves: 0, stuckRecoveries: 0,
};

/** The running totals. Every simulation in the page adds to the same ones; read them as a difference. */
export const work: WorkCounters = { ...ZERO };

export function resetWork(): void { Object.assign(work, ZERO); }
export function readWork(): WorkCounters { return { ...work }; }

/** What a tick's work came to since `before`. */
export function workSince(before: Readonly<WorkCounters>): WorkCounters {
  const result = { ...ZERO };
  for (const key of Object.keys(result) as WorkCounter[]) result[key] = work[key] - before[key];
  return result;
}

/** The stages of one simulation tick that are timed separately. */
export const SIMULATION_STAGES = ['players', 'combat', 'blasts', 'spawning', 'entries', 'pursuit', 'melee', 'separation', 'rest'] as const;
export type SimulationStage = typeof SIMULATION_STAGES[number];

export type StageTimes = Record<SimulationStage, number>;

/**
 * Times the stages of each tick. Attach one to a `GameSimulation` (`simulation.probe = ...`) and it fills in
 * `stages` (milliseconds this tick), `tickMs` and `work` (what the tick cost) as ticks run. Give it a clock:
 * `performance.now` in a browser, or anything monotonic in a test.
 */
export class SimulationProbe {
  readonly stages: StageTimes = Object.fromEntries(SIMULATION_STAGES.map(stage => [stage, 0])) as StageTimes;
  tickMs = 0;
  work: WorkCounters = { ...ZERO };
  private started = 0;
  private mark = 0;
  private before: WorkCounters = { ...ZERO };

  constructor(readonly now: () => number) {}

  /** A tick begins: clears this tick's numbers. */
  begin(): void {
    for (const stage of SIMULATION_STAGES) this.stages[stage] = 0;
    this.before = readWork();
    this.started = this.mark = this.now();
  }

  /** The time since the last mark goes to `stage`. */
  lap(stage: SimulationStage): void {
    const now = this.now();
    this.stages[stage] += now - this.mark;
    this.mark = now;
  }

  /** The tick is over; whatever is left is 'rest'. */
  end(): void {
    this.lap('rest');
    this.tickMs = this.mark - this.started;
    this.work = workSince(this.before);
  }
}

/** The p50 / p95 / p99 / max of a run of samples (0 for none). */
export interface Distribution { mean: number; p50: number; p95: number; p99: number; max: number; count: number }

export function distribution(samples: readonly number[]): Distribution {
  if (!samples.length) return { mean: 0, p50: 0, p95: 0, p99: 0, max: 0, count: 0 };
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (fraction: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))];
  return { mean: sorted.reduce((sum, value) => sum + value, 0) / sorted.length, p50: at(0.5), p95: at(0.95), p99: at(0.99),
    max: sorted[sorted.length - 1], count: sorted.length };
}
