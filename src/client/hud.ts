import * as THREE from 'three';
import type { EntityId } from '../core/types.ts';
import type { GameSimulation } from '../core/simulation.ts';
import { weaponName } from '../core/weapon.ts';
import type { FeedbackSnapshot } from './feedback.ts';

export interface HudSnapshot {
  health: number;
  points: number;
  kills: number;
  headshots: number;
  round: number;
  weapon: string;
  magazineAmmo: number;
  reserveAmmo: number;
  holsteredWeapon: string | null;
  reloadTicksRemaining: number;
  grenadeCharges: number;
  roundPhase: string;
  interactionPrompt: string | null;
  nearbyPowerup: string | null;
  bonusStatus: string | null;
  instaKillStatus: string | null;
  gameOver: boolean;
  paused: boolean;
  godMode: boolean;
  noclip: boolean;
  sprinting: boolean;
  aiming: boolean;
  assetNotice?: string | null;
  feedback?: FeedbackSnapshot;
}

export function buildHudSnapshot(
  simulation: GameSimulation,
  playerId: EntityId,
): HudSnapshot | null {
  const player = simulation.getPlayer(playerId);
  if (!player) return null;
  const nearbyDrop = simulation.state.powerups.drops.find(drop => Math.hypot(
    drop.position.x - player.position.x, drop.position.z - player.position.z) < 4
    && Math.abs(drop.position.y - player.position.y) < 2);
  return {
    health: player.health,
    points: player.points,
    kills: player.kills,
    headshots: player.headshots,
    round: Math.max(1, simulation.state.round.round),
    weapon: player.weapon.weaponId,
    magazineAmmo: player.weapon.magazineAmmo,
    reserveAmmo: player.weapon.reserveAmmo,
    holsteredWeapon: player.holsteredWeapon?.weaponId ?? null,
    reloadTicksRemaining: player.weapon.reloadTicksRemaining,
    grenadeCharges: player.grenadeCharges,
    roundPhase: simulation.state.round.phase,
    interactionPrompt: simulation.interactionCandidate(playerId)?.prompt ?? null,
    nearbyPowerup: nearbyDrop ? nearbyDrop.kind === 'maxAmmo' ? 'MAX AMMO'
      : nearbyDrop.kind === 'doublePoints' ? 'DOUBLE POINTS'
        : nearbyDrop.kind === 'instaKill' ? 'INSTA-KILL' : 'NUKE' : null,
    bonusStatus: simulation.state.powerups.doublePointsTicksRemaining > 0
      ? `2X POINTS  ${Math.ceil(simulation.state.powerups.doublePointsTicksRemaining / 60)}s` : null,
    instaKillStatus: simulation.state.powerups.instaKillTicksRemaining > 0
      ? `INSTA-KILL  ${Math.ceil(simulation.state.powerups.instaKillTicksRemaining / 60)}s` : null,
    gameOver: simulation.state.round.phase === 'gameOver',
    paused: false,
    godMode: player.godMode,
    noclip: player.noclip,
    sprinting: player.sprinting,
    aiming: player.aiming,
  };
}
function weaponLabel(id: string): string {
  return weaponName(id).toUpperCase();
}

