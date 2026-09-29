import * as THREE from 'three';
import type { BarrierState } from '../core/barrier.ts';
import type { Vec3, ZombieState } from '../core/types.ts';
import { ZOMBIE_GAIT_SPEEDS } from '../core/zombie.ts';
import { cloneZombieModel, type ZombieAnimation, type ZombieAsset } from './runtimeAssets.ts';
import { interpolatePosition } from './interpolation.ts';

/** Ground speed of the default zombie's run cycle at normal playback, in m/s (measured from foot travel). */
const RUN_CYCLE_PACE = 1.84;

export function zombieAnimation(zombie: ZombieState): ZombieAnimation {
  if (!zombie.alive) return 'death';
  if (zombie.entry?.phase === 'breaking' || (!zombie.entry && zombie.attackCooldownTicks > 25)) return 'attack';
  // Climbing a wall on the way in: clawing upward reads better than walking on air.
  if (zombie.entry?.phase === 'approach' && Math.abs(zombie.velocity.y) > 0.05) return 'attack';
  const moving = Math.hypot(zombie.velocity.x, zombie.velocity.z) > 0.05;
  return moving || zombie.entry?.phase === 'vaulting' ? (zombie.gait === 'walk' ? 'walk' : 'run') : 'idle';
}

export class SkinnedZombieView {
  readonly root = new THREE.Group();
  private readonly mixer: THREE.AnimationMixer;
  private readonly body: THREE.Group;
  private readonly actions = new Map<ZombieAnimation, THREE.AnimationAction>();
  private current?: THREE.AnimationAction;
  private lastTick?: number;
  private deathTick?: number;
  private yaw?: number;
  constructor(asset: ZombieAsset, private readonly phaseOffset: number) {
    const { body, model } = cloneZombieModel(asset);
    this.body = body; this.root.add(body); this.mixer = new THREE.AnimationMixer(model);
    for (const [name, clip] of Object.entries(asset.clips)) {
      const action = this.mixer.clipAction(clip);
      if (name === 'death') { action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true; }
      this.actions.set(name as ZombieAnimation, action);
    }
  }

  update(zombie: ZombieState, tick: number, barrier?: BarrierState, previous?: Vec3, alpha = 1): void {
    const position = interpolatePosition(previous, zombie.position, alpha);
    this.root.position.set(position.x, position.y, position.z);
    const phase = zombie.entry?.phase;
    // Which way it faces is the simulation's (its hit volumes turn with it); chase that so snapshots that arrive
    // a few ticks apart still turn the model smoothly.
    const elapsed = this.lastTick === undefined ? 0 : Math.max(0, Math.min(0.1, (tick - this.lastTick) / 60));
    this.yaw = this.yaw === undefined ? zombie.yaw
      : this.yaw + Math.atan2(Math.sin(zombie.yaw - this.yaw), Math.cos(zombie.yaw - this.yaw)) * (1 - Math.exp(-elapsed * 24));
    this.root.rotation.y = this.yaw;
    const name = zombieAnimation(zombie);
    const action = this.actions.get(name) ?? this.actions.get('idle');
    if (action && action !== this.current) {
      action.reset().play();
      if (name === 'walk' || name === 'run' || name === 'idle') action.time = this.phaseOffset % action.getClip().duration;
      this.current?.fadeOut(0.12); action.fadeIn(0.12); this.current = action;
    }
    // The pack has no sprint clip: play the run cycle at the zombie's ground speed so feet stay planted,
    // capped so sprinters' legs don't blur (they slide a little at full speed).
    if (action && name === 'run') action.timeScale = Math.min(1.6, ZOMBIE_GAIT_SPEEDS[zombie.gait] / RUN_CYCLE_PACE);
    const dt = this.lastTick === undefined ? 0 : Math.max(0, Math.min(0.1, (tick - this.lastTick) / 60));
    this.lastTick = tick; this.mixer.update(dt);
    this.body.scale.y = this.body.scale.x * (phase === 'vaulting' ? 0.85 : 1);
    if (!zombie.alive) {
      this.deathTick ??= tick;
      // Keep a short death pose, then sink/remove; fallback for the variant without a death clip.
      const elapsed = (tick - this.deathTick) / 60;
      if (!this.actions.has('death')) this.body.rotation.x = -Math.min(Math.PI / 2, elapsed * 2.5);
      this.root.position.y -= Math.max(0, elapsed - 2.5) * 0.7;
    }
  }
  expired(tick: number): boolean { return this.deathTick !== undefined && tick - this.deathTick > 240; }
  dispose(): void {
    this.mixer.stopAllAction(); this.mixer.uncacheRoot(this.mixer.getRoot());
    this.root.traverse(object => { if (object instanceof THREE.SkinnedMesh) object.skeleton.dispose(); });
    this.root.removeFromParent();
  }
}
