import * as THREE from 'three';
import type { EntityId } from '../core/types.ts';
import type { GameSimulation } from '../core/simulation.ts';
import { weaponName } from '../core/weapon.ts';
import { maxPlayerHealth } from '../core/health.ts';
import { reviveProgress } from '../core/downs.ts';
import type { PerkId } from '../core/perks.ts';
import type { GameAction } from '../core/input.ts';
import { DEFAULT_KEY_BINDINGS, actionKeyLabel, type KeyBindings } from './bindings.ts';

/** WaW's perk colours: Jugger-Nog red, Double Tap amber, Speed Cola green, Quick Revive blue. */
const PERK_ICONS: Readonly<Record<PerkId, { fill: string; mark: string }>> = {
  juggernog: { fill: 'rgba(150,24,24,0.9)', mark: 'JN' },
  'double-tap': { fill: 'rgba(176,104,20,0.9)', mark: 'DT' },
  'speed-cola': { fill: 'rgba(32,120,40,0.9)', mark: 'SC' },
  'quick-revive': { fill: 'rgba(30,86,160,0.9)', mark: 'QR' },
};
import type { FeedbackSnapshot } from './feedback.ts';
import { loadUiFonts, TITLE_FONT, UI_FONT } from './fonts.ts';
import { Crosshair, NukeFlash, PointsPopups, RoundCounter, type HudLayout } from './hudEffects.ts';
import type { SimulationEvent } from '../core/simulation.ts';

