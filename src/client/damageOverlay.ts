import * as THREE from 'three';
import { damagePresentation } from './damagePresentation.ts';
import type { HudSnapshot } from './hud.ts';
import type { HudLayout } from './hudEffects.ts';

/** A bounded injury texture below the HUD; pulses and healing never upload the main HUD canvas. */
export class DamageOverlay {
  private readonly canvas = document.createElement('canvas');
  private readonly texture = new THREE.CanvasTexture(this.canvas);
  private readonly mesh: THREE.Mesh;
  private drawn = '';

  constructor(scene: THREE.Scene) {
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.generateMipmaps = false;
    this.texture.minFilter = THREE.LinearFilter;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({
      map: this.texture, transparent: true, depthTest: false, depthWrite: false,
    }));
    this.mesh.renderOrder = -2;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  update(snapshot: HudSnapshot, layout: HudLayout): void {
    const damage = snapshot.spectating ? damagePresentation(snapshot.maxHealth, snapshot.maxHealth, null, 0, snapshot.combatEffects ?? 2)
      : damagePresentation(snapshot.health, snapshot.maxHealth,
        snapshot.bleedoutTicks == null ? null : { bleedoutTicks: snapshot.bleedoutTicks },
        snapshot.feedback?.damagePulse ?? (snapshot.feedback?.damageVignette ? 1 : 0), snapshot.combatEffects ?? 2);
    this.mesh.visible = damage.injury > 0.001 || damage.pulse > 0.001;
    if (!this.mesh.visible) return;
    const width = layout.width, height = layout.height, centre = width / 2;
    const scale = Math.min(1, 512 / Math.max(width, height));
    const pixelWidth = Math.ceil(width * scale), pixelHeight = Math.ceil(height * scale);
    const signature = [damage.injury, damage.pulse, snapshot.combatEffects ?? 2, width, height].join(',');
    if (signature === this.drawn) return;
    this.drawn = signature;
    if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) {
      this.texture.dispose();
      this.canvas.width = pixelWidth; this.canvas.height = pixelHeight;
    }
    const c = this.canvas.getContext('2d')!;
    c.setTransform(pixelWidth / width, 0, 0, pixelHeight / height, 0, 0);
    c.clearRect(0, 0, width, height);
    // Keep the crosshair area comparatively clean; injury gathers in the peripheral vision instead.
    const edge = c.createRadialGradient(centre, height / 2, height * 0.2, centre, height / 2, width * 0.69);
    edge.addColorStop(0, 'rgba(70,0,0,0)');
    edge.addColorStop(0.58, `rgba(78,0,0,${damage.injury * 0.06 + damage.pulse * 0.04})`);
    edge.addColorStop(1, `rgba(92,0,0,${Math.min(0.78, damage.injury * 0.58 + damage.pulse * 0.42)})`);
    c.fillStyle = edge; c.fillRect(0, 0, width, height);

    // Fixed irregular peripheral stains avoid a perfectly circular "Photoshop vignette" without animation noise.
    if ((snapshot.combatEffects ?? 2) > 0 && damage.injury + damage.pulse > 0.18) {
      c.save();
      const stain = Math.min(0.5, damage.injury * 0.3 + damage.pulse * 0.22);
      c.fillStyle = `rgba(72,0,0,${stain})`;
      for (const [x, y, rx, ry, turn] of [
        [0.02, 0.17, 0.15, 0.27, -0.35], [0.98, 0.28, 0.13, 0.3, 0.28],
        [0.14, 0.98, 0.24, 0.12, 0.12], [0.84, 0.99, 0.21, 0.11, -0.16],
        [0.48, 0.01, 0.2, 0.075, 0.04],
      ] as const) {
        c.beginPath(); c.ellipse(width * x, height * y, width * rx, height * ry, turn, 0, Math.PI * 2); c.fill();
      }
      c.restore();
    }
    if (damage.pulse > 0.001) {
      c.fillStyle = `rgba(70,0,0,${damage.pulse * 0.08})`;
      c.fillRect(0, 0, width, height);
    }

    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.texture.dispose();
  }
}
