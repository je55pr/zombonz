import type { Vec3 } from '../core/types.ts';
import type { GreyboxBox, GreyboxMaterial, SurfaceLook } from './gameMap.ts';

export interface Rect { minX: number; maxX: number; minZ: number; maxZ: number }
type Side = 'north' | 'south' | 'east' | 'west';

/**
 * Builders for what players look at but never reach: boundary walls and fences, outbuildings, garden
 * beds and street furniture, all as greybox boxes in metres (x east, z south). Solid pieces collide, so
 * zombie routes are tested against them; trim, planks and roofs are visual only.
 */
export class Scenery {
  readonly boxes: GreyboxBox[] = [];

  box(x: number, y: number, z: number, sx: number, sy: number, sz: number, look: SurfaceLook, collides = false,
    extra: Partial<GreyboxBox> = {}, material: GreyboxMaterial = 'wall'): GreyboxBox {
    const entry: GreyboxBox = { center: { x, y, z }, size: { x: sx, y: sy, z: sz }, material, collides, look, ...extra };
    this.boxes.push(entry);
    return entry;
  }

  /** An invisible solid block, for dressing whose visible parts are too fine to collide one by one. */
  solid(minX: number, maxX: number, minZ: number, maxZ: number, height: number): void {
    this.box((minX + maxX) / 2, height / 2, (minZ + maxZ) / 2, maxX - minX, height, maxZ - minZ, 'rusted-metal', true, { visible: false });
  }

  /** A box running along x (at z = fixed) or along z (at x = fixed). */
  private run(axis: 'x' | 'z', fixed: number, from: number, to: number, base: number, height: number, depth: number,
    look: SurfaceLook, collides: boolean): void {
    if (to - from < 0.02) return;
    const along = (from + to) / 2, length = to - from;
    if (axis === 'x') this.box(along, base + height / 2, fixed, length, height, depth, look, collides);
    else this.box(fixed, base + height / 2, along, depth, height, length, look, collides);
  }

  /**
   * A brick boundary wall along x or z, capped with concrete and stiffened by piers; `gaps` are
   * [centre, width] openings (gateways).
   */
  wall(axis: 'x' | 'z', fixed: number, from: number, to: number,
    { height = 2.6, thickness = 0.5, pierEvery = 8, gaps = [] as ReadonlyArray<readonly [number, number]>,
      look = 'broken-plaster-brick' as SurfaceLook } = {}): void {
    const openings = [...gaps].sort((a, b) => a[0] - b[0]).map(([at, width]) => [at - width / 2, at + width / 2] as const);
    let cursor = from;
    for (const [start, end] of [...openings, [to, to] as const]) {
      this.run(axis, fixed, cursor, start, 0, height, thickness, look, true);
      this.run(axis, fixed, cursor, start, height, 0.14, thickness + 0.16, 'weathered-concrete-a', false);
      cursor = end;
    }
    const pier = (at: number) => this.run(axis, fixed, at - 0.4, at + 0.4, 0, height + 0.3, 0.8, 'weathered-concrete-a', true);
    for (let at = from; at <= to + 1e-6; at += pierEvery) {
      if (!openings.some(([start, end]) => at > start - 0.6 && at < end + 0.6)) pier(at);
    }
  }

  /** A wrought-iron gateway: tall piers either side, one leaf shut and the other swung open. */
  gate(axis: 'x' | 'z', fixed: number, at: number, width: number, height = 2.4): void {
    for (const side of [-1, 1]) this.run(axis, fixed, at + side * (width / 2 + 0.55) - 0.55, at + side * (width / 2 + 0.55) + 0.55,
      0, height + 1.2, 1.1, 'weathered-concrete-a', true);
    const leaf = width / 2;
    // The shut leaf spans half the opening; bars every 0.22 m between two rails.
    for (let u = 0.1; u < leaf; u += 0.22) this.run(axis, fixed, at - leaf + u - 0.025, at - leaf + u + 0.025, 0, height, 0.05, 'rusted-metal', false);
    for (const h of [0.25, height - 0.2]) this.run(axis, fixed, at - leaf, at, h, 0.06, 0.06, 'rusted-metal', false);
    // The open leaf stands at right angles to the wall, inside it.
    const hinge = at + leaf, other: 'x' | 'z' = axis === 'x' ? 'z' : 'x';
    for (let u = 0.1; u < leaf; u += 0.22) this.run(other, hinge, fixed - u - 0.025, fixed - u + 0.025, 0, height, 0.05, 'rusted-metal', false);
    for (const h of [0.25, height - 0.2]) this.run(other, hinge, fixed - leaf, fixed, h, 0.06, 0.06, 'rusted-metal', false);
    this.solid(axis === 'x' ? at - leaf : fixed - 0.05, axis === 'x' ? at : fixed + 0.05,
      axis === 'x' ? fixed - 0.05 : at - leaf, axis === 'x' ? fixed + 0.05 : at, height);
  }

