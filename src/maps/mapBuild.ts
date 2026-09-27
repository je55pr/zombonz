import { sampleWalkHeight, walkSurfaceHeight, type CollisionBox, type WalkSurface } from '../core/collision.ts';
import { hasClearNavigationLine, hasWalkableConnection, type NavigationGraph, type NavigationNode } from '../core/navigation.ts';
import type { BarrierDefinition } from '../core/barrier.ts';
import type { Vec3 } from '../core/types.ts';
import { propCollisionBox, type PropPlacement } from './bunkerProps.ts';
import type { GreyboxBox, GreyboxMaterial, GreyboxPrism, MapRail, MapWindow, SurfaceLook } from './gameMap.ts';

/**
 * Helpers for authoring a map in real metres: walls with window and door openings, floors, stairs,
 * parapets, and the derived barriers, collision and navigation. (Bunker predates this and builds the
 * same data by hand in bunker.ts.)
 */
export const WALL_THICKNESS = 0.4;
/** Window sill and lintel heights, and a doorway's clear height. */
export const SILL = 0.85, LINTEL = 2.65, DOOR_HEIGHT = 2.85;

export interface Opening {
  /** Centre along the wall, and width. */
  at: number; width: number;
  /** A boarded window (a zombie entry when on the ground floor), or a walk-through doorway. */
  kind: 'window' | 'door';
  id?: string;
}

export interface MapLooks { wall: SurfaceLook; trim: SurfaceLook; floor: SurfaceLook; stair: SurfaceLook }

export class MapBuilder {
  readonly shell: GreyboxBox[] = [];
  readonly prisms: GreyboxPrism[] = [];
  readonly windows: MapWindow[] = [];
  readonly surfaces: WalkSurface[] = [];
  readonly rails: MapRail[] = [];

  constructor(private readonly looks: MapLooks) {}

  private lookFor(material: GreyboxMaterial, size: Vec3): SurfaceLook {
    if (material === 'wall') return size.y > 2 && Math.max(size.x, size.z) > 2.4 ? this.looks.wall : this.looks.trim;
    if (material === 'floor' || material === 'upperFloor') return this.looks.floor;
    if (material === 'stair') return this.looks.stair;
    return material === 'barrier' ? 'splintered-wood' : 'rusted-metal';
  }

  box(x: number, y: number, z: number, sx: number, sy: number, sz: number, material: GreyboxMaterial,
    collides = true, look?: SurfaceLook): GreyboxBox {
    const size = { x: sx, y: sy, z: sz };
    const entry: GreyboxBox = { center: { x, y, z }, size, material, collides, look: look ?? this.lookFor(material, size) };
    this.shell.push(entry);
    return entry;
  }

  /** A walkable floor with its slab drawn beneath it. */
  floor(minX: number, maxX: number, minZ: number, maxZ: number, height: number): WalkSurface {
    const surface: WalkSurface = { minX, maxX, minZ, maxZ, startHeight: height, endHeight: height };
    this.surfaces.push(surface);
    this.box((minX + maxX) / 2, height - 0.12, (minZ + maxZ) / 2, maxX - minX, 0.24, maxZ - minZ,
      height > 0 ? 'upperFloor' : 'floor', false);
    return surface;
  }

  /** A slab nobody stands on: a ceiling or roof. */
  ceiling(minX: number, maxX: number, minZ: number, maxZ: number, height: number): void {
    this.box((minX + maxX) / 2, height + 0.12, (minZ + maxZ) / 2, maxX - minX, 0.24, maxZ - minZ, 'upperFloor', false);
  }

  /**
   * A wall along x (at z = fixed) or along z (at x = fixed), from `from` to `to`, `height` tall from
   * `base`. Windows keep a sill and lintel; doorways leave a gap under a header. `outward` is the side
   * a window's zombies come from (+1 or -1 along the wall's normal).
   */
  wall(axis: 'x' | 'z', fixed: number, from: number, to: number, base: number, height: number,
    openings: readonly Opening[] = [], outward = 1): void {
    const segment = (a: number, b: number, low: number, h: number) => {
      if (b - a <= 1e-6 || h <= 1e-6) return;
      if (axis === 'x') this.box((a + b) / 2, low + h / 2, fixed, b - a, h, WALL_THICKNESS, 'wall');
      else this.box(fixed, low + h / 2, (a + b) / 2, WALL_THICKNESS, h, b - a, 'wall');
    };
    let cursor = from;
    for (const opening of [...openings].sort((a, b) => a.at - b.at)) {
      const start = opening.at - opening.width / 2, end = opening.at + opening.width / 2;
      segment(cursor, start, base, height);
      if (opening.kind === 'window') {
        segment(start, end, base, SILL);
        segment(start, end, base + LINTEL, height - LINTEL);
        this.windows.push({ id: opening.id ?? `${axis}${fixed}:${opening.at}`, x: axis === 'x' ? opening.at : fixed,
          z: axis === 'x' ? fixed : opening.at, y: base, axis, width: opening.width,
          outward: axis === 'x' ? { x: 0, y: 0, z: outward } : { x: outward, y: 0, z: 0 } });
      } else segment(start, end, base + DOOR_HEIGHT, height - DOOR_HEIGHT);
      cursor = end;
    }
    segment(cursor, to, base, height);
  }

