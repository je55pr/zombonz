import * as THREE from 'three';
import { TITLE_FONT, UI_FONT } from './fonts.ts';

/**
 * Animated HUD pieces drawn as their own small textured quads over the HUD canvas, so animating them
 * never repaints and re-uploads the whole HUD. Positions are in HUD layout units (900 tall; the width
 * follows the window), converted to the HUD camera's -1..1 space.
 */
export interface HudLayout { width: number; height: number; scale: number }

const GOLD = '#f2c55c';
const RED = '#d8382b';
const ROUND_RED = new THREE.Color(0xd8382b);
const WHITE = new THREE.Color(0xf4efe0);

function placeQuad(mesh: THREE.Mesh, layout: HudLayout, x: number, y: number, width: number, height: number): void {
  mesh.position.set(((x + width / 2) / layout.width) * 2 - 1, 1 - ((y + height / 2) / layout.height) * 2, 0);
  mesh.scale.set((width / layout.width) * 2, (height / layout.height) * 2, 1);
}

function overlayMaterial(texture: THREE.Texture): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false });
}

interface Popup { mesh: THREE.Mesh; born: number; x: number; y: number; vx: number; vy: number; width: number; height: number }

/** Popup lifetime in seconds, and how many can be on screen at once (automatic fire stays readable). */
const POPUP_LIFE = 1.2;
const MAX_POPUPS = 24;

/**
 * WaW's floating score: every hit and kill throws a gold "+10", "+50" or "+100" off the points counter,
 * and spending throws a red "-950". Each distinct label is rasterised once and reused.
 */
export class PointsPopups {
  private readonly popups: Popup[] = [];
  private readonly labels = new Map<string, { texture: THREE.CanvasTexture; width: number; height: number }>();
  private labelScale = 0;
  private spawned = 0;
  private readonly geometry = new THREE.PlaneGeometry(1, 1);

  constructor(private readonly scene: THREE.Scene) {}

  private label(text: string, colour: string, scale: number) {
    if (scale !== this.labelScale) {
      for (const label of this.labels.values()) label.texture.dispose();
      this.labels.clear(); this.labelScale = scale;
    }
    const key = `${colour}${text}`;
    let label = this.labels.get(key);
    if (!label) {
      const size = 34, height = 48, font = `700 ${size}px ${UI_FONT}`;
      const canvas = document.createElement('canvas');
      const measure = canvas.getContext('2d')!;
      measure.font = font;
      const width = Math.ceil(measure.measureText(text).width) + 20;
      canvas.width = Math.ceil(width * scale); canvas.height = Math.ceil(height * scale);
      // Resizing the canvas resets its state, so the font is set again below.
      const c = canvas.getContext('2d')!;
      c.scale(scale, scale);
      c.font = font; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.shadowColor = 'rgba(0,0,0,0.9)'; c.shadowBlur = 5; c.shadowOffsetY = 2;
      c.fillStyle = colour; c.fillText(text, width / 2, height / 2 + 1);
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace; texture.generateMipmaps = false; texture.minFilter = THREE.LinearFilter;
      label = { texture, width, height };
      this.labels.set(key, label);
    }
    return label;
  }

  /** Throws a popup from the left edge of the points counter (layout coordinates). */
  spawn(amount: number, from: { x: number; y: number }, layout: HudLayout, now: number): void {
    if (amount === 0) return;
    const spend = amount < 0;
    const label = this.label(`${spend ? '-' : '+'}${Math.abs(amount)}`, spend ? RED : GOLD, layout.scale);
    // A fixed scatter pattern rather than randomness: consecutive popups fan out instead of stacking.
    const fan = [0.1, -0.35, 0.55, -0.1, 0.35, -0.55, 0.2][this.spawned++ % 7];
    const mesh = new THREE.Mesh(this.geometry, overlayMaterial(label.texture));
    mesh.renderOrder = 10; mesh.frustumCulled = false;
    this.scene.add(mesh);
    this.popups.push({ mesh, born: now, x: from.x - label.width, y: from.y - label.height / 2,
      vx: -70 - Math.abs(fan) * 60, vy: spend ? 45 : -60 + fan * 90, width: label.width, height: label.height });
    while (this.popups.length > MAX_POPUPS) this.remove(this.popups[0]);
  }

  private remove(popup: Popup): void {
    popup.mesh.removeFromParent(); (popup.mesh.material as THREE.Material).dispose();
    this.popups.splice(this.popups.indexOf(popup), 1);
  }

  update(layout: HudLayout, now: number, visible: boolean): void {
    for (const popup of [...this.popups]) {
      const age = (now - popup.born) / 1000;
      if (age >= POPUP_LIFE) { this.remove(popup); continue; }
      const t = age / POPUP_LIFE, ease = 1 - (1 - t) * (1 - t);
      placeQuad(popup.mesh, layout, popup.x + popup.vx * ease, popup.y + popup.vy * ease, popup.width, popup.height);
      (popup.mesh.material as THREE.MeshBasicMaterial).opacity = t < 0.55 ? 1 : 1 - (t - 0.55) / 0.45;
      popup.mesh.visible = visible;
    }
  }

