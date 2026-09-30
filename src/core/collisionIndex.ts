import { moveWithCollision, segmentHitsExpandedBox, type CollisionBox } from './collision.ts';
import type { Vec3 } from './types.ts';

/**
 * A coarse grid over a set of wall boxes, so a question about one place (can I walk this line, what is in my way
 * here) looks only at the few boxes around it instead of every box in the map. Asylum has 300 of them and asks
 * thousands of such questions a tick with a horde on the move.
 *
 * It answers exactly what a scan of the whole list would: a box is only skipped when it is too far away to matter.
 * The boxes are never changed after the index is built; build a new one when the set changes.
 */
export class CollisionIndex {
  private static readonly CELL = 3;
  private readonly minX: number;
  private readonly minZ: number;
  private readonly columns: number;
  private readonly rows: number;
  private readonly cells: number[][];
  private readonly seen: Uint32Array;
  private epoch = 0;

  constructor(readonly boxes: readonly CollisionBox[]) {
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (const box of boxes) {
      minX = Math.min(minX, box.min.x); maxX = Math.max(maxX, box.max.x);
      minZ = Math.min(minZ, box.min.z); maxZ = Math.max(maxZ, box.max.z);
    }
    if (!boxes.length) { minX = minZ = maxX = maxZ = 0; }
    this.minX = minX; this.minZ = minZ;
    this.columns = Math.max(1, Math.floor((maxX - minX) / CollisionIndex.CELL) + 1);
    this.rows = Math.max(1, Math.floor((maxZ - minZ) / CollisionIndex.CELL) + 1);
    this.cells = Array.from({ length: this.columns * this.rows }, () => []);
    this.seen = new Uint32Array(boxes.length);
    boxes.forEach((box, index) => {
      const lastColumn = this.column(box.max.x), lastRow = this.row(box.max.z);
      for (let r = this.row(box.min.z); r <= lastRow; r++) {
        for (let c = this.column(box.min.x); c <= lastColumn; c++) this.cells[r * this.columns + c].push(index);
      }
    });
  }

  private column(x: number): number {
    return Math.min(this.columns - 1, Math.max(0, Math.floor((x - this.minX) / CollisionIndex.CELL)));
  }

  private row(z: number): number {
    return Math.min(this.rows - 1, Math.max(0, Math.floor((z - this.minZ) / CollisionIndex.CELL)));
  }

  private nextEpoch(): number {
    if (++this.epoch >= 0xffff_ffff) { this.seen.fill(0); this.epoch = 1; }
    return this.epoch;
  }

  /**
   * Whether any box blocks a body `radius` wide and `height` tall walking from `start` to `end` (the same answer as
   * testing `segmentHitsExpandedBox` against every box). The line is followed in half-cell steps, looking at the
   * cells within a step and a radius of each point, which reaches every box the line could touch.
   */
  blocks(start: Vec3, end: Vec3, radius: number, height: number): boolean {
    if (!this.boxes.length) return false;
    const epoch = this.nextEpoch(), step = CollisionIndex.CELL / 2;
    const dx = end.x - start.x, dz = end.z - start.z;
    const samples = Math.max(1, Math.ceil(Math.hypot(dx, dz) / step));
    const reach = step / 2 + radius + 1e-6;
    let lastFrom = -1, lastTo = -1, lastRowFrom = -1, lastRowTo = -1;
    for (let i = 0; i <= samples; i++) {
      const x = start.x + dx * i / samples, z = start.z + dz * i / samples;
      const c0 = this.column(x - reach), c1 = this.column(x + reach), r0 = this.row(z - reach), r1 = this.row(z + reach);
      // Successive samples usually cover the same cells.
      if (c0 === lastFrom && c1 === lastTo && r0 === lastRowFrom && r1 === lastRowTo) continue;
      lastFrom = c0; lastTo = c1; lastRowFrom = r0; lastRowTo = r1;
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
        for (const index of this.cells[r * this.columns + c]) {
          if (this.seen[index] === epoch) continue;
          this.seen[index] = epoch;
          if (segmentHitsExpandedBox(start, end, this.boxes[index], radius, height)) return true;
        }
      }
    }
    return false;
  }

  /** The boxes whose footprint comes within `margin` of the point (a superset of those a nearby body could touch). */
  near(x: number, z: number, margin: number): CollisionBox[] {
    const found: CollisionBox[] = [];
    if (!this.boxes.length) return found;
    const epoch = this.nextEpoch();
    const c0 = this.column(x - margin), c1 = this.column(x + margin), r0 = this.row(z - margin), r1 = this.row(z + margin);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      for (const index of this.cells[r * this.columns + c]) {
        if (this.seen[index] === epoch) continue;
        this.seen[index] = epoch;
        const box = this.boxes[index];
        if (box.min.x - margin <= x && x <= box.max.x + margin && box.min.z - margin <= z && z <= box.max.z + margin) found.push(box);
      }
    }
    return found;
  }

  /** `moveWithCollision` against just the boxes the move could reach: the same result, without scanning the rest. */
  move(position: Vec3, delta: Vec3, radius: number, height: number): Vec3 {
    const margin = radius + Math.max(Math.abs(delta.x), Math.abs(delta.z)) + 1e-6;
    return moveWithCollision(position, delta, radius, height, this.near(position.x, position.z, margin));
  }
}