/** Every CC BY model shown in game, with its creator (full details in ATTRIBUTION.txt). */
export const MODEL_CREDITS: readonly string[] = [
  'Zombie Soldier — Peter_D (@better_peter)', 'Zombie — pxltiger', 'M1911 — Quinn Kuslich', 'Kar98k — ARIA',
  'BAR M1918 A2 — Peanut_Butcher', 'MP40 — Moony_State', 'PPSh-41 — Zillious', 'M1 Garand — YieldingMist206',
  'MG42 — AxelK', 'Mosin-Nagant M91 — Doink', 'M1903 A3 — Gintoki1234', 'Double-barrel — Sebastian Kansik (Pepego)',
  'Winchester M1897 — buh', 'Thompson — Artem.Goyko', 'Revolver .357 — Artem.Goyko', 'STG-44 — Arbuzz747',
  'FG42 — Shorty_Digitan', 'M1 Carbine — roelandvermeulen', 'M14 — ecler', 'FN FAL — MoraAzul',
  'XM177E1 — Bazylonator', 'AKS-74u — dan741vlasov', 'MP5K — davidthe19th', 'Vz.61 Skorpion — Maxim_Van_Daele',
  'RPK-74M — petresco', 'SPAS-12 — FameProductions', 'Ithaca 37 — I.sln', 'Colt Python — HYQQM',
  'RPG-7 — javadbayat', 'Signal flare pistol (Irrlicht) — ChickenHatMan', 'Diesel punk USSR gun (Molniya) — Silversem',
];

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
    if (snapshot.feedback?.damageVignette || snapshot.health <= 50) {
      const edge = this.context.createRadialGradient(width / 2, height / 2, height * 0.24,
        width / 2, height / 2, width * 0.67);
      edge.addColorStop(0, 'rgba(80,0,0,0)');
      edge.addColorStop(1, snapshot.feedback?.damageVignette ? 'rgba(150,0,0,0.67)' : 'rgba(100,0,0,0.32)');
      this.context.fillStyle = edge; this.context.fillRect(0, 0, width, height);
    }
    this.text('NACHT DER UNTOTEN', width / 2, 38, 19, 'center');
    this.text('F2 ASSET CREDITS', width / 2, 64, 13, 'center');
    if (snapshot.assetNotice) this.text(snapshot.assetNotice, width / 2, height - 80, 19, 'center');
    if (!snapshot.gameOver) {
      const mark = snapshot.feedback?.hitMarker;
      if (mark) {
        const x = width / 2, y = height / 2;
        this.context.strokeStyle = mark === 'head' ? '#e6c36d' : mark === 'kill' ? '#df604a' : '#e5e5dd';
        this.context.lineWidth = mark === 'kill' ? 5 : 3;
        this.context.beginPath();
        for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          this.context.moveTo(x + dx * 8, y + dy * 8);
          this.context.lineTo(x + dx * 19, y + dy * 19);
        }
        this.context.stroke();
      } else if (!snapshot.aiming) {
        this.context.fillStyle = 'rgba(244,241,231,0.75)';
        this.context.fillRect(width / 2 - 2, height / 2 - 2, 4, 4);
      }
    }
    this.text(`ROUND ${snapshot.round}`, 48, 58, 42);
    if (snapshot.roundPhase === 'intermission') this.text('INTERMISSION', 48, 100, 22);
    const modes = [snapshot.godMode ? 'GOD MODE [G]' : '', snapshot.noclip ? 'NOCLIP [F]' : ''].filter(Boolean);
    if (modes.length) this.text(modes.join('   /   '), 48, 105, 23);
    if (snapshot.noclip) this.text('WASD fly · SPACE up · C down', 48, 140, 20);
    this.text(`HP ${snapshot.health}`, 48, height - 54, 36);
    this.text(`T  GRENADES ${snapshot.grenadeCharges}`, 48, height - 95, 20);
    this.text(String(snapshot.points), width - 48, height - 92, 44, 'right');
    if (snapshot.bonusStatus) this.text(snapshot.bonusStatus, width - 48, height - 226, 23, 'right');
    if (snapshot.instaKillStatus) this.text(snapshot.instaKillStatus, width - 48, height - 256, 23, 'right');
    this.text(weaponLabel(snapshot.weapon), width - 48, height - 50, 26, 'right');
    this.text(`${snapshot.magazineAmmo} / ${snapshot.reserveAmmo}`, width - 48, height - 20, 30, 'right');
    if (snapshot.holsteredWeapon) this.text(`Q  ${weaponLabel(snapshot.holsteredWeapon)}`, width - 48, height - 130, 20, 'right');
    if (snapshot.reloadTicksRemaining > 0) this.text('RELOADING', width - 48, height - 169, 18, 'right');
    else if (snapshot.magazineAmmo === 0) this.text(snapshot.reserveAmmo > 0 ? 'R  RELOAD' : 'OUT OF AMMO', width - 48, height - 169, 18, 'right');
    if (snapshot.feedback?.message && !snapshot.gameOver) this.text(snapshot.feedback.message, width / 2, height * 0.60, 27, 'center');
    this.text('WASD MOVE   •   SHIFT SPRINT   •   RMB AIM   •   V KNIFE   •   T GRENADE   •   R RELOAD   •   Q SWITCH   •   M MUTE', width / 2, height - 22, 15, 'center');

    if (snapshot.gameOver) {
      this.context.fillStyle = 'rgba(0,0,0,0.58)';
      this.context.fillRect(0, 0, width, height);
      this.text('GAME OVER', width / 2, height * 0.44, 72, 'center');
      this.text(`ROUND ${snapshot.round}   •   ${snapshot.kills} KILLS   •   ${snapshot.headshots} HEADSHOTS`,
        width / 2, height * 0.54, 26, 'center');
      this.text(`${snapshot.points} POINTS`, width / 2, height * 0.60, 27, 'center');
      this.text('PRESS ENTER TO RESTART', width / 2, height * 0.68, 30, 'center');
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
    if (snapshot.nearbyPowerup && !snapshot.gameOver) this.text(snapshot.nearbyPowerup,
      width / 2, height * 0.65, 28, 'center');
    if (snapshot.paused && !snapshot.gameOver) {
      this.context.fillStyle = 'rgba(0,0,0,0.62)';
      this.context.fillRect(0, 0, width, height);
      this.text('PAUSED', width / 2, height * 0.44, 68, 'center');
      this.text('CLICK TO RESUME', width / 2, height * 0.53, 30, 'center');
    }
    if (this.credits) {
      this.context.fillStyle = 'rgba(0,0,0,0.9)'; this.context.fillRect(180, 115, 1240, 540);
      this.text('THIRD-PARTY ASSET CREDITS', width / 2, 160, 30, 'center');
      // Wrap the creator list to the panel so every model stays credited as the arsenal grows.
      this.context.font = '700 18px Arial, sans-serif';
      const lines: string[] = [];
      for (const credit of MODEL_CREDITS) {
        const line = lines.length ? `${lines[lines.length - 1]} · ${credit}` : credit;
        if (lines.length && this.context.measureText(line).width <= 1180) lines[lines.length - 1] = line;
        else lines.push(credit);
      }
      lines.forEach((line, index) => this.text(line, width / 2, 205 + index * 28, 18, 'center'));
      const footer = ['Characters / weapons: CC BY 4.0 · converted and adapted',
        'Environment / props: Poly Haven, ambientCG, OpenGameArt · CC0',
        'Source links and licence: /assets/ATTRIBUTION.txt', 'F2 TO CLOSE'];
      footer.forEach((line, index) => this.text(line, width / 2, 215 + lines.length * 28 + index * 34, 21, 'center'));
    }
    this.texture.needsUpdate = true;
  }

  render(snapshot: HudSnapshot): void {
    if (!this.previous || (Object.keys(snapshot) as (keyof HudSnapshot)[])
      .some(key => key === 'feedback'
        ? snapshot.feedback?.message !== this.previous!.feedback?.message
          || snapshot.feedback?.hitMarker !== this.previous!.feedback?.hitMarker
          || snapshot.feedback?.damageVignette !== this.previous!.feedback?.damageVignette
        : snapshot[key] !== this.previous![key])) {
      this.draw(snapshot);
      this.previous = { ...snapshot, feedback: snapshot.feedback && { ...snapshot.feedback } };
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
