export interface NetworkDiagnostics {
  role: 'host' | 'client';
  state: string;
  peers: number;
  rttMs: number | null;
  snapshotRateHz: number | null;
  snapshotLossPercent: number | null;
  interpolationDelayMs: number | null;
  snapshotAgeMs: number | null;
  bufferDepth: number | null;
  renderDelayTicks: number | null;
  lastError: string | null;
}

const WINDOW_MS = 3_000;

export interface SnapshotReport {
  rateHz: number | null;
  lossPercent: number | null;
  ageMs: number | null;
}

/**
 * Rolling observation of authoritative snapshots. Tick gaps approximate loss without needing a new
 * protocol acknowledgement: a late/out-of-order snapshot fills its missing tick and heals the estimate.
 */
export class SnapshotTelemetry {
  private samples: Array<{ tick: number; time: number }> = [];

  reset(): void { this.samples = []; }

  observe(tick: number, time: number): void {
    if (!Number.isFinite(time) || this.samples.some(sample => sample.tick === tick)) return;
    this.samples.push({ tick, time });
    this.prune(time);
  }

  report(now: number, intervalTicks: number): SnapshotReport {
    this.prune(now);
    if (!this.samples.length) return { rateHz: null, lossPercent: null, ageMs: null };
    const byTime = [...this.samples].sort((a, b) => a.time - b.time);
    const first = byTime[0], last = byTime[byTime.length - 1];
    const newest = this.samples.reduce((best, sample) => sample.tick > best.tick ? sample : best, this.samples[0]);
    const elapsedSeconds = (last.time - first.time) / 1000;
    const rateHz = byTime.length >= 2 && elapsedSeconds > 0 ? (byTime.length - 1) / elapsedSeconds : null;

    const ticks = [...new Set(this.samples.map(sample => sample.tick))].sort((a, b) => a - b);
    let lossPercent: number | null = null;
    if (ticks.length >= 2 && intervalTicks > 0) {
      const expected = Math.floor((ticks[ticks.length - 1] - ticks[0]) / intervalTicks) + 1;
      lossPercent = expected > 0 ? Math.max(0, expected - ticks.length) / expected * 100 : 0;
    }
    return { rateHz, lossPercent, ageMs: Math.max(0, now - newest.time) };
  }

  private prune(now: number): void {
    const cutoff = now - WINDOW_MS;
    this.samples = this.samples.filter(sample => sample.time >= cutoff);
  }
}

/** Rolling event rate, used by the host to report how often it actually published snapshots. */
export class EventRateTelemetry {
  private times: number[] = [];

  reset(): void { this.times = []; }

  observe(time: number): void {
    if (!Number.isFinite(time)) return;
    this.times.push(time);
    this.prune(time);
  }

  report(now: number): number | null {
    this.prune(now);
    if (this.times.length < 2) return null;
    const elapsed = (this.times[this.times.length - 1] - this.times[0]) / 1000;
    return elapsed > 0 ? (this.times.length - 1) / elapsed : null;
  }

  private prune(now: number): void {
    const cutoff = now - WINDOW_MS;
    this.times = this.times.filter(time => time >= cutoff);
  }
}
