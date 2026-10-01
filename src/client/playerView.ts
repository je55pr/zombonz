import * as THREE from 'three';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import type { PlayerState, Vec3 } from '../core/types.ts';
import type { SimulationEvent } from '../core/simulation.ts';
import { upgradeGlow } from '../core/upgrades.ts';
import { interpolatePosition } from './interpolation.ts';
import { loadModel } from './runtimeAssets.ts';
import { readyWeaponModel } from './weaponView.ts';

/** The teammate model: a rigged WWII Ranger with idle, walk, run and death clips (import-teammate.mjs). */
export const TEAMMATE_MODEL = 'players/ranger/model.glb';
/** Ground speed of the walk and run cycles at normal playback, in m/s (from their root motion). */
const WALK_PACE = 1.19, RUN_PACE = 3.14;
/** Uniform colours by slot for the fallback figure, until the model loads. */
const UNIFORMS = [0x4b5a36, 0x3e4a5c, 0x7a6a48, 0x55443d];

function label(text: string, color: string, height: number, depthTest: boolean): THREE.Sprite {
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 128;
  const context = canvas.getContext('2d')!;
  context.font = '600 64px Oswald, sans-serif'; context.textAlign = 'center'; context.textBaseline = 'middle';
  context.lineWidth = 10; context.strokeStyle = 'rgba(0,0,0,0.75)'; context.strokeText(text, 256, 64, 490);
  context.fillStyle = color; context.fillText(text, 256, 64, 490);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest, depthWrite: false, transparent: true }));
  sprite.scale.set(height * 4, height, 1);
  sprite.renderOrder = depthTest ? 0 : 10;
  return sprite;
}

type Clip = 'idle' | 'walk' | 'run' | 'death';

/**
 * A teammate: the Ranger model, walking or running at their pace and carrying a copy of their current
 * gun, with their name overhead. Downed, they fall and lie under a red REVIVE marker seen through
 * walls. A simple figure stands in until the model has loaded.
 */
