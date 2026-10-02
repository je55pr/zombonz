import * as THREE from 'three';
import { addWork, distribution, emptyWork, type Distribution, type SimulationStage, type WorkCounters } from '../core/profiling.ts';
import type { LightingMetrics } from './lighting.ts';

/** Stage times are CPU wall time, including any driver stall inside a render call. */
export interface FrameProfile {
  intervalMs: number;
  cpuMs: number;
  simulationMs: number;
  networkMs: number;
  actorsMs: number;
  detailsMs: number;
  sceneMs: number;
  weaponMs: number;
  hudMs: number;
  overlayMs: number;
  shadowFrame: boolean;
  ticks: number;
  calls: number;
  triangles: number;
  rigs: number;
  scale: number;
  lighting?: Readonly<LightingMetrics>;
  /**
   * What each simulation tick of this frame took (ms), the stage the slowest of them was in, and the work all of them did.
   * Left out where the simulation was not ticked here (a client in a shared game only predicts its own player).
   */
  tickMs?: readonly number[];
  slowestStage?: SimulationStage;
  work?: Readonly<WorkCounters>;
}

/** The simulation's ticks over a report's second: how long each took, and how much work it did. */
export interface TickReport {
  ticks: Distribution;
  /** Where the slowest tick of the second spent its time. */
  slowestStage: SimulationStage;
  /** Work per tick, on average. */
  work: WorkCounters;
}

export interface FrameReport {
  fps: number;
  frameMs: number;
  frameP95Ms: number;
  cpuMs: number;
  cpuP95Ms: number;
  stages: Readonly<Record<'simulation' | 'network' | 'actors' | 'details' | 'scene' | 'weapon' | 'hud' | 'overlay' | 'other', number>>;
  shadowSceneMs: number | null;
  regularSceneMs: number | null;
  calls: number;
  triangles: number;
  rigs: number;
  ticks: number;
  scale: number;
  lighting?: Readonly<LightingMetrics>;
  /** Null when no tick was timed (see FrameProfile.tickMs). */
  tick: TickReport | null;
}

const BUDGET_MS = 1000 / 144;
/** The overlay's height in canvas pixels (its width is 640). */
const HEIGHT = 548;
const mean = (values: readonly number[]): number => values.reduce((sum, value) => sum + value, 0) / values.length;
const percentile = (values: readonly number[], fraction: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
};

/** One-second summaries, with no canvas or WebGL dependencies so timing math is testable. */
export class FrameProfiler {
  private samples: FrameProfile[] = [];
  private elapsed = 0;

  reset(): void { this.samples = []; this.elapsed = 0; }

  add(sample: FrameProfile): FrameReport | null {
    // Ignore a background-tab gap, but still report genuinely slow frames.
    if (sample.intervalMs <= 0 || sample.intervalMs > 5000) return null;
    this.samples.push(sample);
    this.elapsed += sample.intervalMs;
    if (this.elapsed < 1000) return null;
    const samples = this.samples;
    const stage = (key: keyof FrameProfile) => mean(samples.map(item => item[key] as number));
    const tickTimes = samples.flatMap(item => item.tickMs ?? []);
    let tick: TickReport | null = null;
    if (tickTimes.length) {
      const work = emptyWork();
      let slowest = -1, slowestStage: SimulationStage = 'rest';
      for (const item of samples) {
        if (item.work) addWork(work, item.work);
        const worst = Math.max(-1, ...(item.tickMs ?? []));
        if (item.slowestStage && worst > slowest) { slowest = worst; slowestStage = item.slowestStage; }
      }
      for (const key of Object.keys(work) as Array<keyof WorkCounters>) work[key] /= tickTimes.length;
      tick = { ticks: distribution(tickTimes), slowestStage, work };
    }
    const shadow = samples.filter(item => item.shadowFrame);
    const regular = samples.filter(item => !item.shadowFrame);
    const stages = {
      simulation: stage('simulationMs'), network: stage('networkMs'), actors: stage('actorsMs'),
      details: stage('detailsMs'), scene: stage('sceneMs'), weapon: stage('weaponMs'),
      hud: stage('hudMs'), overlay: stage('overlayMs'),
      other: 0,
    };
    stages.other = Math.max(0, stage('cpuMs') - Object.values(stages).reduce((sum, value) => sum + value, 0));
    const report: FrameReport = {
      fps: samples.length * 1000 / this.elapsed,
      frameMs: stage('intervalMs'), frameP95Ms: percentile(samples.map(item => item.intervalMs), 0.95),
      cpuMs: stage('cpuMs'), cpuP95Ms: percentile(samples.map(item => item.cpuMs), 0.95),
      stages,
      shadowSceneMs: shadow.length ? mean(shadow.map(item => item.sceneMs)) : null,
      regularSceneMs: regular.length ? mean(regular.map(item => item.sceneMs)) : null,
      calls: stage('calls'), triangles: stage('triangles'), rigs: samples.at(-1)!.rigs,
      ticks: stage('ticks'), scale: samples.at(-1)!.scale, lighting: samples.at(-1)!.lighting, tick,
    };
    this.reset();
    return report;
  }
}