  /**
   * A small building nobody enters: solid walls, boarded-up windows and a door, under a gabled roof
   * whose ridge runs along its longer side (or a flat roof with a coping).
   */
  building(r: Rect, { height = 3, walls = 'broken-plaster-brick' as SurfaceLook, roof = 'rusted-metal' as SurfaceLook,
    pitch = 1.5, flat = false, windows = [] as ReadonlyArray<readonly [Side, number]>, door = null as readonly [Side, number] | null } = {}): void {
    const cx = (r.minX + r.maxX) / 2, cz = (r.minZ + r.maxZ) / 2, width = r.maxX - r.minX, depth = r.maxZ - r.minZ;
    this.box(cx, height / 2, cz, width, height, depth, walls, true);
    if (flat) {
      this.box(cx, height + 0.1, cz, width + 0.2, 0.2, depth + 0.2, 'weathered-concrete-a');
    } else {
      const ridgeX = width >= depth, across = ridgeX ? depth : width;
      // The walls' own gable ends show at either end of the overhanging roof.
      this.box(cx, height + pitch / 2, cz, width + (ridgeX ? 0.04 : 0), pitch, depth + (ridgeX ? 0 : 0.04), walls, false,
        { shape: ridgeX ? 'gableX' : 'gableZ' });
      const eaves = (across + 0.7) / across;
      this.box(cx, height + pitch * eaves / 2 - 0.02, cz, width + (ridgeX ? 0 : 0.7), pitch * eaves, depth + (ridgeX ? 0.7 : 0), roof, false,
        { shape: ridgeX ? 'gableX' : 'gableZ' });
    }
    const face = (side: Side, at: number, w: number, h: number, bottom: number, look: SurfaceLook) => {
      const out = 0.04;
      if (side === 'north') this.box(r.minX + at, bottom + h / 2, r.minZ - out, w, h, 0.06, look);
      if (side === 'south') this.box(r.minX + at, bottom + h / 2, r.maxZ + out, w, h, 0.06, look);
      if (side === 'west') this.box(r.minX - out, bottom + h / 2, r.minZ + at, 0.06, h, w, look);
      if (side === 'east') this.box(r.maxX + out, bottom + h / 2, r.minZ + at, 0.06, h, w, look);
    };
    for (const [side, at] of windows) {
      face(side, at, 1.2, 1.3, 1, 'rusted-metal');
      for (const y of [1.2, 1.55, 1.9]) face(side, at, 1.35, 0.24, y, 'old-planks');
    }
    if (door) face(door[0], door[1], 1.1, 2.1, 0, 'old-planks');
  }

  /** A wooden bench along x or z. */
  bench(x: number, z: number, along: 'x' | 'z'): void {
    const [lx, lz] = along === 'x' ? [1.8, 0.45] : [0.45, 1.8];
    this.box(x, 0.45, z, lx, 0.07, lz, 'old-planks');
    const back = along === 'x' ? { x, z: z - 0.2 } : { x: x - 0.2, z };
    this.box(back.x, 0.78, back.z, along === 'x' ? 1.8 : 0.06, 0.3, along === 'x' ? 0.06 : 1.8, 'old-planks');
    for (const end of [-0.75, 0.75]) {
      this.box(x + (along === 'x' ? end : 0), 0.4, z + (along === 'z' ? end : 0), along === 'x' ? 0.06 : 0.45, 0.8, along === 'x' ? 0.45 : 0.06, 'rusted-metal');
    }
    this.solid(x - lx / 2, x + lx / 2, z - lz / 2, z + lz / 2, 0.9);
  }

  /** An iron lamp post (unlit, the power to it long gone). */
  lampPost(x: number, z: number): void {
    this.box(x, 1.7, z, 0.12, 3.4, 0.12, 'rusted-metal', true);
    this.box(x, 0.2, z, 0.3, 0.4, 0.3, 'rusted-metal');
    this.box(x, 3.5, z, 0.32, 0.4, 0.32, 'rusted-metal');
  }