  get count(): number { return this.popups.length; }

  clear(): void {
    for (const popup of [...this.popups]) this.remove(popup);
  }
}

/** Seconds for the round-complete flash, and for a new round to fade in white and settle to red. */
const FLASH_SECONDS = 3;
const ARRIVE_SECONDS = 2.2;

/**
 * The round counter, WaW style: chalk tally marks for rounds one to five, painted numerals after.
 * It flashes white when a round is cleared, dims through the break, and the next round fades in
 * white before settling to red.
 */
export class RoundCounter {
  private readonly canvas = document.createElement('canvas');
  private readonly texture: THREE.CanvasTexture;
  private readonly mesh: THREE.Mesh;
  private drawn: { round: number; scale: number } | null = null;
  private round = 0;
  private phase = '';
  private changedAt = 0;
  private mode: 'arrive' | 'flash' | 'steady' = 'steady';
  /** The box's top edge is 250 layout units above the bottom of the screen. */
  static readonly BOX = { x: 34, top: 250, width: 360, height: 160 };

  constructor(scene: THREE.Scene) {
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace; this.texture.generateMipmaps = false;
    this.texture.minFilter = THREE.LinearFilter;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), overlayMaterial(this.texture));
    this.mesh.renderOrder = 5; this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  /** Drawn in white; the material colour tints it red or white as it animates. */
  private draw(round: number, scale: number): void {
    const { width, height } = RoundCounter.BOX;
    this.canvas.width = Math.ceil(width * scale); this.canvas.height = Math.ceil(height * scale);
    const c = this.canvas.getContext('2d')!;
    c.setTransform(scale, 0, 0, scale, 0, 0);
    c.clearRect(0, 0, width, height);
    c.shadowColor = 'rgba(0,0,0,0.85)'; c.shadowBlur = 8; c.shadowOffsetY = 3;
    c.fillStyle = c.strokeStyle = '#ffffff';
    if (round >= 1 && round <= 5) {
      c.lineCap = 'round'; c.lineWidth = 13;
      // Hand-drawn strokes: a fixed small lean and length variation per mark.
      const lean = [0.06, -0.04, 0.08, -0.02, 0.05], stretch = [0, 5, -3, 4, -2];
      for (let i = 0; i < Math.min(round, 4); i++) {
        const x = 32 + i * 44, top = 20 - stretch[i], bottom = height - 18 + stretch[(i + 2) % 5];
        c.beginPath(); c.moveTo(x + lean[i] * 40, top); c.lineTo(x - lean[i] * 40, bottom); c.stroke();
      }
      if (round === 5) { c.beginPath(); c.moveTo(12, height - 28); c.lineTo(188, 24); c.stroke(); }
    } else {
      c.font = `400 150px ${TITLE_FONT}`; c.textBaseline = 'middle'; c.textAlign = 'left';
      c.fillText(String(round), 18, height / 2 + 5);
    }
    this.texture.needsUpdate = true;
    this.drawn = { round, scale };
  }

  update(round: number, roundPhase: string, layout: HudLayout, now: number, visible: boolean): void {
    if (round !== this.round) { this.round = round; this.mode = 'arrive'; this.changedAt = now; }
    else if (roundPhase !== this.phase && roundPhase === 'intermission') { this.mode = 'flash'; this.changedAt = now; }
    this.phase = roundPhase;
    if (!this.drawn || this.drawn.round !== round || this.drawn.scale !== layout.scale) this.draw(round, layout.scale);
    const { x, top, width, height } = RoundCounter.BOX;
    const age = (now - this.changedAt) / 1000;
    const material = this.mesh.material as THREE.MeshBasicMaterial;
    let grow = 1;
    if (this.mode === 'arrive') {
      const fade = Math.min(1, age / 0.6);
      material.opacity = fade; grow = 1.18 - 0.18 * fade;
      material.color.copy(WHITE).lerp(ROUND_RED, Math.max(0, Math.min(1, (age - 0.6) / (ARRIVE_SECONDS - 0.6))));
      if (age >= ARRIVE_SECONDS) this.mode = 'steady';
    } else if (this.mode === 'flash') {
      const pulse = age < FLASH_SECONDS ? 0.5 + 0.5 * Math.cos(age * Math.PI * 4) : 0;
      material.color.copy(ROUND_RED).lerp(WHITE, pulse);
      // After the flash the cleared round stays dimmed until the next one arrives.
      material.opacity = age < FLASH_SECONDS ? 1 : Math.max(0.45, 1 - (age - FLASH_SECONDS) * 1.5);
    } else {
      material.color.copy(ROUND_RED); material.opacity = 1;
    }
    placeQuad(this.mesh, layout, x - width * (grow - 1) / 2, layout.height - top - height * (grow - 1) / 2,
      width * grow, height * grow);
    this.mesh.visible = visible;
  }
}

/** The screen gap (layout units) left at the centre even for a perfectly accurate shot. */
const CROSSHAIR_MIN_GAP = 5;
const CROSSHAIR_LENGTH = 11;
const CROSSHAIR_WIDTH = 2;

