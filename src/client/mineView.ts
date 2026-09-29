import * as THREE from 'three';
import { MINE_RULES, type MineState } from '../core/grenade.ts';
import { createMineModel, poseMine, type MineModel } from './explosiveModels.ts';

/** Bouncing Betties on the floor: half-buried, blinking while they arm, and leaping when a zombie springs one. */
export class MineView {
  private readonly models = new Map<string, MineModel>();

  constructor(private readonly scene: THREE.Scene) {}

  update(mines: readonly MineState[], seconds: number): void {
    const present = new Set(mines.map(mine => mine.id));
    for (const [id, model] of this.models) if (!present.has(id)) {
      model.root.removeFromParent(); model.lampMaterial.dispose(); this.models.delete(id);
    }
    for (const mine of mines) {
      let model = this.models.get(mine.id);
      if (!model) {
        model = createMineModel();
        // Each is turned its own way, so a field of them doesn't look stamped out.
        model.root.rotation.y = Number(mine.id.slice(2)) * 2.399;
        this.scene.add(model.root); this.models.set(mine.id, model);
      }
      model.root.position.set(mine.position.x, mine.position.y, mine.position.z);
      const popping = mine.phase === 'popping';
      poseMine(model, mine.phase, popping ? 1 - mine.ticksRemaining / MINE_RULES.popTicks : 0, seconds, MINE_RULES.popHeight - 0.12);
    }
  }

  /** Removes every mine drawn: a new match starts. */
  clear(): void {
    for (const model of this.models.values()) { model.root.removeFromParent(); model.lampMaterial.dispose(); }
    this.models.clear();
  }
}