/** Non-blocking GPU timer queries. Results arrive a few frames later; unsupported browsers show n/a. */
class GpuFrameTimer {
  private readonly gl: WebGL2RenderingContext | null;
  private readonly ext: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
  private active: WebGLQuery | null = null;
  private pending: WebGLQuery[] = [];
  private samples: number[] = [];

  constructor(renderer: THREE.WebGLRenderer) {
    const gl = renderer.getContext() as WebGL2RenderingContext;
    this.gl = typeof gl.createQuery === 'function' ? gl : null;
    this.ext = this.gl?.getExtension('EXT_disjoint_timer_query_webgl2') ?? null;
  }

  get supported(): boolean { return !!this.gl && !!this.ext; }

  begin(): void {
    if (!this.gl || !this.ext || this.active || this.pending.length >= 4) return;
    const query = this.gl.createQuery();
    if (!query) return;
    try { this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, query); this.active = query; }
    catch { this.gl.deleteQuery(query); }
  }

  end(): void {
    if (!this.gl || !this.ext || !this.active) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.pending.push(this.active);
    this.active = null;
  }

  poll(): void {
    if (!this.gl || !this.ext) return;
    if (this.gl.getParameter(this.ext.GPU_DISJOINT_EXT)) {
      for (const query of this.pending) this.gl.deleteQuery(query);
      this.pending = []; this.samples = [];
      return;
    }
    while (this.pending.length && this.gl.getQueryParameter(this.pending[0], this.gl.QUERY_RESULT_AVAILABLE)) {
      const query = this.pending.shift()!;
      const nanoseconds = this.gl.getQueryParameter(query, this.gl.QUERY_RESULT) as number;
      this.gl.deleteQuery(query);
      if (Number.isFinite(nanoseconds) && nanoseconds >= 0) this.samples.push(nanoseconds / 1e6);
    }
  }

  takeAverage(): number | null {
    if (!this.samples.length) return null;
    const result = mean(this.samples);
    this.samples = [];
    return result;
  }

  dispose(): void {
    if (!this.gl) return;
    if (this.active && this.ext) this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    if (this.active) this.gl.deleteQuery(this.active);
    for (const query of this.pending) this.gl.deleteQuery(query);
    this.pending = []; this.active = null;
  }
}