  /** A waist-high rail wall along one edge of an upper floor or stair. */
  parapet(axis: 'x' | 'z', fixed: number, from: number, to: number, base: number, height = 0.95): void {
    if (axis === 'x') this.box((from + to) / 2, base + height / 2, fixed, to - from, height, 0.2, 'wall');
    else this.box(fixed, base + height / 2, (from + to) / 2, 0.2, height, to - from, 'wall');
  }

  /**
   * A straight stair climbing from `bottom` to `top` along its axis; `risesTowardMax` says which end is
   * high. Treads are drawn; the walk surface is a continuous slope, as in Bunker.
   */
  stair(minX: number, maxX: number, minZ: number, maxZ: number, axis: 'x' | 'z', risesTowardMax: boolean,
    bottom: number, top: number, treads = 20): WalkSurface {
    const surface: WalkSurface = { minX, maxX, minZ, maxZ, slopeAxis: axis,
      startHeight: risesTowardMax ? bottom : top, endHeight: risesTowardMax ? top : bottom };
    this.surfaces.push(surface);
    const length = axis === 'x' ? maxX - minX : maxZ - minZ, step = length / treads;
    for (let i = 0; i < treads; i++) {
      const along = (axis === 'x' ? minX : minZ) + (i + 0.5) * step;
      const t = (i + 0.5) / treads, height = bottom + (top - bottom) * (risesTowardMax ? t : 1 - t);
      if (axis === 'x') this.box(along, height - 0.085, (minZ + maxZ) / 2, step, 0.17, maxZ - minZ, 'stair', false);
      else this.box((minX + maxX) / 2, height - 0.085, along, maxX - minX, 0.17, step, 'stair', false);
    }
    return surface;
  }
}

/**
 * Ground-floor windows become zombie entries: a path in from five metres outside, a landing just
 * inside. Upper windows stay decorative unless listed in `upperEntries`; zombies reach those along a
 * short outside ledge (the map draws it) instead.
 */
export function barriersFromWindows(windows: readonly MapWindow[], boards: number,
  upperEntries: readonly string[] = []): BarrierDefinition[] {
  return windows.filter(w => w.y === 0 || upperEntries.includes(w.id)).map(w => {
    const point = (distance: number, sideways = 0): Vec3 => ({
      x: w.x + w.outward.x * distance + w.outward.z * sideways, y: w.y,
      z: w.z + w.outward.z * distance - w.outward.x * sideways,
    });
    const approachPath = w.y === 0 ? [point(5, 0.6), point(2.4, 0.6), point(0.85)] : [point(2.6, 0.6), point(1.8, 0.6), point(0.85)];
    return { id: w.id, position: { x: w.x, y: w.y, z: w.z }, outward: w.outward, width: w.width, maxBoards: boards,
      approachPath, insidePoint: point(-0.95) };
  });
}

export function collisionBoxesFor(shell: readonly GreyboxBox[], props: readonly PropPlacement[]): CollisionBox[] {
  return [
    ...shell.filter(b => b.collides).map(b => ({
      min: { x: b.center.x - b.size.x / 2, y: b.center.y - b.size.y / 2, z: b.center.z - b.size.z / 2 },
      max: { x: b.center.x + b.size.x / 2, y: b.center.y + b.size.y / 2, z: b.center.z + b.size.z / 2 },
    })),
    ...props.filter(p => p.solid).map(propCollisionBox),
  ];
}

/** Level upper floors stop bullets fired from below. */
export function slabShotBlockers(surfaces: readonly WalkSurface[], height: number): CollisionBox[] {
  return surfaces.filter(s => s.startHeight === height && s.endHeight === height && !s.polygon)
    .map(s => ({ min: { x: s.minX, y: height - 0.24, z: s.minZ }, max: { x: s.maxX, y: height, z: s.maxZ } }));
}

/**
 * A sparse grid over every level floor plus hand-placed points (stair centre-lines, doorways, entry
 * landings), linked where the line between two nodes is clear and walkable both ways.
 */
export function compileNavigation(surfaces: readonly WalkSurface[], collision: readonly CollisionBox[],
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number }, levels: readonly number[],
  points: readonly { id: string; position: Vec3 }[]): NavigationGraph {
  const nodes: NavigationNode[] = [];
  const add = (id: string, position: Vec3) => {
    if (hasClearNavigationLine(position, position, collision, 0.34)) nodes.push({ id, position, neighbors: [] });
  };
  for (const y of levels) for (let x = bounds.minX; x < bounds.maxX; x += 1.5) for (let z = bounds.minZ; z < bounds.maxZ; z += 1.5) {
    if (sampleWalkHeight(x, z, y, surfaces) === y
      && surfaces.some(s => s.startHeight === y && s.endHeight === y && walkSurfaceHeight(s, x, z) === y)) {
      add(`floor-${y}-${x.toFixed(2)}-${z.toFixed(2)}`, { x, y, z });
    }
  }
  for (const point of points) add(point.id, point.position);
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
    const a = nodes[i], b = nodes[j];
    if (Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z) > 3.2) continue;
    if (hasClearNavigationLine(a.position, b.position, collision, 0.34)
      && hasWalkableConnection(a.position, b.position, surfaces) && hasWalkableConnection(b.position, a.position, surfaces)) {
      (a.neighbors as string[]).push(b.id); (b.neighbors as string[]).push(a.id);
    }
  }
  return { nodes };
}
