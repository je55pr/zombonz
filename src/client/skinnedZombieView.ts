import * as THREE from 'three';
import type { BarrierState } from '../core/barrier.ts';
import type { Vec3, ZombieState } from '../core/types.ts';
import { ZOMBIE_GAIT_SPEEDS } from '../core/zombie.ts';
import { CRAWL_POINTS, LEGS_MASK, LIMB, poseJoint, swingSeconds, type LimbId } from '../core/zombieBody.ts';
import { cloneZombieModel, type ZombieAnimation, type ZombieAsset, type ZombieAssetId } from './runtimeAssets.ts';
import { interpolatePosition } from './interpolation.ts';
import { LIMB_IDS, RIGS, aimBone, installLimbMask, prepareLimbs, rotateBoneWorld, type RigSpec } from './zombieRig.ts';
import type { ZombieLook } from './zombieLooks.ts';

/**
 * Ground speed, in m/s, of each model's walk and run cycles at normal playback: play a cycle at (ground speed / this) and the
 * feet stay planted. Measured from foot travel for the soldier; the walker's are set by eye against its stride.
 */
const CLIP_PACE: Readonly<Record<ZombieAssetId, { walk: number; run: number }>> = {
  peter_d: { walk: 0.8, run: 1.84 },
  pxltiger: { walk: 0.62, run: 3.1 },
};
const TEMPO_LIMITS = [0.55, 1.7] as const;

export function zombieAnimation(zombie: ZombieState): ZombieAnimation {
  if (!zombie.alive) return 'death';
  // A swing (see ZOMBIE_MELEE) plays the attack clip; so does tearing at boards.
  if (zombie.entry?.phase === 'breaking' || zombie.attackTicks > 0) return 'attack';
  // Climbing a wall on the way in: clawing upward reads better than walking on air.
  if (zombie.entry?.phase === 'approach' && Math.abs(zombie.velocity.y) > 0.05) return 'attack';
  const moving = Math.hypot(zombie.velocity.x, zombie.velocity.z) > 0.05;
  return moving || zombie.entry?.phase === 'vaulting' ? (zombie.gait === 'walk' ? 'walk' : 'run') : 'idle';
}

const CAP_GEOMETRY = new THREE.SphereGeometry(1, 10, 8);
const CAP_MATERIAL = new THREE.MeshStandardMaterial({ color: 0x3b0707, roughness: 0.7, metalness: 0 });
const scratch = { a: new THREE.Vector3(), b: new THREE.Vector3(), q: new THREE.Quaternion(), right: new THREE.Vector3(), forward: new THREE.Vector3() };
const clamp = (value: number, [min, max]: readonly [number, number]) => Math.max(min, Math.min(max, value));

export class SkinnedZombieView {
  readonly root = new THREE.Group();
  private readonly mixer: THREE.AnimationMixer;
  private readonly body: THREE.Group;
  private readonly actions = new Map<ZombieAnimation, THREE.AnimationAction>();
  private readonly baseScale: number;
  private readonly rig?: RigSpec;
  private readonly assetId?: ZombieAssetId;
  private readonly bones = new Map<string, THREE.Object3D>();
  /** What the animation last set each bent bone to, so a bend is undone before the next frame's (see update). */
  private readonly animated = new Map<THREE.Object3D, THREE.Quaternion>();
  private readonly skinned: THREE.SkinnedMesh[] = [];
  private readonly materials: THREE.MeshStandardMaterial[] = [];
  private readonly limbMask = { value: 0 };
  private readonly caps: THREE.Mesh[] = [];
  private current?: THREE.AnimationAction;
  private lastTick?: number;
  private deathTick?: number;
  private yaw?: number;
  private shown = 0;
  private flashLeft = 0;
  private moving = false;

  constructor(asset: ZombieAsset, private readonly look: ZombieLook) {
    const { body, model } = cloneZombieModel(asset);
    this.body = body; this.root.add(body); this.baseScale = body.scale.x;
    this.mixer = new THREE.AnimationMixer(model);
    this.assetId = asset.id; this.rig = asset.id ? RIGS[asset.id] : undefined;
    // Each zombie has a colouring and a set of limbs of its own, so its own material (they share their textures and shader).
    const clones = new Map<THREE.Material, THREE.MeshStandardMaterial>();
    model.traverse(object => {
      if ((object as THREE.Bone).isBone) this.bones.set(object.name, object);
      const mesh = object as THREE.SkinnedMesh;
      if (!mesh.isMesh) return;
      if (mesh.isSkinnedMesh) this.skinned.push(mesh);
      const source = mesh.material as THREE.Material;
      let clone = clones.get(source);
      if (!clone) {
        clone = source.clone() as THREE.MeshStandardMaterial;
        clone.color?.multiply(look.tint);
        if (this.rig?.limbs.head.owns) installLimbMask(clone, this.limbMask);
        clones.set(source, clone); this.materials.push(clone);
      }
      mesh.material = clone;
    });
    if (this.rig?.limbs.head.owns) for (const mesh of this.skinned) prepareLimbs(mesh, this.rig);
    for (const name of this.bendBones()) {
      const bone = this.bones.get(name);
      if (bone) this.animated.set(bone, bone.quaternion.clone());
    }
    for (const [name, clip] of Object.entries(asset.clips)) {
      const action = this.mixer.clipAction(clip);
      if (name === 'death') { action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true; }
      this.actions.set(name as ZombieAnimation, action);
    }
  }