// A single small texture updated once a second. Profiling itself is dormant until F3 is enabled.
export class PerformanceOverlay {
  private visible = new URLSearchParams(location.search).has('perf');
  private readonly profiler = new FrameProfiler();
  private readonly gpu: GpuFrameTimer;
  private readonly canvas = document.createElement('canvas');
  private readonly context: CanvasRenderingContext2D;
  private readonly texture: THREE.CanvasTexture;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(0, 1, 1, 0, 0, 2);
  private readonly quad: THREE.Mesh;
  private readonly size = new THREE.Vector2();
  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (event.code !== 'F3' || event.repeat) return;
    event.preventDefault();
    this.visible = !this.visible;
    if (this.visible) { this.profiler.reset(); this.drawWaiting(); }
  };

  constructor(renderer: THREE.WebGLRenderer) {
    this.gpu = new GpuFrameTimer(renderer);
    this.canvas.width = 640; this.canvas.height = HEIGHT;
    this.context = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.generateMipmaps = false; this.texture.minFilter = THREE.LinearFilter;
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
      map: this.texture, transparent: true, depthTest: false, depthWrite: false,
    }));
    this.scene.add(this.quad); this.camera.position.z = 1;
    this.drawWaiting();
    addEventListener('keydown', this.onKeyDown);
  }

  get enabled(): boolean { return this.visible; }
  beginGpu(): void { if (this.visible) this.gpu.begin(); }
  endGpu(): void { if (this.visible) this.gpu.end(); }

  sample(profile: FrameProfile): void {
    if (!this.visible) return;
    this.gpu.poll();
    const report = this.profiler.add(profile);
    if (report) this.draw(report, this.gpu.takeAverage());
  }

  private background(): void {
    const c = this.context;
    c.clearRect(0, 0, 640, HEIGHT);
    c.fillStyle = 'rgba(5, 9, 10, 0.94)'; c.fillRect(0, 0, 640, HEIGHT);
    c.strokeStyle = '#66736d'; c.strokeRect(0.5, 0.5, 639, HEIGHT - 1);
    c.font = '18px monospace'; c.textBaseline = 'top';
  }

  private drawWaiting(): void {
    this.background();
    this.context.fillStyle = '#f1e8c9';
    this.context.fillText('FRAME PROFILER  |  collecting 1 second...', 16, 16);
    this.texture.needsUpdate = true;
  }

  private draw(report: FrameReport, gpuMs: number | null): void {
    this.background();
    const c = this.context;
    const line = (text: string, y: number, colour = '#e4e4d5') => { c.fillStyle = colour; c.fillText(text, 16, y); };
    line(`FPS ${report.fps.toFixed(0)}  |  frame avg/p95 ${report.frameMs.toFixed(2)}/${report.frameP95Ms.toFixed(2)} ms`, 14, '#f1e8c9');
    line(`CPU avg/p95 ${report.cpuMs.toFixed(2)}/${report.cpuP95Ms.toFixed(2)} ms  |  144Hz budget ${BUDGET_MS.toFixed(2)} ms`, 39);
    line(this.gpu.supported
      ? `GPU draw ${gpuMs === null ? 'pending' : gpuMs.toFixed(2) + ' ms'} (async; excludes present)`
      : 'GPU draw n/a (timer-query extension unavailable)', 64, '#a8c8c0');
    line('CPU STAGES                         avg ms   144Hz budget', 94, '#dbb75d');
    const rows: Array<[string, number]> = [
      ['simulation', report.stages.simulation], ['network', report.stages.network],
      ['actors / animation', report.stages.actors], ['map details', report.stages.details],
      ['scene render', report.stages.scene], ['weapon view', report.stages.weapon],
      ['HUD', report.stages.hud], ['profiler + other', report.stages.overlay + report.stages.other],
    ];
    rows.forEach(([name, value], index) => {
      const y = 122 + index * 29;
      c.fillStyle = '#d6dad4'; c.fillText(name.padEnd(20), 16, y);
      c.fillStyle = value > BUDGET_MS ? '#e66750' : '#f1e8c9';
      c.fillText(value.toFixed(2).padStart(6), 296, y);
      c.fillStyle = '#263936'; c.fillRect(387, y + 4, 230, 13);
      c.fillStyle = value > BUDGET_MS ? '#bd493b' : '#67a99b';
      c.fillRect(387, y + 4, Math.min(230, value / BUDGET_MS * 230), 13);
    });
    const shadow = report.shadowSceneMs === null ? 'n/a' : report.shadowSceneMs.toFixed(2);
    const regular = report.regularSceneMs === null ? 'n/a' : report.regularSceneMs.toFixed(2);
    line(`Scene CPU: shadow frame ${shadow} ms | regular ${regular} ms`, 358, '#dbb75d');
    if (report.lighting) {
      const light = report.lighting;
      line(`Lighting ${light.quality} | real ${light.shiningSources}/${light.realLights} | sources ${light.logicalSources} | shadow ${light.shadowSize}x${light.shadowSize} @ ${light.shadowRefreshHz} Hz`, 381, '#a8c8c0');
    }
    line(`${report.calls.toFixed(0)} draws | ${Math.round(report.triangles / 1000)}k tris | ${report.rigs} rigs | ${report.ticks.toFixed(2)} ticks/f | ${report.scale.toFixed(2)}x`,
      404, '#a8c8c0');
    // The simulation tick by tick: an average hides the one slow tick that is the stutter.
    line('SIMULATION TICK (ms)', 437, '#dbb75d');
    if (!report.tick) line('n/a (this game does not run the simulation here)', 463, '#a8c8c0');
    else {
      const { ticks, slowestStage, work } = report.tick;
      const cells: Array<[string, number]> = [['avg', ticks.mean], ['p95', ticks.p95], ['p99', ticks.p99], ['max', ticks.max]];
      cells.forEach(([label, value], index) => {
        c.fillStyle = value > BUDGET_MS ? '#e66750' : '#f1e8c9';
        c.fillText(`${label} ${value.toFixed(2)}`, 16 + index * 152, 463);
      });
      const count = (value: number) => value >= 10_000 ? `${Math.round(value / 1000)}k` : value >= 1000 ? `${(value / 1000).toFixed(1)}k` : value.toFixed(0);
      line(`slowest tick was in: ${slowestStage}  (${ticks.max.toFixed(2)} ms)`, 489, '#a8c8c0');
      line(`per tick: ${count(work.navigationQueries)} routes | ${count(work.navigationLineTests)} lines | ${count(work.navigationBoxTests + work.moveBoxTests)} walls | ${count(work.navigationSearches)} searches`, 515, '#a8c8c0');
    }
    this.texture.needsUpdate = true;
  }

  render(renderer: THREE.WebGLRenderer): void {
    if (!this.visible) return;
    renderer.getSize(this.size);
    if (this.camera.right !== this.size.x || this.camera.top !== this.size.y) {
      this.camera.right = this.size.x; this.camera.top = this.size.y;
      this.camera.updateProjectionMatrix();
      const width = Math.min(560, this.size.x - 24), height = width * HEIGHT / 640;
      this.quad.scale.set(width, height, 1);
      this.quad.position.set(this.size.x - width / 2 - 12, this.size.y - height / 2 - 12, 0);
    }
    renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    removeEventListener('keydown', this.onKeyDown);
    this.gpu.dispose();
    this.quad.geometry.dispose();
    (this.quad.material as THREE.Material).dispose();
    this.texture.dispose();
  }
}