/**
 * WaW's four-line hip crosshair. The gap is the player's actual spread cone projected to the screen,
 * so it opens while moving, sprinting and firing and closes as the aim settles. Each line has a dark
 * outline so it reads against bright walls.
 */
export class Crosshair {
  private readonly lines: { outline: THREE.Mesh; line: THREE.Mesh }[] = [];
  private gap = CROSSHAIR_MIN_GAP;
  private lastNow: number | null = null;
  private opacity = 1;

  constructor(scene: THREE.Scene) {
    const geometry = new THREE.PlaneGeometry(1, 1);
    for (let i = 0; i < 4; i++) {
      const outline = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55, depthTest: false, depthWrite: false }));
      const line = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: 0xf4f1e7, transparent: true, depthTest: false, depthWrite: false }));
      outline.renderOrder = 6; line.renderOrder = 7;
      outline.frustumCulled = line.frustumCulled = false;
      scene.add(outline, line);
      this.lines.push({ outline, line });
    }
  }

  /** Gap in layout units for a spread cone, given the camera's current vertical field of view. */
  static gapFor(spreadRadians: number, verticalFovDegrees: number, layout: HudLayout): number {
    const halfFov = THREE.MathUtils.degToRad(verticalFovDegrees) / 2;
    return CROSSHAIR_MIN_GAP + Math.tan(spreadRadians) / Math.tan(halfFov) * (layout.height / 2);
  }

  get currentGap(): number { return this.gap; }

  update(spreadRadians: number, verticalFovDegrees: number, layout: HudLayout, now: number, visible: boolean): void {
    const dt = this.lastNow === null ? 1 : Math.min(0.1, Math.max(0, (now - this.lastNow) / 1000));
    this.lastNow = now;
    // Ease the lines rather than snapping them tick by tick, and fade in and out rather than popping.
    const target = Crosshair.gapFor(spreadRadians, verticalFovDegrees, layout);
    this.gap += (target - this.gap) * (1 - Math.exp(-18 * dt));
    this.opacity += ((visible ? 1 : 0) - this.opacity) * (1 - Math.exp(-16 * dt));
    const cx = layout.width / 2, cy = layout.height / 2;
    const arms = [[0, -1], [0, 1], [-1, 0], [1, 0]] as const;
    arms.forEach(([dx, dy], i) => {
      const { outline, line } = this.lines[i];
      const along = this.gap + CROSSHAIR_LENGTH / 2;
      const x = cx + dx * along, y = cy + dy * along;
      const w = dx ? CROSSHAIR_LENGTH : CROSSHAIR_WIDTH, h = dx ? CROSSHAIR_WIDTH : CROSSHAIR_LENGTH;
      placeQuad(line, layout, x - w / 2, y - h / 2, w, h);
      placeQuad(outline, layout, x - w / 2 - 1, y - h / 2 - 1, w + 2, h + 2);
      (line.material as THREE.MeshBasicMaterial).opacity = 0.9 * this.opacity;
      (outline.material as THREE.MeshBasicMaterial).opacity = 0.55 * this.opacity;
      line.visible = outline.visible = this.opacity > 0.01;
    });
  }
}

/** Seconds the nuke's white-out holds at full strength, then takes to ease back to the scene. */
const NUKE_HOLD_SECONDS = 0.15;
const NUKE_FADE_SECONDS = 1.6;

/** How white the screen is this long after a nuke: solid, then a smooth fade to nothing. */
export function nukeFlashOpacity(secondsSince: number): number {
  if (secondsSince < 0) return 0;
  if (secondsSince <= NUKE_HOLD_SECONDS) return 1;
  const t = (secondsSince - NUKE_HOLD_SECONDS) / NUKE_FADE_SECONDS;
  return t >= 1 ? 0 : 1 - t * t * (3 - 2 * t);
}

/**
 * The nuke's white flash over the whole view. It sits under the HUD text, so points and ammo stay
 * readable through it, and it hides itself when the fade is done so it can never stay stuck on.
 */
export class NukeFlash {
  private readonly mesh: THREE.Mesh;
  private startedAt: number | null = null;

  constructor(scene: THREE.Scene) {
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthTest: false, depthWrite: false }));
    // Under the HUD canvas quad (render order 0), over the 3D view rendered before the HUD scene.
    this.mesh.renderOrder = -1; this.mesh.frustumCulled = false; this.mesh.visible = false;
    scene.add(this.mesh);
  }

  /** Restarts the flash; a second nuke while the first is still fading goes back to full white. */
  trigger(now: number): void { this.startedAt = now; }

  get active(): boolean { return this.mesh.visible; }

  update(now: number, visible: boolean): void {
    const opacity = this.startedAt === null || !visible ? 0 : nukeFlashOpacity((now - this.startedAt) / 1000);
    if (this.startedAt !== null && (now - this.startedAt) / 1000 > NUKE_HOLD_SECONDS + NUKE_FADE_SECONDS) this.startedAt = null;
    (this.mesh.material as THREE.MeshBasicMaterial).opacity = opacity;
    this.mesh.visible = opacity > 0.004;
  }

  clear(): void { this.startedAt = null; this.mesh.visible = false; }
}