export interface HudSnapshot {
  health: number;
  maxHealth: number;
  /** Perk-a-colas drunk, in order and comma-joined (a string, so an unchanged list skips the repaint). */
  perks: string;
  points: number;
  kills: number;
  headshots: number;
  round: number;
  weapon: string;
  magazineAmmo: number;
  reserveAmmo: number;
  holsteredWeapon: string | null;
  /**
   * Only whether a reload is running: the HUD repaints and re-uploads its whole canvas when any field
   * changes, so a per-tick countdown here would repaint every frame of every reload.
   */
  reloading: boolean;
  grenadeCharges: number;
  roundPhase: string;
  interactionPrompt: string | null;
  /** In last stand: "BLEEDING OUT 24" or "GETTING BACK UP". */
  lastStand: string | null;
  /** A revive under way, by or on this player: 0 to 1 in twentieths (so the canvas repaints rarely). */
  reviveProgress: number;
  nearbyPowerup: string | null;
  bonusStatus: string | null;
  instaKillStatus: string | null;
  gameOver: boolean;
  /** Teammates in a co-op game, one per line: name, points, and whether they are down or out. */
  team: string;
  /** Round-trip time to the host, for a client in a co-op game. */
  pingMs: number | null;
  /** False for a co-op client: only the host restarts. */
  canRestart: boolean;
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
  names?: ReadonlyMap<EntityId, string>,
): HudSnapshot | null {
  const player = simulation.getPlayer(playerId);
  if (!player) return null;
  // The revive this player is receiving, or giving to the teammate they are holding use beside.
  const patient = player.downed ? player : simulation.players().find(other => other.downed?.reviverId === player.id);
  const revive = patient?.downed && (patient.downed.reviveTicks > 0)
    ? reviveProgress(patient.downed, patient.downed.selfRevive ? undefined : simulation.getPlayer(patient.downed.reviverId!) ?? undefined) : 0;
  const nearbyDrop = simulation.state.powerups.drops.find(drop => Math.hypot(
    drop.position.x - player.position.x, drop.position.z - player.position.z) < 4
    && Math.abs(drop.position.y - player.position.y) < 2);
  return {
    health: player.health,
    maxHealth: maxPlayerHealth(player),
    perks: player.perks.join(','),
    points: player.points,
    kills: player.kills,
    headshots: player.headshots,
    round: Math.max(1, simulation.state.round.round),
    weapon: player.weapon.weaponId,
    magazineAmmo: player.weapon.magazineAmmo,
    reserveAmmo: player.weapon.reserveAmmo,
    holsteredWeapon: player.holsteredWeapon?.weaponId ?? null,
    reloading: player.weapon.reloadTicksRemaining > 0,
    grenadeCharges: player.grenadeCharges,
    roundPhase: simulation.state.round.phase,
    interactionPrompt: simulation.interactionCandidate(playerId)?.prompt ?? null,
    lastStand: player.downed ? player.downed.selfRevive ? 'GETTING BACK UP'
      : `BLEEDING OUT  ${Math.ceil(player.downed.bleedoutTicks / 60)}` : null,
    reviveProgress: Math.round(revive * 20) / 20,
    nearbyPowerup: nearbyDrop ? nearbyDrop.kind === 'maxAmmo' ? 'MAX AMMO'
      : nearbyDrop.kind === 'doublePoints' ? 'DOUBLE POINTS'
        : nearbyDrop.kind === 'instaKill' ? 'INSTA-KILL' : nearbyDrop.kind === 'carpenter' ? 'CARPENTER' : 'NUKE' : null,
    bonusStatus: simulation.state.powerups.doublePointsTicksRemaining > 0
      ? `2X POINTS  ${Math.ceil(simulation.state.powerups.doublePointsTicksRemaining / 60)}s` : null,
    instaKillStatus: simulation.state.powerups.instaKillTicksRemaining > 0
      ? `INSTA-KILL  ${Math.ceil(simulation.state.powerups.instaKillTicksRemaining / 60)}s` : null,
    gameOver: simulation.state.round.phase === 'gameOver',
    team: names ? simulation.players().filter(other => other.id !== playerId && !simulation.state.leftPlayers.includes(other.id))
      .map(other => [names.get(other.id) ?? 'Player', other.points, !other.alive ? 'OUT' : other.downed ? 'DOWN' : ''].join('\t'))
      .join('\n') : '',
    pingMs: null,
    canRestart: true,
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

/** The deployed commit (set by the Pages workflow), so players can report which build they are on. */
const BUILD_ID: string = (import.meta.env.VITE_BUILD_ID as string | undefined)?.slice(0, 7) ?? 'local';

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
  'Vintage Vending Machine (perk machines) — cansuaydin', 'WW2 US Army Ranger (teammates) — Tactical_Beard',
];

const INK = '#ece4cf';
const DIM = 'rgba(236,228,207,0.6)';
const FAINT = 'rgba(236,228,207,0.4)';
const GOLD = '#f2c55c';
const BLOOD = '#d8382b';
const PANEL = 'rgba(10,9,8,0.64)';
const EDGE = 'rgba(236,228,207,0.2)';
/** The HUD is laid out on a 900-unit-tall virtual screen; its width follows the window's aspect ratio. */
const LAYOUT_HEIGHT = 900;
/** Caps the HUD canvas so a repaint's texture upload stays bounded on very large screens. */
const MAX_HUD_WIDTH = 2560;
const GRENADE_SLOTS = 4;
const CONTROLS = 'WASD MOVE  ·  SHIFT SPRINT  ·  RMB AIM  ·  V KNIFE  ·  T GRENADE  ·  R RELOAD  ·  Q / WHEEL SWITCH  ·  M MUTE';

interface TextStyle {
  size: number;
  font?: 'ui' | 'title';
  weight?: 400 | 500 | 700;
  color?: string;
  align?: CanvasTextAlign;
  /** Letter spacing in layout units. */
  spacing?: number;
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
  private readonly bufferSize = new THREE.Vector2();
  private layout: HudLayout = { width: 1600, height: LAYOUT_HEIGHT, scale: 1 };
  /** Where the points counter's text starts, so score popups fly off its left edge. */
  private pointsEdge = { x: 1400, y: LAYOUT_HEIGHT - 178 };
  private readonly popups: PointsPopups;
  private readonly roundCounter: RoundCounter;
  private readonly crosshair: Crosshair;
  private readonly nukeFlash: NukeFlash;

  constructor(private readonly renderer: THREE.WebGLRenderer, private readonly mapName = 'Bunker',
    private readonly bindings: KeyBindings = DEFAULT_KEY_BINDINGS) {
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
    this.roundCounter = new RoundCounter(this.scene);
    this.popups = new PointsPopups(this.scene);
    this.crosshair = new Crosshair(this.scene);
    this.nukeFlash = new NukeFlash(this.scene);
    // The first frames draw with fallback fonts; repaint once the bundled ones are ready.
    void loadUiFonts().then(() => { this.previous = null; });
  }

  /** Matches the canvas to the drawing buffer, so the HUD is drawn 1:1 with screen pixels, not stretched. */
  private fit(): boolean {
    const size = this.renderer.getDrawingBufferSize?.(this.bufferSize);
    if (!size || size.x <= 0 || size.y <= 0) return false;
    const shrink = Math.min(1, MAX_HUD_WIDTH / size.x);
    const width = Math.round(size.x * shrink), height = Math.round(size.y * shrink);
    if (width === this.canvas.width && height === this.canvas.height) return false;
    this.canvas.width = width; this.canvas.height = height;
    // Frees the old GPU texture; the next upload allocates one at the new size.
    this.texture.dispose();
    return true;
  }

  private font(style: TextStyle): string {
    const title = style.font === 'title';
    return `${style.weight ?? (title ? 400 : 700)} ${style.size}px ${title ? TITLE_FONT : UI_FONT}`;
  }

  /** Draws shadowed text (no hard outline) and returns its width. */
  private text(value: string, x: number, y: number, style: TextStyle): number {
    const c = this.context;
    c.font = this.font(style);
    c.textAlign = style.align ?? 'left';
    c.textBaseline = 'middle';
    c.letterSpacing = `${style.spacing ?? 0}px`;
    c.shadowColor = 'rgba(0,0,0,0.85)';
    c.shadowBlur = Math.max(3, style.size * 0.2);
    c.shadowOffsetY = Math.max(1, style.size * 0.05);
    c.fillStyle = style.color ?? INK;
    c.fillText(value, x, y);
    const width = c.measureText(value).width;
    c.shadowColor = 'transparent'; c.shadowBlur = 0; c.shadowOffsetY = 0; c.letterSpacing = '0px';
    return width;
  }

  private measure(value: string, style: TextStyle): number {
    const c = this.context;
    c.font = this.font(style);
    c.letterSpacing = `${style.spacing ?? 0}px`;
    const width = c.measureText(value).width;
    c.letterSpacing = '0px';
    return width;
  }

  private panel(x: number, y: number, width: number, height: number, radius: number,
    fill = PANEL, stroke: string | null = EDGE): void {
    const c = this.context;
    c.beginPath();
    if (c.roundRect) c.roundRect(x, y, width, height, radius); else c.rect(x, y, width, height);
    c.fillStyle = fill; c.fill();
    if (stroke) { c.strokeStyle = stroke; c.lineWidth = 1.5; c.stroke(); }
  }

  /** A key hint drawn as a small keycap; x is its left edge. Returns its width. */
  private keycap(key: string, x: number, y: number, size: number): number {
    const width = Math.max(size * 1.5, this.measure(key, { size }) + size * 0.8), height = size * 1.5;
    this.panel(x, y - height / 2, width, height, 5, 'rgba(236,228,207,0.12)', 'rgba(236,228,207,0.55)');
    this.text(key, x + width / 2, y + 1, { size, align: 'center' });
    return width;
  }

  /** A rule with fading ends, under overlay titles. */
  private rule(x: number, y: number, width: number, color: string): void {
    const c = this.context, gradient = c.createLinearGradient(x - width / 2, 0, x + width / 2, 0);
    gradient.addColorStop(0, 'rgba(0,0,0,0)'); gradient.addColorStop(0.5, color); gradient.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = gradient; c.fillRect(x - width / 2, y - 1, width, 2);
  }

  private overlay(width: number, height: number, strength: number): void {
    const c = this.context;
    const shade = c.createRadialGradient(width / 2, height / 2, height * 0.1, width / 2, height / 2, width * 0.75);
    shade.addColorStop(0, `rgba(8,6,5,${strength * 0.8})`);
    shade.addColorStop(1, `rgba(0,0,0,${Math.min(0.95, strength * 1.25)})`);
    c.fillStyle = shade; c.fillRect(0, 0, width, height);
  }

  private draw(snapshot: HudSnapshot): void {
    const c = this.context, scale = this.canvas.height / LAYOUT_HEIGHT;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, this.canvas.width, this.canvas.height);
    c.setTransform(scale, 0, 0, scale, 0, 0);
    const width = this.canvas.width / scale, height = LAYOUT_HEIGHT, centre = width / 2, right = width - 44;
    this.layout = { width, height, scale };
    if (snapshot.feedback?.damageVignette || snapshot.health <= 50) {
      const edge = c.createRadialGradient(centre, height / 2, height * 0.24, centre, height / 2, width * 0.67);
      edge.addColorStop(0, 'rgba(80,0,0,0)');
      edge.addColorStop(1, snapshot.feedback?.damageVignette ? 'rgba(150,0,0,0.67)' : 'rgba(100,0,0,0.32)');
      c.fillStyle = edge; c.fillRect(0, 0, width, height);
    }

    // Top: the map, the credits key and the controls, kept quiet.
    this.text(this.mapName.toUpperCase(), 40, 40, { size: 22, font: 'title', color: DIM });
    this.text('F2  CREDITS', 42, 66, { size: 13, weight: 500, color: FAINT, spacing: 2 });
    // The controls line only fits clear of the map name on wider screens.
    const controls: TextStyle = { size: 13, weight: 500, color: FAINT, align: 'center', spacing: 1.5 };
    if (!snapshot.paused && centre - this.measure(CONTROLS, controls) / 2 > 280) this.text(CONTROLS, centre, 26, controls);
    const key = (action: GameAction) => actionKeyLabel(this.bindings, action);
    const modes = [snapshot.godMode ? `GOD MODE [${key('toggleGodMode')}]` : '', snapshot.noclip ? `NOCLIP [${key('toggleNoclip')}]` : ''].filter(Boolean);
    if (modes.length) this.text(modes.join('   /   '), 42, 98, { size: 18, color: GOLD, spacing: 1 });
    if (snapshot.noclip) this.text(`WASD fly · ${key('flyUp')} up · ${key('flyDown')} down`, 42, 124, { size: 16, weight: 500, color: DIM });
    // Top right: active power-ups as badges.
    let badgeY = 46;
    for (const status of [snapshot.bonusStatus, snapshot.instaKillStatus]) {
      if (!status) continue;
      const badgeWidth = this.measure(status, { size: 19, spacing: 2 }) + 32;
      this.panel(right - badgeWidth, badgeY - 19, badgeWidth, 38, 19, 'rgba(60,44,10,0.7)', 'rgba(242,197,92,0.6)');
      this.text(status, right - badgeWidth / 2, badgeY + 1, { size: 19, color: GOLD, align: 'center', spacing: 2 });
      badgeY += 48;
    }

    if (!snapshot.gameOver) {
      const mark = snapshot.feedback?.hitMarker;
      c.shadowColor = 'rgba(0,0,0,0.8)'; c.shadowBlur = 3;
      if (mark) {
        const x = centre, y = height / 2;
        c.strokeStyle = mark === 'head' ? GOLD : mark === 'kill' ? BLOOD : INK;
        c.lineWidth = mark === 'kill' ? 4 : 2.5; c.lineCap = 'round';
        c.beginPath();
        for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          c.moveTo(x + dx * 8, y + dy * 8);
          c.lineTo(x + dx * 18, y + dy * 18);
        }
        c.stroke();
      }
      c.shadowColor = 'transparent'; c.shadowBlur = 0;
    }

    // Bottom left: the round (an animated RoundCounter quad, drawn over this canvas) above health and grenades.
    if (snapshot.roundPhase === 'intermission') this.text('INTERMISSION', 44, height - 184, { size: 16, color: GOLD, spacing: 4 });
    this.text('ROUND', 44, height - 158, { size: 16, weight: 500, color: DIM, spacing: 5 });
    const low = snapshot.health <= 50;
    this.text('HP', 44, height - 36, { size: 15, weight: 500, color: DIM, spacing: 2 });
    this.panel(74, height - 41, 180, 10, 5, 'rgba(0,0,0,0.55)', EDGE);
    const healthWidth = 180 * Math.max(0, Math.min(1, snapshot.health / snapshot.maxHealth));
    // Perk icons sit in a row above the round counter, in the order they were drunk.
    (snapshot.perks ? snapshot.perks.split(',') as PerkId[] : []).forEach((perk, index) => {
      const style = PERK_ICONS[perk], x = 44 + index * 46, y = height - 250;
      this.panel(x, y, 38, 38, 8, style.fill, 'rgba(255,255,255,0.35)');
      this.text(style.mark, x + 19, y + 20, { size: 17, color: '#fff7e6', align: 'center' });
    });
    if (healthWidth > 0) this.panel(74, height - 41, healthWidth, 10, 5, low ? BLOOD : INK, null);
    this.text(String(snapshot.health), 266, height - 36, { size: 17, color: low ? BLOOD : INK });
    let grenadeX = 318 + this.keycap('T', 318, height - 36, 13) + 12;
    for (let slot = 0; slot < GRENADE_SLOTS; slot++, grenadeX += 20) {
      c.beginPath(); c.arc(grenadeX + 6, height - 36, 6, 0, Math.PI * 2);
      if (slot < snapshot.grenadeCharges) { c.fillStyle = GOLD; c.fill(); }
      else { c.strokeStyle = FAINT; c.lineWidth = 1.5; c.stroke(); }
    }

    // Bottom right: points in gold over the weapon, its ammunition and the holstered gun.
    const pointsWidth = this.text(String(snapshot.points), right, height - 178, { size: 46, color: GOLD, align: 'right' });
    // Teammates' points stack above this player's, as in World at War.
    snapshot.team.split('\n').filter(Boolean).forEach((row, index) => {
      const [name, points, status] = row.split('\t');
      const y = height - 232 - index * 30;
      this.text(`${name}  ${points}`, right, y, { size: 20, weight: 500, color: status ? DIM : INK, align: 'right', spacing: 1 });
      if (status) this.text(status, right - this.measure(`${name}  ${points}`, { size: 20, weight: 500, spacing: 1 }) - 12, y,
        { size: 16, color: BLOOD, align: 'right', spacing: 2 });
    });
    if (snapshot.pingMs !== null) this.text(`PING ${Math.round(snapshot.pingMs)} MS`, right, 22, { size: 13, color: DIM, align: 'right', spacing: 2 });
    this.pointsEdge = { x: right - pointsWidth - 10, y: height - 178 };
    // A reload shows in the gun's animation and sound, not in words; an empty magazine still gets its prompt.
    if (!snapshot.reloading && snapshot.magazineAmmo === 0) {
      this.text(snapshot.reserveAmmo > 0 ? 'R  RELOAD' : 'OUT OF AMMO', right, height - 138,
        { size: 16, color: snapshot.reserveAmmo > 0 ? GOLD : BLOOD, align: 'right', spacing: 3 });
    }
    this.text(weaponLabel(snapshot.weapon), right, height - 108, { size: 20, weight: 500, color: DIM, align: 'right', spacing: 3 });
    const reserveWidth = this.text(` / ${snapshot.reserveAmmo}`, right, height - 56,
      { size: 26, weight: 500, color: DIM, align: 'right' });
    this.text(String(snapshot.magazineAmmo), right - reserveWidth, height - 60,
      { size: 56, color: snapshot.magazineAmmo === 0 ? BLOOD : INK, align: 'right' });
    if (snapshot.holsteredWeapon) {
      const name = weaponLabel(snapshot.holsteredWeapon);
      const nameWidth = this.measure(name, { size: 14, weight: 500, spacing: 2 });
      this.text(name, right, height - 20, { size: 14, weight: 500, color: FAINT, align: 'right', spacing: 2 });
      this.keycap('Q', right - nameWidth - 34, height - 20, 11);
    }

    // Centre: notices, pickups and the interaction prompt.
    if (snapshot.assetNotice) this.text(snapshot.assetNotice, centre, height - 110, { size: 17, weight: 500, color: DIM, align: 'center' });
    if (snapshot.feedback?.message && !snapshot.gameOver) {
      this.text(snapshot.feedback.message, centre, height * 0.6, { size: 30, align: 'center', spacing: 3 });
    }
    if (snapshot.nearbyPowerup && !snapshot.gameOver) {
      this.text(snapshot.nearbyPowerup, centre, height * 0.655, { size: 28, color: GOLD, align: 'center', spacing: 3 });
    }
    if (snapshot.lastStand && !snapshot.gameOver) {
      this.text(snapshot.lastStand, centre, height * 0.3, { size: 34, color: BLOOD, align: 'center', spacing: 4 });
    }
    if (snapshot.reviveProgress > 0 && !snapshot.gameOver) {
      const barWidth = 320, y = height * 0.66;
      this.text(snapshot.lastStand ? 'BEING REVIVED' : 'REVIVING', centre, y - 20, { size: 18, color: INK, align: 'center', spacing: 3 });
      this.panel(centre - barWidth / 2, y, barWidth, 12, 6, 'rgba(0,0,0,0.6)', EDGE);
      this.panel(centre - barWidth / 2, y, barWidth * snapshot.reviveProgress, 12, 6, INK, null);
    }
    if (snapshot.interactionPrompt) {
      // "E  Buy this" prompts lead with the key; show it as a keycap.
      const keyed = /^E\s{2}(.*)$/.exec(snapshot.interactionPrompt);
      const label = keyed ? keyed[1] : snapshot.interactionPrompt;
      const style: TextStyle = { size: 24, weight: 500, spacing: 0.5 };
      const keyWidth = keyed ? 16 * 1.5 + 14 : 0;
      const promptWidth = this.measure(label, style) + keyWidth + 48, y = height * 0.74;
      const left = centre - promptWidth / 2;
      this.panel(left, y - 27, promptWidth, 54, 10);
      if (keyed) this.keycap('E', left + 24, y, 16);
      this.text(label, left + 24 + keyWidth, y + 1, style);
    }

    if (snapshot.gameOver) {
      this.overlay(width, height, 0.7);
      this.text('GAME OVER', centre, height * 0.38, { size: 104, font: 'title', color: BLOOD, align: 'center' });
      this.rule(centre, height * 0.46, 520, 'rgba(216,56,43,0.8)');
      this.text(`ROUND ${snapshot.round}   ·   ${snapshot.kills} KILLS   ·   ${snapshot.headshots} HEADSHOTS`,
        centre, height * 0.52, { size: 24, weight: 500, align: 'center', spacing: 3 });
      this.text(`${snapshot.points} POINTS`, centre, height * 0.58, { size: 30, color: GOLD, align: 'center', spacing: 2 });
      this.text(snapshot.canRestart ? 'PRESS ENTER TO RESTART' : 'WAITING FOR THE HOST TO RESTART', centre, height * 0.68,
        { size: 22, color: DIM, align: 'center', spacing: 5 });
    }
    if (this.credits) {
      const panelWidth = Math.min(1240, width - 80), left = centre - panelWidth / 2;
      const body: TextStyle = { size: 17, weight: 500 };
      // Wrap the creator list to the panel so every model stays credited as the arsenal grows.
      const lines: string[] = [];
      for (const credit of MODEL_CREDITS) {
        const line = lines.length ? `${lines[lines.length - 1]} · ${credit}` : credit;
        if (lines.length && this.measure(line, body) <= panelWidth - 60) lines[lines.length - 1] = line;
        else lines.push(credit);
      }
      const footer = ['Characters / weapons: CC BY 4.0 · converted and adapted',
        'Environment / props: Poly Haven, ambientCG, OpenGameArt · CC0',
        'Fonts: Oswald (SIL OFL 1.1) · Special Elite (Apache 2.0)',
        'Source links and licence: assets/ATTRIBUTION.txt', `F2 TO CLOSE  ·  BUILD ${BUILD_ID}`];
      const panelHeight = 140 + lines.length * 28 + footer.length * 30;
      const top = (height - panelHeight) / 2;
      this.panel(left, top, panelWidth, panelHeight, 12, 'rgba(8,7,6,0.92)');
      this.text('THIRD-PARTY ASSET CREDITS', centre, top + 44, { size: 30, font: 'title', align: 'center' });
      this.rule(centre, top + 72, 420, 'rgba(216,56,43,0.8)');
      lines.forEach((line, index) => this.text(line, centre, top + 104 + index * 28, { ...body, align: 'center' }));
      footer.forEach((line, index) => this.text(line, centre, top + 124 + lines.length * 28 + index * 30,
        { size: 16, weight: 500, color: index === footer.length - 1 ? GOLD : DIM, align: 'center' }));
    }
    this.texture.needsUpdate = true;
  }

  /** Throws WaW-style score popups for this player's points earned and spent. */
  events(events: readonly SimulationEvent[], playerId: string, now = performance.now()): void {
    for (const event of events) {
      if ((event.type === 'pointsAwarded' || event.type === 'pointsSpent') && event.playerId === playerId) {
        this.popups.spawn(event.type === 'pointsSpent' ? -event.amount : event.amount, this.pointsEdge, this.layout, now);
      } else if (event.type === 'nukeDetonated') this.nukeFlash.trigger(now);
    }
  }

  /**
   * `aim` carries the player's current spread cone and the camera's vertical field of view for the
   * crosshair; both change every frame, so they stay out of the snapshot (which repaints the canvas).
   */
  render(snapshot: HudSnapshot, now = performance.now(), aim?: { spread: number; verticalFov: number }): void {
    const resized = this.fit();
    if (resized || !this.previous || (Object.keys(snapshot) as (keyof HudSnapshot)[])
      .some(key => key === 'feedback'
        ? snapshot.feedback?.message !== this.previous!.feedback?.message
          || snapshot.feedback?.hitMarker !== this.previous!.feedback?.hitMarker
          || snapshot.feedback?.damageVignette !== this.previous!.feedback?.damageVignette
        : snapshot[key] !== this.previous![key])) {
      this.draw(snapshot);
      this.previous = { ...snapshot, feedback: snapshot.feedback && { ...snapshot.feedback } };
    }
    // Overlays (pause, game over, credits) cover the HUD, so the animated pieces hide under them.
    const effects = !snapshot.paused && !snapshot.gameOver && !this.credits;
    this.roundCounter.update(snapshot.round, snapshot.roundPhase, this.layout, now, effects);
    this.popups.update(this.layout, now, effects);
    this.nukeFlash.update(now, effects);
    // WaW hides the hip crosshair when aiming down sights and while sprinting.
    this.crosshair.update(aim?.spread ?? 0, aim?.verticalFov ?? 70, this.layout, now,
      effects && !!aim && !snapshot.aiming && !snapshot.sprinting);
    this.renderer.clearDepth();
    this.renderer.render(this.scene, this.camera);
  }

  reset(): void {
    this.previous = null;
    this.credits = false;
    this.popups.clear();
    this.nukeFlash.clear();
  }

  dispose(): void {
    if (typeof window !== 'undefined') window.removeEventListener('keydown', this.onKeyDown);
    this.material.dispose();
    this.texture.dispose();
  }
}
