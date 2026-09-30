import * as THREE from 'three';
import type { NetworkDiagnostics } from '../net/telemetry.ts';

export interface DiagnosticLine {
  text: string;
  tone?: 'normal' | 'muted' | 'warn' | 'error';
}

const value = (number: number | null, digits = 1): string => number === null ? 'collecting' : number.toFixed(digits);

export function networkDiagnosticLines(diagnostics: NetworkDiagnostics | null): DiagnosticLine[] {
  if (!diagnostics) return [
    { text: 'NETWORK DIAGNOSTICS  |  F4 TOGGLE', tone: 'muted' },
    { text: 'No multiplayer session is active.' },
  ];
  const role = diagnostics.role.toUpperCase();
  const state = diagnostics.state.toUpperCase();
  const lines: DiagnosticLine[] = [
    { text: 'NETWORK DIAGNOSTICS  |  F4 TOGGLE', tone: 'muted' },
    { text: role + '  |  ' + state + '  |  ' + diagnostics.peers + ' peer' + (diagnostics.peers === 1 ? '' : 's') },
  ];
  if (diagnostics.role === 'client') {
    lines.push(
      { text: 'RTT ' + (diagnostics.rttMs === null ? 'collecting' : Math.round(diagnostics.rttMs) + ' ms') },
      { text: 'Snapshots ' + value(diagnostics.snapshotRateHz) + ' /s  |  loss ' +
          (diagnostics.snapshotLossPercent === null ? 'collecting' : '~' + diagnostics.snapshotLossPercent.toFixed(1) + '%'),
        tone: diagnostics.snapshotLossPercent !== null && diagnostics.snapshotLossPercent >= 10 ? 'warn' : 'normal' },
      { text: 'Interpolation ' + (diagnostics.interpolationDelayMs === null ? 'n/a' : Math.round(diagnostics.interpolationDelayMs) + ' ms') +
          '  |  buffer ' + (diagnostics.bufferDepth ?? 'n/a') },
      { text: 'Render lag ' + (diagnostics.renderDelayTicks === null ? 'collecting' : diagnostics.renderDelayTicks.toFixed(1) + ' ticks') +
          '  |  snapshot age ' + (diagnostics.snapshotAgeMs === null ? 'collecting' : Math.round(diagnostics.snapshotAgeMs) + ' ms') },
    );
  } else {
    lines.push(
      { text: 'RTT / packet loss: measured by clients', tone: 'muted' },
      { text: 'Snapshots sent ' + value(diagnostics.snapshotRateHz) + ' /s' },
    );
  }
  if (diagnostics.lastError) lines.push({ text: 'ERROR: ' + diagnostics.lastError, tone: 'error' });
  return lines;
}

const WIDTH = 600;
const LINE_HEIGHT = 30;
const PADDING = 16;
const MAX_LINES = 8;
const HEIGHT = PADDING * 2 + LINE_HEIGHT * MAX_LINES;

export class NetworkDiagnosticsOverlay {
  private visible = new URLSearchParams(location.search).has('netdiag');
  private lastDraw = -Infinity;
  private readonly canvas = document.createElement('canvas');
  private readonly context: CanvasRenderingContext2D;
  private readonly texture: THREE.CanvasTexture;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(0, 1, 1, 0, 0, 2);
  private readonly quad: THREE.Mesh;
  private readonly size = new THREE.Vector2();
  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (event.code !== 'F4' || event.repeat) return;
    event.preventDefault();
    this.visible = !this.visible;
    this.lastDraw = -Infinity;
  };

  constructor(private readonly diagnostics: () => NetworkDiagnostics | null) {
    this.canvas.width = WIDTH; this.canvas.height = HEIGHT;
    this.context = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.generateMipmaps = false; this.texture.minFilter = THREE.LinearFilter;
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
      map: this.texture, transparent: true, depthTest: false, depthWrite: false,
    }));
    this.scene.add(this.quad); this.camera.position.z = 1;
    addEventListener('keydown', this.onKeyDown);
  }

  get enabled(): boolean { return this.visible; }

  private draw(lines: readonly DiagnosticLine[]): void {
    const c = this.context;
    c.clearRect(0, 0, WIDTH, HEIGHT);
    c.fillStyle = 'rgba(5, 9, 10, 0.94)'; c.fillRect(0, 0, WIDTH, HEIGHT);
    c.strokeStyle = '#66736d'; c.strokeRect(0.5, 0.5, WIDTH - 1, HEIGHT - 1);
    c.font = '18px monospace'; c.textBaseline = 'top';
    const colours = { normal: '#e4e4d5', muted: '#a8c8c0', warn: '#dbb75d', error: '#e66750' } as const;
    lines.slice(0, MAX_LINES).forEach((line, index) => {
      c.fillStyle = colours[line.tone ?? 'normal'];
      c.fillText(line.text, PADDING, PADDING + index * LINE_HEIGHT, WIDTH - PADDING * 2);
    });
    this.texture.needsUpdate = true;
  }

  render(renderer: THREE.WebGLRenderer, now = performance.now()): void {
    if (!this.visible) return;
    if (now - this.lastDraw >= 250) {
      this.draw(networkDiagnosticLines(this.diagnostics()));
      this.lastDraw = now;
    }
    renderer.getSize(this.size);
    if (this.camera.right !== this.size.x || this.camera.top !== this.size.y) {
      this.camera.right = this.size.x; this.camera.top = this.size.y; this.camera.updateProjectionMatrix();
      const width = Math.min(560, this.size.x - 24), height = width * HEIGHT / WIDTH;
      this.quad.scale.set(width, height, 1);
      this.quad.position.set(width / 2 + 12, this.size.y - height / 2 - 12, 0);
    }
    renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    removeEventListener('keydown', this.onKeyDown);
    this.quad.geometry.dispose();
    (this.quad.material as THREE.Material).dispose();
    this.texture.dispose();
  }
}
