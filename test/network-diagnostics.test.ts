import { describe, expect, it } from 'vitest';
import { EventRateTelemetry, SnapshotTelemetry, type NetworkDiagnostics } from '../src/net/telemetry.ts';
import { networkDiagnosticLines } from '../src/client/networkDiagnosticsOverlay.ts';

describe('network diagnostics telemetry', () => {
  it('reports a stable snapshot rate with no loss', () => {
    const telemetry = new SnapshotTelemetry();
    [3, 6, 9, 12, 15].forEach((tick, index) => telemetry.observe(tick, index * 50));
    expect(telemetry.report(200, 3)).toEqual({ rateHz: 20, lossPercent: 0, ageMs: 0 });
  });

  it('estimates missing snapshots and heals when a late snapshot arrives', () => {
    const telemetry = new SnapshotTelemetry();
    telemetry.observe(3, 0);
    telemetry.observe(6, 50);
    telemetry.observe(12, 150);
    telemetry.observe(15, 200);
    expect(telemetry.report(200, 3).lossPercent).toBe(20);

    telemetry.observe(9, 225);
    const healed = telemetry.report(250, 3);
    expect(healed.lossPercent).toBe(0);
    // A late old tick must not make the newest authoritative snapshot look fresher than it is.
    expect(healed.ageMs).toBe(50);
  });

  it('drops stale observations from the rolling window', () => {
    const telemetry = new SnapshotTelemetry();
    telemetry.observe(3, 0);
    telemetry.observe(6, 50);
    expect(telemetry.report(4_000, 3)).toEqual({ rateHz: null, lossPercent: null, ageMs: null });
  });

  it('reports the host publication rate over the same rolling window', () => {
    const telemetry = new EventRateTelemetry();
    [0, 50, 100, 150, 200].forEach(time => telemetry.observe(time));
    expect(telemetry.report(200)).toBe(20);
    expect(telemetry.report(4_000)).toBeNull();
  });
});

describe('network diagnostics overlay text', () => {
  const client = (overrides: Partial<NetworkDiagnostics> = {}): NetworkDiagnostics => ({
    role: 'client', state: 'game', peers: 1, rttMs: 42, snapshotRateHz: 20, snapshotLossPercent: 0,
    interpolationDelayMs: 100, snapshotAgeMs: 18, bufferDepth: 7, renderDelayTicks: 6, lastError: null,
    ...overrides,
  });

  it('shows the requested client metrics and role/state', () => {
    const text = networkDiagnosticLines(client()).map(line => line.text).join('\n');
    expect(text).toContain('CLIENT  |  GAME  |  1 peer');
    expect(text).toContain('RTT 42 ms');
    expect(text).toContain('Snapshots 20.0 /s');
    expect(text).toContain('loss ~0.0%');
    expect(text).toContain('Interpolation 100 ms');
    expect(text).toContain('Render lag 6.0 ticks');
  });

  it('makes useful transport errors visible', () => {
    const lines = networkDiagnosticLines(client({ lastError: 'ICE connection failed' }));
    expect(lines.at(-1)).toEqual({ text: 'ERROR: ICE connection failed', tone: 'error' });
  });

  it('does not invent host RTT or packet-loss measurements', () => {
    const text = networkDiagnosticLines({ ...client(), role: 'host', peers: 2, rttMs: null,
      snapshotLossPercent: null, interpolationDelayMs: null, snapshotAgeMs: null,
      bufferDepth: null, renderDelayTicks: null }).map(line => line.text).join('\n');
    expect(text).toContain('HOST  |  GAME  |  2 peers');
    expect(text).toContain('RTT / packet loss: measured by clients');
    expect(text).toContain('Snapshots sent 20.0 /s');
  });
});