  /** The bones a bearing or a crawl turns. */
  private bendBones(): string[] {
    const rig = this.rig;
    return rig ? [rig.hips, ...rig.spine, rig.neck, rig.head, ...rig.arms.L, ...rig.arms.R, ...rig.legs.L, ...rig.legs.R] : [];
  }

  private bone(name: string): THREE.Object3D | undefined { return this.bones.get(name); }

  update(zombie: ZombieState, tick: number, _barrier?: BarrierState, previous?: Vec3, alpha = 1): void {
    const position = interpolatePosition(previous, zombie.position, alpha);
    this.root.position.set(position.x, position.y, position.z);
    const phase = zombie.entry?.phase;
    const dt = this.lastTick === undefined ? 0 : Math.max(0, Math.min(0.1, (tick - this.lastTick) / 60));
    // Which way it faces is the simulation's (its hit volumes turn with it); chase that so snapshots that arrive
    // a few ticks apart still turn the model smoothly.
    this.yaw = this.yaw === undefined ? zombie.yaw
      : this.yaw + Math.atan2(Math.sin(zombie.yaw - this.yaw), Math.cos(zombie.yaw - this.yaw)) * (1 - Math.exp(-dt * 24));
    this.root.rotation.y = this.yaw;
    // Its own build, and a vault squashes the body as the simulation's hit volumes are.
    this.body.scale.set(this.baseScale * this.look.width, this.baseScale * this.look.height * (phase === 'vaulting' ? 0.85 : 1), this.baseScale * this.look.width);
    this.body.position.y = 0;
    this.moving = Math.hypot(zombie.velocity.x, zombie.velocity.z) > 0.05;

    const name = zombieAnimation(zombie);
    const action = this.actions.get(name) ?? this.actions.get('idle');
    if (action && action !== this.current) {
      action.reset().play();
      if (name === 'walk' || name === 'run' || name === 'idle') action.time = this.look.phase * action.getClip().duration;
      this.current?.fadeOut(0.12); action.fadeIn(0.12); this.current = action;
    }
    if (action) this.pace(action, name, zombie);
    this.lastTick = tick;
    // The mixer only writes a bone whose animated value has changed, so last frame's bend is undone by putting back what the
    // animation left, not by resetting to the bind pose (which would wipe a bone the animation is holding still).
    for (const [bone, quaternion] of this.animated) bone.quaternion.copy(quaternion);
    this.mixer.update(dt);
    for (const [bone, quaternion] of this.animated) quaternion.copy(bone.quaternion);

    // Only a body that is bent needs its bones' matrices brought up to date here (the renderer does it for the rest).
    const crawling = (zombie.limbs & LEGS_MASK) !== 0;
    if (zombie.alive && (crawling || this.look.posture !== 'straight')) {
      this.root.updateMatrixWorld(true);
      if (crawling) this.poseCrawl(tick); else this.posture(tick);
    }
    this.syncLimbs(zombie.limbs);
    if (this.flashLeft > 0) {
      this.flashLeft -= 1;
      const glow = this.flashLeft > 0 ? 0.55 * this.flashLeft / 5 : 0;
      for (const material of this.materials) material.emissive.setRGB(glow, glow * 0.25, glow * 0.2);
    }
    if (!zombie.alive) {
      this.deathTick ??= tick;
      // Keep a short death pose, then sink/remove; fallback for the variant without a death clip.
      const elapsed = (tick - this.deathTick) / 60;
      if (!this.actions.has('death')) this.body.rotation.x = -Math.min(Math.PI / 2, elapsed * 2.5);
      this.root.position.y -= Math.max(0, elapsed - 2.5) * 0.7;
    }
  }

