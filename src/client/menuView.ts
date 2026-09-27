import {
  createMenuState, menuItems, reduceMenu, setDownload, type DownloadStatus, type MenuAction, type MenuEffect, type MenuState,
} from './menu.ts';
import type { GameSettings } from './settings.ts';

interface Row { index: number; x: number; y: number; width: number; height: number; left?: Box; right?: Box }
interface Box { x: number; y: number; width: number; height: number }

const inside = (box: Box, x: number, y: number) => x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height;

/**
 * The start menu, drawn on its own 2D canvas (in CSS pixels, scaled for the display). It is removed
 * before the game's WebGL canvas is shown, so only one canvas is ever visible.
 */
export class MenuView {
  readonly state: MenuState;
  private readonly context: CanvasRenderingContext2D;
  private rows: Row[] = [];
  private renderQueued = false;
  // Layout changes do not always fire window resize (embedded panes, zoom), so watch the canvas itself.
  private readonly resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => this.render());

  constructor(
    private readonly canvas: HTMLCanvasElement,
    settings: GameSettings,
    private readonly onEffect: (effect: NonNullable<MenuEffect>) => void,
    private readonly buildId: string,
  ) {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('2D canvas unavailable');
    this.context = context;
    this.state = createMenuState(settings);
    addEventListener('resize', this.render);
    addEventListener('keydown', this.onKeyDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerdown', this.onPointerDown);
    this.resizeObserver?.observe(canvas);
    this.render();
  }

  dispose(): void {
    removeEventListener('resize', this.render);
    removeEventListener('keydown', this.onKeyDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.resizeObserver?.disconnect();
  }

  /** Progress arrives per network chunk; redraw at most once per frame. */
  setDownload(download: DownloadStatus): void {
    setDownload(this.state, download);
    if (download.phase === 'ready' || download.phase === 'error') { this.render(); return; }
    if (this.renderQueued) return;
    this.renderQueued = true;
    requestAnimationFrame(() => { this.renderQueued = false; this.render(); });
  }

  private dispatch(action: MenuAction): void {
    const effect = reduceMenu(this.state, action);
    if (effect) this.onEffect(effect);
    this.render();
  }

  private readonly onKeyDown = (event: KeyboardEvent) => {
    const action: MenuAction | null = event.code === 'ArrowUp' || event.code === 'KeyW' ? { type: 'up' }
      : event.code === 'ArrowDown' || event.code === 'KeyS' ? { type: 'down' }
        : event.code === 'ArrowLeft' || event.code === 'KeyA' ? { type: 'left' }
          : event.code === 'ArrowRight' || event.code === 'KeyD' ? { type: 'right' }
            : event.code === 'Enter' || event.code === 'Space' ? { type: 'activate' }
              : event.code === 'Escape' || event.code === 'Backspace' ? { type: 'back' } : null;
    if (!action || event.repeat && action.type === 'activate') return;
    event.preventDefault();
    this.dispatch(action);
  };

  private point(event: PointerEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  private readonly onPointerMove = (event: PointerEvent) => {
    const { x, y } = this.point(event);
    const row = this.rows.find(candidate => inside(candidate, x, y));
    this.canvas.style.cursor = row ? 'pointer' : 'default';
    if (row && row.index !== this.state.selected) this.dispatch({ type: 'hover', index: row.index });
  };

  private readonly onPointerDown = (event: PointerEvent) => {
    const { x, y } = this.point(event);
    const row = this.rows.find(candidate => inside(candidate, x, y));
    if (!row) return;
    const arrow = row.left && inside(row.left, x, y) ? 'left' : row.right && inside(row.right, x, y) ? 'right' : null;
    if (arrow) {
      this.dispatch({ type: 'hover', index: row.index });
      this.dispatch({ type: arrow });
    } else {
      this.dispatch({ type: 'activate', index: row.index });
    }
  };

  private drawDownload(centre: number, y: number, scale: number): void {
    const c = this.context, d = this.state.download;
    const mb = (bytes: number) => (bytes / 1e6).toFixed(1);
    const fraction = d.phase === 'ready' ? 1 : d.totalBytes > 0 ? Math.min(1, d.loadedBytes / d.totalBytes) : 0;
    const barWidth = Math.min(460 * scale, innerWidth - 32), barHeight = Math.max(6, 8 * scale);
    c.textAlign = 'center';
    let title: string, detail: string;
    if (d.phase === 'code') { title = 'Downloading game…'; detail = ''; }
    else if (d.phase === 'assets') {
      title = `Downloading models and textures  ${Math.floor(fraction * 100)}%`;
      detail = `${mb(d.loadedBytes)} / ${mb(d.totalBytes)} MB  ·  ${d.doneFiles} / ${d.totalFiles} files`;
    } else if (d.phase === 'ready') {
      title = d.failedFiles ? `Ready, with ${d.failedFiles} file${d.failedFiles > 1 ? 's' : ''} missing` : 'Ready';
      detail = d.failedFiles ? 'Missing models or textures will show as placeholders.'
        : `${d.totalFiles} files  ·  ${mb(d.loadedBytes)} MB downloaded`;
    } else { title = 'Download failed'; detail = 'Check your connection, then choose Retry download.'; }
    c.fillStyle = d.phase === 'error' ? '#c4574a' : '#bdb6a1';
    c.font = `700 ${Math.round(17 * scale)}px Arial, sans-serif`;
    c.fillText(title, centre, y);
    if (d.phase !== 'ready' || d.failedFiles) {
      c.fillStyle = '#2b2925'; c.fillRect(centre - barWidth / 2, y + 16 * scale, barWidth, barHeight);
      c.fillStyle = d.phase === 'error' ? '#6e2a22' : '#9b2d22';
      c.fillRect(centre - barWidth / 2, y + 16 * scale, barWidth * fraction, barHeight);
    }
    if (detail) {
      c.fillStyle = '#7d7768'; c.font = `400 ${Math.round(14 * scale)}px Arial, sans-serif`;
      c.fillText(detail, centre, y + 16 * scale + barHeight + 16 * scale);
    }
  }

  readonly render = () => {
    const ratio = Math.min(devicePixelRatio || 1, 2);
    const width = this.canvas.clientWidth || innerWidth, height = this.canvas.clientHeight || innerHeight;
    if (this.canvas.width !== Math.round(width * ratio) || this.canvas.height !== Math.round(height * ratio)) {
      this.canvas.width = Math.round(width * ratio); this.canvas.height = Math.round(height * ratio);
    }
    const c = this.context;
    c.setTransform(ratio, 0, 0, ratio, 0, 0);
    const glow = c.createRadialGradient(width / 2, height * 0.42, 0, width / 2, height * 0.42, Math.max(width, height) * 0.7);
    glow.addColorStop(0, '#2a2420'); glow.addColorStop(0.55, '#141412'); glow.addColorStop(1, '#080808');
    c.fillStyle = glow; c.fillRect(0, 0, width, height);

    const scale = Math.min(1, width / 900, height / 700);
    const centre = width / 2;
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillStyle = '#d8d2bd'; c.font = `700 ${Math.round(92 * scale)}px Georgia, 'Times New Roman', serif`;
    c.fillText('ZOMBONZ', centre, height * 0.22);
    c.fillStyle = '#9b2d22'; c.font = `700 ${Math.round(22 * scale)}px Arial, sans-serif`;
    c.fillText('NACHT DER UNTOTEN', centre, height * 0.22 + 64 * scale);

    this.rows = [];
    const screen = this.state.screen;
    let y = height * (screen === 'main' ? 0.52 : 0.47);
    if (screen === 'multiplayer') {
      c.fillStyle = '#d8d2bd'; c.font = `700 ${Math.round(30 * scale)}px Arial, sans-serif`;
      c.fillText('Multiplayer is on the way', centre, y);
      c.fillStyle = '#a19b88'; c.font = `400 ${Math.round(19 * scale)}px Arial, sans-serif`;
      c.fillText('Player-hosted online co-op is the next milestone. Play Solo for now.', centre, y + 42 * scale);
      y += 110 * scale;
    }
    if (screen === 'loading') {
      c.fillStyle = '#d8d2bd'; c.font = `700 ${Math.round(28 * scale)}px Arial, sans-serif`;
      c.fillText('Starting Nacht der Untoten…', centre, y);
    }
    if (screen === 'main') this.drawDownload(centre, height * 0.22 + 112 * scale, scale);
    const rowHeight = 58 * scale, rowWidth = Math.min(width - 32, (screen === 'settings' ? 560 : 340) * scale);
    menuItems(this.state).forEach((item, index) => {
      const selected = index === this.state.selected;
      const row: Row = { index, x: centre - rowWidth / 2, y: y - rowHeight / 2, width: rowWidth, height: rowHeight };
      if (selected) {
        c.fillStyle = 'rgba(155,45,34,0.35)'; c.fillRect(row.x, row.y, row.width, row.height);
        c.fillStyle = '#9b2d22'; c.fillRect(row.x, row.y, 4, row.height);
      }
      c.fillStyle = item.disabled ? '#4d4a42' : selected ? '#f3ecd6' : '#bdb6a1';
      c.font = `700 ${Math.round(28 * scale)}px Arial, sans-serif`;
      if (item.setting && item.value) {
        c.textAlign = 'left'; c.fillText(item.label, row.x + 24 * scale, y);
        const arrow = 34 * scale, valueRight = row.x + row.width - 16 * scale;
        row.right = { x: valueRight - arrow, y: row.y, width: arrow, height: row.height };
        row.left = { x: valueRight - arrow * 2 - 110 * scale, y: row.y, width: arrow, height: row.height };
        c.textAlign = 'center';
        c.fillText('◀', row.left.x + arrow / 2, y); c.fillText('▶', row.right.x + arrow / 2, y);
        c.fillText(item.value, (row.left.x + arrow + row.right.x) / 2, y);
      } else {
        c.textAlign = 'center'; c.fillText(item.label.toUpperCase(), centre, y);
      }
      this.rows.push(row);
      y += rowHeight + 8 * scale;
    });

    c.textAlign = 'center'; c.fillStyle = '#6f6a5c'; c.font = `400 ${Math.round(15 * scale)}px Arial, sans-serif`;
    const hint = screen === 'settings' ? '↑ ↓ select  ·  ← → or click to adjust  ·  Esc back'
      : screen === 'loading' ? '' : '↑ ↓ select  ·  Enter or click to choose  ·  Esc back';
    c.fillText(hint, centre, height - 48);
    c.textAlign = 'right'; c.fillText(`BUILD ${this.buildId}`, width - 16, height - 18);
  };
}