  /** A raised planting bed: a concrete kerb around bare soil. */
  bed(r: Rect, height = 0.4): void {
    const k = 0.22;
    this.run('x', r.minZ + k / 2, r.minX, r.maxX, 0, height, k, 'weathered-concrete-b', false);
    this.run('x', r.maxZ - k / 2, r.minX, r.maxX, 0, height, k, 'weathered-concrete-b', false);
    this.run('z', r.minX + k / 2, r.minZ + k, r.maxZ - k, 0, height, k, 'weathered-concrete-b', false);
    this.run('z', r.maxX - k / 2, r.minZ + k, r.maxZ - k, 0, height, k, 'weathered-concrete-b', false);
    this.box((r.minX + r.maxX) / 2, height - 0.06, (r.minZ + r.maxZ) / 2, r.maxX - r.minX - 2 * k, 0.1, r.maxZ - r.minZ - 2 * k,
      'dirt', false, {}, 'floor');
    this.solid(r.minX, r.maxX, r.minZ, r.maxZ, height);
  }

  /** A barbed-wire fence on timber posts, along x or z. */
  fence(axis: 'x' | 'z', fixed: number, from: number, to: number, { postEvery = 3, height = 1.6 } = {}): void {
    for (let at = from; at <= to + 1e-6; at += postEvery) this.run(axis, fixed, at - 0.07, at + 0.07, 0, height, 0.14, 'splintered-wood', false);
    for (const h of [0.45, 0.95, 1.45]) this.run(axis, fixed, from, to, h, 0.025, 0.025, 'rusted-metal', false);
    if (axis === 'x') this.solid(from, to, fixed - 0.1, fixed + 0.1, height);
    else this.solid(fixed - 0.1, fixed + 0.1, from, to, height);
  }

  /** A sandbag wall along x or z from a corner: `rows` courses of bags, each course offset by half a bag. */
  sandbags(x: number, z: number, along: 'x' | 'z', bags: number, rows = 3): void {
    for (let row = 0; row < rows; row++) for (let i = 0; i < bags - (row % 2); i++) {
      const at = (i + (row % 2) * 0.5) * 0.62 + 0.31;
      this.box(along === 'x' ? x + at : x, row * 0.19 + 0.1, along === 'z' ? z + at : z,
        along === 'x' ? 0.58 : 0.36, 0.2, along === 'x' ? 0.36 : 0.58, 'dirt');
    }
    this.solid(along === 'x' ? x : x - 0.18, along === 'x' ? x + bags * 0.62 : x + 0.18,
      along === 'z' ? z : z - 0.18, along === 'z' ? z + bags * 0.62 : z + 0.18, rows * 0.19);
  }

  /** A Czech hedgehog tank trap: three steel beams crossed at the middle. */
  tankTrap(x: number, z: number): void {
    for (const tilt of [0.62, -0.62]) this.box(x, 0.62, z, 1.9, 0.14, 0.14, 'rusted-metal', false, { rotationZ: tilt });
    this.box(x, 0.62, z, 0.14, 0.14, 1.9, 'rusted-metal', false, { rotationX: 0.62 });
    this.solid(x - 0.75, x + 0.75, z - 0.75, z + 0.75, 1.2);
  }

  /** A timber watchtower: four legs, a railed platform and a pitched roof. */
  watchtower(x: number, z: number, { legs = 4.6, size = 3 } = {}): void {
    const half = size / 2 - 0.12;
    for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) this.box(x + dx * half, (legs + 3) / 2, z + dz * half, 0.22, legs + 3, 0.22, 'splintered-wood', true);
    this.box(x, legs, z, size + 0.3, 0.16, size + 0.3, 'old-planks');
    for (const side of [-1, 1]) {
      this.box(x, legs + 0.55, z + side * (size / 2 + 0.1), size + 0.3, 0.9, 0.06, 'old-planks');
      this.box(x + side * (size / 2 + 0.1), legs + 0.55, z, 0.06, 0.9, size + 0.3, 'old-planks');
    }
    // Cross braces between the legs, low down.
    for (const side of [-1, 1]) this.box(x, legs * 0.35, z + side * half, size, 0.14, 0.1, 'splintered-wood', false, { rotationZ: 0.55 });
    this.box(x, legs + 3.25, z, size + 0.6, 1, size + 0.6, 'rusted-metal', false, { shape: 'gableX' });
  }
}

/** A point on the ground. */
export const onGround = (x: number, z: number): Vec3 => ({ x, y: 0, z });