  /** How fast each clip plays: a swing by the simulation's own count of it, a cycle at its zombie's tempo and pace. */
  private pace(action: THREE.AnimationAction, name: ZombieAnimation, zombie: ZombieState): void {
    const pace = CLIP_PACE[this.assetId ?? 'peter_d'];
    const crawling = (zombie.limbs & LEGS_MASK) !== 0;
    if (name === 'walk') action.timeScale = crawling ? 0.55 * this.look.tempo : clamp(this.look.tempo * ZOMBIE_GAIT_SPEEDS.walk / pace.walk, TEMPO_LIMITS);
    // The models have no sprint clip: the run cycle at the zombie's ground speed, so feet stay planted (capped, so they do not blur).
    else if (name === 'run') action.timeScale = clamp(this.look.tempo * ZOMBIE_GAIT_SPEEDS[zombie.gait] / pace.run, TEMPO_LIMITS);
    else if (name === 'idle') action.timeScale = this.look.tempo;
    else if (name === 'death') action.timeScale = this.look.deathSpeed;
    else action.timeScale = this.look.tempo;
    // A swing is played from the simulation's own count of it, not from a clock of the view's: the arm comes down
    // on the tick the blow lands, and the clip is where the hit volumes were measured.
    const swinging = name === 'attack' && zombie.attackTicks > 0;
    action.paused = swinging;
    if (swinging) action.time = swingSeconds(zombie) % action.getClip().duration;
  }

  /** Its bearing: how it holds itself as it stands and shambles (a little, so its hit volumes still fit it). */
  private posture(tick: number): void {
    const rig = this.rig;
    if (!rig || this.look.posture === 'straight') return;
    const { q, right, forward } = scratch;
    right.set(1, 0, 0).applyQuaternion(this.root.quaternion); forward.set(0, 0, 1).applyQuaternion(this.root.quaternion);
    if (this.look.posture === 'hunched') {
      for (const name of rig.spine.slice(1, 3)) { const bone = this.bone(name); if (bone) rotateBoneWorld(bone, q.setFromAxisAngle(right, 0.06)); }
    } else if (this.look.posture === 'tilted') {
      const head = this.bone(rig.head);
      if (head) { rotateBoneWorld(head, q.setFromAxisAngle(forward, 0.3 * this.look.side)); rotateBoneWorld(head, q.setFromAxisAngle(right, 0.14)); }
    } else {
      // A limp: the hips drop to one side with each step.
      const hips = this.bone(rig.hips);
      if (hips) rotateBoneWorld(hips, q.setFromAxisAngle(forward, this.look.side * (this.moving ? 0.05 + 0.05 * Math.sin(tick * 0.1 * this.look.tempo) : 0.06)));
    }
  }

  /**
   * A crawler drags itself along on its arms and elbows, torso low and head up: neither model has a crawl clip, so the
   * skeleton is aimed at the same joint positions the simulation's crawl volumes use (`CRAWL_POINTS`), the arms taking turns.
   */
  private poseCrawl(tick: number): void {
    const rig = this.rig;
    if (!rig) return;
    const at = (key: Parameters<typeof poseJoint>[1]) => new THREE.Vector3(...poseJoint(CRAWL_POINTS, key)).applyQuaternion(this.root.quaternion);
    const direction = (from: Parameters<typeof poseJoint>[1], to: Parameters<typeof poseJoint>[1]) => at(to).sub(at(from)).normalize();
    const hips = this.bone(rig.hips), neck = this.bone(rig.neck), head = this.bone(rig.head);
    if (!hips || !neck || !head) return;
    aimBone(hips, neck, direction('hips', 'neck'));
    // Lower the whole body so the hips sit where the crawl volumes put them.
    const target = poseJoint(CRAWL_POINTS, 'hips')[1] * this.look.height;
    hips.getWorldPosition(scratch.a);
    this.body.position.y += target - (scratch.a.y - this.root.position.y);
    this.root.updateMatrixWorld(true);
    aimBone(neck, head, direction('neck', 'head'));
    const stroke = this.moving ? tick * 0.11 * this.look.tempo : 0;
    for (const side of ['L', 'R'] as const) {
      const [upper, fore, hand] = rig.arms[side].map(name => this.bone(name));
      if (!upper || !fore || !hand) continue;
      const swing = Math.sin(stroke + (side === 'L' ? 0 : Math.PI));
      const reach = (from: Parameters<typeof poseJoint>[1], to: Parameters<typeof poseJoint>[1]) => {
        const aim = direction(from, to), forward = new THREE.Vector3(0, 0, 1).applyQuaternion(this.root.quaternion);
        return aim.addScaledVector(forward, 0.45 * swing).normalize();
      };
      aimBone(upper, fore, reach(`shoulder${side}`, `elbow${side}`));
      aimBone(fore, hand, reach(`elbow${side}`, `hand${side}`));
    }
    for (const side of ['L', 'R'] as const) {
      const [thigh, calf, foot] = rig.legs[side].map(name => this.bone(name));
      if (!thigh || !calf || !foot) continue;
      aimBone(thigh, calf, direction('hips', `knee${side}`));
      aimBone(calf, foot, direction(`knee${side}`, `foot${side}`));
    }
  }

