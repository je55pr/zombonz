import { describe, expect, it } from 'vitest';
import {
  GameSimulation, SIMULATION_STAGES, SimulationProbe, distribution, readWork, resetWork, work, workSince,
} from '../src/core/index.ts';
import { ASYLUM_TRAIN_LAP, RouteRunner, routeThrough, runAsylumTraining, runAsylumWave, runBunkerRoute } from '../src/bench/scenarios.ts';
import { ASYLUM_MAP } from '../src/maps/asylum.ts';

/**
 * These hold the simulation to the cost it has now. Before navigation was indexed, a 24-zombie training run on
 * Asylum tested about a million wall boxes and scanned 20,000 graph nodes every tick, averaged 35 ms a tick (a
 * frame is 16.7) and spiked to 170 ms. The work counts are exact wherever this runs, so they carry the guarantee;
 * the wall-clock check is only a coarse floor that would catch a return to the old cost on any machine.
 */
describe('simulation cost under a large horde', () => {
  const train = runAsylumTraining({ ticks: 900 });

  it('tests few walls and nodes per tick while 24 zombies are trained round the power side', () => {
    expect(train.zombies).toBe(24);
    expect(train.workPerTick.navigationBoxTests).toBeLessThan(20_000);
    expect(train.workPerTick.navigationNodeScans).toBeLessThan(1_000);
    expect(train.workPerTick.navigationLineTests).toBeLessThan(2_000);
    expect(train.workPerTick.moveBoxTests).toBeLessThan(5_000);
    expect(train.workPerTick.navigationSearches).toBeLessThan(5);
  });

  it('never has one tick that does the work of a hundred', () => {
    // Doors opening along the route remake the navigation; that must not cost a whole map scan.
    expect(train.workMax.navigationBoxTests).toBeLessThan(400_000);
    expect(train.workMax.navigationLineTests).toBeLessThan(10_000);
    expect(train.workMax.navigationNodeScans).toBeLessThan(10_000);
  });

  it('keeps ticks well inside a frame', () => {
    expect(train.tickMs.p95).toBeLessThan(16);
    expect(train.tickMs.mean).toBeLessThan(8);
  });

  it('spends its time in the stages the probe names, and they add up to the tick', () => {
    const total = SIMULATION_STAGES.reduce((sum, stage) => sum + train.stageMs[stage].mean, 0);
    expect(total).toBeCloseTo(train.tickMs.mean, 1);
    expect(train.worst.ms).toBe(train.tickMs.max);
  });

  it('checks spawn routes cheaply while a wave keeps coming through the windows', () => {
    const wave = runAsylumWave({ ticks: 900 });
    expect(wave.workMax.navigationBoxTests).toBeLessThan(50_000);
    expect(wave.workMax.navigationNodeScans).toBeLessThan(2_000);
    expect(wave.workMax.navigationSearches).toBeLessThan(80);
    expect(wave.tickMs.p95).toBeLessThan(16);
  });

  it('is cheap on the Bunker too', () => {
    const bunker = runBunkerRoute({ ticks: 400 });
    expect(bunker.workPerTick.navigationBoxTests).toBeLessThan(30_000);
    expect(bunker.tickMs.p95).toBeLessThan(16);
  });
});

describe('the stress route', () => {
  it('is a closed lap of named nodes that all exist', () => {
    const route = routeThrough(ASYLUM_MAP, ASYLUM_TRAIN_LAP);
    expect(route.length).toBeGreaterThan(40);
    expect(route[0]).toEqual(route[route.length - 1]);
    const heights = new Set(route.map(point => point.y));
    expect(heights.has(0) && heights.has(ASYLUM_MAP.upperHeight)).toBe(true);
  });

  it('is walked at a steady pace and counts its laps', () => {
    const route = routeThrough(ASYLUM_MAP, ASYLUM_TRAIN_LAP);
    let length = 0;
    for (let i = 1; i < route.length; i++) length += Math.hypot(route[i].x - route[i - 1].x, route[i].z - route[i - 1].z);
    const runner = new RouteRunner(route, 0.07);
    let previous = runner.step(), longestStep = 0;
    for (let i = 0; i < Math.ceil(length / 0.07) + 5; i++) {
      const point = runner.step();
      longestStep = Math.max(longestStep, Math.hypot(point.x - previous.x, point.z - previous.z));
      previous = point;
    }
    expect(runner.laps).toBe(1);
    expect(longestStep).toBeLessThan(0.075);
  });

  it('is repeatable: the same run does the same work', () => {
    const first = runAsylumTraining({ ticks: 240, warmup: 0 }), second = runAsylumTraining({ ticks: 240, warmup: 0 });
    expect(second.workPerTick).toEqual(first.workPerTick);
    expect(second.workMax).toEqual(first.workMax);
    expect(second.stalls).toEqual(first.stalls);
  });
});

describe('the probe', () => {
  it('times each stage of a tick and reports the work the tick did', () => {
    let clock = 0;
    const probe = new SimulationProbe(() => clock);
    probe.begin();
    clock = 2; probe.lap('players');
    work.navigationQueries += 3;
    clock = 7; probe.lap('pursuit');
    clock = 8; probe.end();
    expect(probe.stages.players).toBe(2);
    expect(probe.stages.pursuit).toBe(5);
    expect(probe.stages.rest).toBe(1);
    expect(probe.tickMs).toBe(8);
    expect(probe.work.navigationQueries).toBe(3);
    probe.begin();
    expect(probe.stages.players).toBe(0);
  });

  it('is filled in by a simulation that has one attached, and costs nothing when there is none', () => {
    const map = ASYLUM_MAP;
    const sim = new GameSimulation({ seed: 1, map: { collisionBoxes: [...map.collisionBoxes], walkSurfaces: map.walkSurfaces, zombieSpawns: [] },
      playerSpawns: [map.playerSpawn], roundConfig: { initialWaitTicks: 9999, intermissionTicks: 9999 } });
    expect(sim.probe).toBeNull();
    sim.tick();
    let clock = 0;
    sim.probe = new SimulationProbe(() => ++clock);
    sim.tick();
    expect(sim.probe.tickMs).toBeGreaterThan(0);
  });

  it('takes a difference of the work counters', () => {
    resetWork();
    const before = readWork();
    work.moves += 4; work.separationPairs += 2;
    expect(workSince(before).moves).toBe(4);
    expect(workSince(before).separationPairs).toBe(2);
    expect(workSince(before).navigationQueries).toBe(0);
  });

  it('summarises samples as a distribution', () => {
    expect(distribution([])).toEqual({ mean: 0, p50: 0, p95: 0, p99: 0, max: 0, count: 0 });
    const samples = Array.from({ length: 100 }, (_, index) => index + 1);
    const d = distribution(samples.reverse());
    expect(d).toMatchObject({ mean: 50.5, p50: 50, p95: 95, p99: 99, max: 100, count: 100 });
    expect(distribution([7]).p99).toBe(7);
  });
});
