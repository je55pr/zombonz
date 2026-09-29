import * as THREE from 'three';
import type { SimulationEvent } from '../core/simulation.ts';
import type { EntityId, Vec3, WorldState } from '../core/types.ts';
import type { GoreEffects } from './goreEffects.ts';
import type { SkinnedZombieView } from './skinnedZombieView.ts';

/** How many limbs may be copied off their zombies' skeletons in one frame: each copy skins a few thousand vertices by hand. */
const MAX_DETACHED_PER_FRAME = 3;

/**
 * Turns what the simulation says happened to zombies into what is seen: a spray where a bullet lands, a flash of the body,
 * a limb or a head flung away with blood after it, lumps and a spray from a zombie torn open, and a pool where one falls.
 * It only reads events; whether a limb is gone is the simulation's (and the view's, from `ZombieState.limbs`), so a late
 * arrival, or a co-op client, still sees the bodies as they are, just without the flying parts.
 */
export class GoreDirector {
  private readonly velocity = new THREE.Vector3();
  private readonly away = new THREE.Vector3();

  constructor(private readonly effects: GoreEffects, private readonly views: ReadonlyMap<EntityId, SkinnedZombieView>) {}

  consume(events: readonly SimulationEvent[], world: WorldState): void {
    let detached = 0;
    for (const event of events) {
      if (event.type === 'weaponHit') {
        if (!event.point) continue;
        const head = event.hitZone === 'head';
        const direction = event.direction ?? { x: 0, y: 0, z: 0 };
        // Out through the far side, and back toward the gun.
        this.effects.spray(event.point, direction, head ? 24 : 12, head ? 4.6 : 3.4, 0.32);
        this.effects.spray(event.point, { x: -direction.x, y: -direction.y + 0.2, z: -direction.z }, head ? 12 : 6, 2.2, 0.55);
        this.views.get(event.zombieId)?.flash();
      } else if (event.type === 'zombieDismembered') {
        detached += this.tear(event, world, MAX_DETACHED_PER_FRAME - detached);
      } else if (event.type === 'zombieDied') {
        const zombie = world.entities[event.zombieId];
        if (zombie) this.effects.splat(zombie.position.x, zombie.position.y, zombie.position.z, event.method === 'head' ? 1.1 : 0.85);
      }
    }
  }

  /** Returns how many limbs it detached. */
  private tear(event: Extract<SimulationEvent, { type: 'zombieDismembered' }>, world: WorldState, budget: number): number {
    const zombie = world.entities[event.zombieId];
    const view = this.views.get(event.zombieId);
    const floor = zombie?.position.y ?? event.point.y;
    const blast = event.source === 'explosion';
    let made = 0;
    for (const limb of event.lost) {
      const piece = made < budget ? view?.detach(limb) ?? null : null;
      if (!piece) { this.effects.spray(event.point, event.direction, 20, 3.4, 0.6); continue; }
      made++;
      const at: Vec3 = { x: piece.position.x, y: piece.position.y, z: piece.position.z };
      if (blast) {
        // Away from the blast, hard, and up.
        this.away.set(at.x - event.point.x, 0, at.z - event.point.z);
        if (this.away.lengthSq() < 1e-4) this.away.set(Math.random() - 0.5, 0, Math.random() - 0.5);
        this.away.normalize();
        const speed = 5 + Math.random() * 4;
        this.velocity.set(this.away.x * speed, 3 + Math.random() * 3.5, this.away.z * speed);
      } else {
        // Along the shot, which is what took it off; a head pops upward as well.
        const direction = event.direction ?? { x: 0, y: 0, z: 0 };
        const speed = 2.4 + Math.random() * 2.2;
        this.velocity.set(direction.x * speed, 1.6 + (limb === 'head' ? 2.2 : 0.8) + Math.random(), direction.z * speed);
      }
      this.effects.throwPiece(piece, this.velocity, limb === 'head' ? 0.13 : 0.08);
      this.effects.spray(at, { x: 0, y: 1, z: 0 }, limb === 'head' ? 42 : 26, 3.6, 0.7);
      if (limb === 'head' || blast) this.effects.splat(at.x, floor, at.z, 0.7);
    }
    if (event.gutted || (blast && event.lethal)) {
      const centre = zombie ? { x: zombie.position.x, y: zombie.position.y + 1.0, z: zombie.position.z } : event.point;
      this.effects.burst(centre, blast ? 14 : 6, blast ? 6.5 : 3.6);
      this.effects.spray(centre, null, blast ? 50 : 28, 4, 0.5);
      this.effects.splat(centre.x, floor, centre.z, blast ? 1.5 : 1);
    }
    if (event.lost.length === 0 && event.gutted) this.effects.spray(event.point, event.direction, 20, 3.4, 0.6);
    return made;
  }
}