  /** Takes off whatever the simulation says is gone, and closes each stump. */
  private syncLimbs(mask: number): void {
    if (mask === this.shown) return;
    const added = mask & ~this.shown;
    this.shown = mask; this.limbMask.value = mask;
    const rig = this.rig;
    if (!rig) return;
    this.root.updateMatrixWorld(true);
    for (const limb of LIMB_IDS) {
      if (!(added & LIMB[limb])) continue;
      const spec = rig.limbs[limb];
      for (const name of spec.meshes ?? []) this.skinned.find(mesh => mesh.name === name)!.visible = false;
      const bone = this.bone(spec.capBone);
      if (!bone) continue;
      const cap = new THREE.Mesh(CAP_GEOMETRY, CAP_MATERIAL);
      cap.scale.setScalar(spec.capRadius / bone.getWorldScale(scratch.a).x);
      bone.add(cap); this.caps.push(cap);
    }
  }

  /** A brief red-white flash of the whole body, for a hit that lands. */
  flash(): void { this.flashLeft = 6; }

  /**
   * A copy of a limb as it is drawn right now, as a loose object at its own middle (in world space) for the gore system to
   * throw: the vertices are skinned by hand from the current pose, since a skinned mesh cannot be moved away from its
   * skeleton. Null for a view with no rig (a placeholder).
   */
  detach(limb: LimbId): THREE.Group | null {
    const rig = this.rig;
    if (!rig) return null;
    this.root.updateMatrixWorld(true);
    const spec = rig.limbs[limb];
    const sources: Array<{ mesh: THREE.SkinnedMesh; triangles: ArrayLike<number> | null }> = [];
    if (spec.owns) {
      const data = prepareLimbs(this.skinned[0], rig);
      sources.push({ mesh: this.skinned[0], triangles: data.triangles.get(limb)! });
    } else for (const name of spec.meshes ?? []) {
      const mesh = this.skinned.find(candidate => candidate.name === name);
      if (mesh) sources.push({ mesh, triangles: null });
    }
    const baked = sources.map(({ mesh, triangles }) => {
      const source = mesh.geometry, index = source.index!;
      const list = triangles ?? Array.from({ length: index.count / 3 }, (_, i) => i * 3);
      const remap = new Map<number, number>(), positions: number[] = [], uvs: number[] = [], indices: number[] = [];
      const v = new THREE.Vector3();
      // The model's own placement can mirror it, which turns every triangle inside out once its vertices are in world space.
      const flipped = mesh.matrixWorld.determinant() < 0;
      for (let t = 0; t < list.length; t++) for (let corner = 0; corner < 3; corner++) {
        const k = flipped ? [0, 2, 1][corner] : corner;
        const old = index.getX(list[t] + k);
        let next = remap.get(old);
        if (next === undefined) {
          next = remap.size; remap.set(old, next);
          v.fromBufferAttribute(source.attributes.position, old);
          mesh.applyBoneTransform(old, v).applyMatrix4(mesh.matrixWorld);
          positions.push(v.x, v.y, v.z);
          uvs.push(source.attributes.uv.getX(old), source.attributes.uv.getY(old));
        }
        indices.push(next);
      }
      return { mesh, positions, uvs, indices };
    }).filter(part => part.indices.length > 0);
    if (baked.length === 0) return null;
    const centre = new THREE.Vector3();
    let count = 0;
    for (const part of baked) for (let i = 0; i < part.positions.length; i += 3) { centre.x += part.positions[i]; centre.y += part.positions[i + 1]; centre.z += part.positions[i + 2]; count++; }
    centre.divideScalar(count);
    const group = new THREE.Group();
    group.position.copy(centre);
    for (const part of baked) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(part.positions.map((value, i) => value - centre.getComponent(i % 3)), 3));
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(part.uvs, 2));
      geometry.setIndex(part.indices);
      geometry.computeVertexNormals(); geometry.computeBoundingSphere();
      const material = this.materials[0].clone();
      // Cut open at one end: the inside of the skin shows, lit the right way round.
      material.side = THREE.DoubleSide;
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = false; mesh.receiveShadow = true;
      group.add(mesh);
    }
    return group;
  }

  expired(tick: number): boolean { return this.deathTick !== undefined && tick - this.deathTick > 240; }
  dispose(): void {
    this.mixer.stopAllAction(); this.mixer.uncacheRoot(this.mixer.getRoot());
    this.root.traverse(object => { if (object instanceof THREE.SkinnedMesh) object.skeleton.dispose(); });
    for (const material of this.materials) material.dispose();
    this.root.removeFromParent();
  }
}
