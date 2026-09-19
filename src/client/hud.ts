import * as THREE from 'three';
import type { EntityId } from '../core/types.ts';
import type { GameSimulation } from '../core/simulation.ts';

export interface HudSnapshot {
  health: number;
  points: number;
  round: number;
  weapon: string;
  magazineAmmo: number;
  reserveAmmo: number;
  interactionPrompt: string | null;
  gameOver: boolean;
  godMode: boolean;
  noclip: boolean;
  assetNotice?: string | null;
}

export function buildHudSnapshot(
  simulation: GameSimulation,
  playerId: EntityId,
): HudSnapshot | null {
  const player = simulation.getPlayer(playerId);
  if (!player) return null;
  return {
    health: player.health,
    points: player.points,
    round: Math.max(1, simulation.state.round.round),
    weapon: player.weapon.weaponId,
    magazineAmmo: player.weapon.magazineAmmo,
    reserveAmmo: player.weapon.reserveAmmo,
    interactionPrompt: simulation.interactionCandidate(playerId)?.prompt ?? null,
    gameOver: simulation.state.round.phase === 'gameOver',
    godMode: player.godMode,
    noclip: player.noclip,
  };
}
function weaponLabel(id: string): string {
  if (id === 'kar98k') return 'KAR98K';
  if (id === 'starter-pistol') return 'M1911';
  return id.replace(/[-_]/g, ' ').toUpperCase();
}

export class CanvasHud {
  private previous: HudSnapshot | null = null;
  private credits = false;
  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (event.code === 'F2' && !event.repeat) { event.preventDefault(); this.credits = !this.credits; this.previous = null; }
  };
  private readonly canvas = document.createElement('canvas');
  private readonly context: CanvasRenderingContext2D;
  private readonly texture: THREE.CanvasTexture;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 2);
  private readonly material: THREE.MeshBasicMaterial;

  constructor(private readonly renderer: THREE.WebGLRenderer) {
    if (typeof window !== 'undefined') window.addEventListener('keydown', this.onKeyDown);
    this.canvas.width = 1600;
    this.canvas.height = 900;
    const context = this.canvas.getContext('2d');
    if (!context) throw new Error('Unable to create HUD canvas context.');
    this.context = context;
    this.camera.position.z = 1;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.generateMipmaps = false;
    this.texture.minFilter = THREE.LinearFilter;
    this.material = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    quad.frustumCulled = false;
    this.scene.add(quad);
  }

  private text(
    value: string,
    x: number,
    y: number,
    size: number,
    align: CanvasTextAlign = 'left',
  ): void {
    this.context.font = `700 ${size}px Arial, sans-serif`;
    this.context.textAlign = align;
    this.context.textBaseline = 'middle';
    this.context.lineWidth = Math.max(3, size * 0.12);
    this.context.strokeStyle = 'rgba(0,0,0,0.82)';
    this.context.strokeText(value, x, y);
    this.context.fillStyle = 'rgba(244,241,231,0.96)';
    this.context.fillText(value, x, y);
  }

  private draw(snapshot: HudSnapshot): void {
    const { width, height } = this.canvas;
    this.context.clearRect(0, 0, width, height);
    this.text('NACHT DER UNTOTEN', width / 2, 38, 19, 'center');
    this.text('F2 ASSET CREDITS', width / 2, 64, 13, 'center');
    if (snapshot.assetNotice) this.text(snapshot.assetNotice, width / 2, height - 80, 19, 'center');
    if (!snapshot.gameOver) {
      this.context.fillStyle = 'rgba(244,241,231,0.75)';
      this.context.fillRect(width / 2 - 2, height / 2 - 2, 4, 4);
    }
    this.text(`ROUND ${snapshot.round}`, 48, 58, 42);
    const modes = [snapshot.godMode ? 'GOD MODE [G]' : '', snapshot.noclip ? 'NOCLIP [F]' : ''].filter(Boolean);
    if (modes.length) this.text(modes.join('   /   '), 48, 105, 23);
    if (snapshot.noclip) this.text('WASD fly · SPACE up · C down', 48, 140, 20);
    this.text(`HP ${snapshot.health}`, 48, height - 54, 36);
    this.text(String(snapshot.points), width - 48, height - 92, 44, 'right');
    this.text(weaponLabel(snapshot.weapon), width - 48, height - 50, 26, 'right');
    this.text(`${snapshot.magazineAmmo} / ${snapshot.reserveAmmo}`, width - 48, height - 20, 30, 'right');

    if (snapshot.gameOver) {
      this.context.fillStyle = 'rgba(0,0,0,0.58)';
      this.context.fillRect(0, 0, width, height);
      this.text('GAME OVER', width / 2, height * 0.44, 72, 'center');
      this.text('PRESS ENTER TO RESTART', width / 2, height * 0.54, 30, 'center');
    }

    if (snapshot.interactionPrompt) {
      this.context.font = '700 30px Arial, sans-serif';
      const promptWidth = this.context.measureText(snapshot.interactionPrompt).width + 44;
      const x = width / 2;
      const y = height * 0.74;
      this.context.fillStyle = 'rgba(0,0,0,0.58)';
      this.context.fillRect(x - promptWidth / 2, y - 29, promptWidth, 58);
      this.text(snapshot.interactionPrompt, x, y, 30, 'center');
    }
    if (this.credits) {
      this.context.fillStyle = 'rgba(0,0,0,0.9)'; this.context.fillRect(220, 160, 1160, 480);
      const lines = ['THIRD-PARTY ASSET CREDITS', 'Zombie Soldier — Peter_D (@better_peter)',
        'Zombie — pxltiger', 'M1911 — Quinn Kuslich', 'Kar98k — ARIA', 'BAR M1918 A2 — Peanut_Butcher',
        'All models: CC BY 4.0 · converted, resized and adapted for this game',
        'Source links and licence: /assets/ATTRIBUTION.txt', 'F2 TO CLOSE'];
      lines.forEach((line, index) => this.text(line, width / 2, 210 + index * 46, index === 0 ? 30 : 23, 'center'));
    }
    this.texture.needsUpdate = true;
  }

  render(snapshot: HudSnapshot): void {
    if (!this.previous || (Object.keys(snapshot) as (keyof HudSnapshot)[])
      .some(key => snapshot[key] !== this.previous![key])) {
      this.draw(snapshot);
      this.previous = { ...snapshot };
    }
    this.renderer.clearDepth();
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    if (typeof window !== 'undefined') window.removeEventListener('keydown', this.onKeyDown);
    this.material.dispose();
    this.texture.dispose();
  }
}