export class PlayerView {
  readonly root = new THREE.Group();
  private readonly fallback = new THREE.Group();
  private readonly revive: THREE.Sprite;
  private readonly gunMount = new THREE.Group();
  private readonly gunModel = new THREE.Group();
  private readonly muzzleFlash = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xffd57a, transparent: true, opacity: 0.9, depthWrite: false,
      blending: THREE.AdditiveBlending }));
  private readonly nameTag: THREE.Sprite;
  private model: THREE.Object3D | null = null;
  private gunId: string | null = null;
  private mixer: THREE.AnimationMixer | null = null;
  private readonly actions = new Map<Clip, THREE.AnimationAction>();
  private current: Clip | null = null;
  private lastTick: number | null = null;
  private hand: THREE.Object3D | null = null;
  private readonly handPoint = new THREE.Vector3();
  private muzzleFlashUntil = -1;

  constructor(name: string, slot: number) {
    const uniform = new THREE.MeshStandardMaterial({ color: UNIFORMS[slot % UNIFORMS.length], roughness: 0.9 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.25, 1.2, 4, 8), uniform);
    body.position.y = 0.85; this.fallback.add(body);
    this.root.add(this.fallback);
    this.root.add(this.gunMount);
    this.gunMount.add(this.gunModel, this.muzzleFlash);
    this.muzzleFlash.name = 'remote-muzzle-flash';
    this.muzzleFlash.scale.set(0.045, 0.045, 0.11); this.muzzleFlash.position.set(0, 0, -0.5); this.muzzleFlash.visible = false;
    this.nameTag = label(name, '#e5ddc8', 0.22, true); this.nameTag.position.y = 2.05; this.root.add(this.nameTag);
    this.revive = label('REVIVE', '#e0402f', 0.3, false); this.revive.position.y = 1.1; this.revive.visible = false;
    this.root.add(this.revive);
    void loadModel(TEAMMATE_MODEL).then(gltf => this.attach(gltf.scene, gltf.animations),
      error => console.warn('Teammate model unavailable', error));
  }

  private attach(source: THREE.Object3D, clips: THREE.AnimationClip[]): void {
    const model = clone(source);
    this.model = model;
    // The model faces +z; a player looks toward -z at yaw 0.
    model.rotation.y = Math.PI;
    model.traverse(object => {
      // Like zombies, teammates take the moon's shadows but cast none.
      if (object instanceof THREE.Mesh) { object.receiveShadow = true; object.frustumCulled = false; }
    });
    this.root.add(model);
    this.fallback.visible = false;
    this.mixer = new THREE.AnimationMixer(model);
    for (const clip of clips) {
      const action = this.mixer.clipAction(clip);
      if (clip.name === 'death') { action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true; }
      this.actions.set(clip.name as Clip, action);
    }
    // The gun follows the right hand, pointing where the player faces (as the rifle poses hold it).
    this.hand = model.getObjectByName('mixamorigRightHand') ?? null;
  }

  private play(name: Clip, timeScale: number): void {
    const action = this.actions.get(name);
    if (!action) return;
    action.timeScale = timeScale;
    if (this.current === name) return;
    const previous = this.current ? this.actions.get(this.current) : undefined;
    action.reset().play();
    if (previous) { previous.fadeOut(name === 'death' ? 0.1 : 0.2); action.fadeIn(name === 'death' ? 0.1 : 0.2); }
    this.current = name;
  }

  events(events: readonly SimulationEvent[], playerId: PlayerState['id'], tick: number): void {
    for (const event of events) {
      if (event.type !== 'weaponFired' || event.playerId !== playerId) continue;
      const color = upgradeGlow(event.weaponId) ?? (event.weaponId === 'irrlicht' ? 0x7dff9a
        : event.weaponId === 'molniya' ? 0x8fd8ff : 0xffd57a);
      (this.muzzleFlash.material as THREE.MeshBasicMaterial).color.setHex(color);
      this.muzzleFlashUntil = Math.max(this.muzzleFlashUntil, tick + 4);
    }
  }

  update(player: PlayerState, previous: Vec3 | undefined, alpha: number, tick: number): void {
    this.root.visible = player.alive;
    if (!player.alive) return;
    const position = interpolatePosition(previous, player.position, alpha);
    this.root.position.set(position.x, position.y, position.z);
    this.root.rotation.y = player.yaw;
    const downed = player.downed !== null;
    const prone = !downed && player.stance === 'prone';
    const crouched = !downed && player.stance === 'crouch';
    this.nameTag.position.y = prone ? 0.88 : crouched ? 1.48 : 2.05;
    this.fallback.scale.y = crouched ? 0.72 : 1;
    this.fallback.rotation.x = prone ? -1.12 : 0;
    this.fallback.position.y = prone ? 0.28 : 0;
    if (this.model) {
      this.model.scale.y = crouched ? 0.72 : 1;
      this.model.rotation.x = prone ? -1.12 : 0;
      this.model.position.y = prone ? 0.28 : 0;
    }
    this.revive.visible = downed;
    const speed = Math.hypot(player.velocity.x, player.velocity.z);
    if (downed) this.play('death', 1);
    else if (prone) this.play('idle', 1);
    else if (speed > 1.6) this.play('run', Math.max(0.7, Math.min(2, speed / RUN_PACE)));
    else if (speed > 0.2) this.play('walk', Math.max(0.6, Math.min(1.4, speed / WALK_PACE)));
    else this.play('idle', 1);
    const dt = this.lastTick === null ? 0 : Math.max(0, Math.min(0.1, (tick - this.lastTick) / 60));
    this.lastTick = tick;
    this.mixer?.update(dt);
    this.gunMount.visible = !downed;
    this.muzzleFlash.visible = !downed && tick < this.muzzleFlashUntil;
    if (this.hand) {
      this.root.updateMatrixWorld(true);
      this.gunMount.position.copy(this.root.worldToLocal(this.hand.getWorldPosition(this.handPoint)));
      this.gunMount.position.z -= 0.12;
    } else this.gunMount.position.set(0.12, 1.25, -0.35);
    if (this.gunId !== player.weapon.weaponId) {
      const model = readyWeaponModel(player.weapon.weaponId);
      if (model) {
        this.gunModel.clear();
        const gun = model.root.clone(true);
        gun.position.set(0, 0, 0); gun.rotation.set(0, 0, 0); gun.scale.setScalar(1.05);
        this.gunModel.add(gun);
        this.muzzleFlash.position.copy(model.muzzle).multiplyScalar(1.05);
        this.gunId = player.weapon.weaponId;
      }
    }
  }

  dispose(): void {
    this.mixer?.stopAllAction();
    this.root.traverse(object => {
      if (object instanceof THREE.Sprite) {
        (object.material as THREE.SpriteMaterial).map?.dispose(); object.material.dispose();
      }
    });
    this.root.removeFromParent();
  }
}
