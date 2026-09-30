import { sampleWalkHeight, segmentHitsExpandedBox, type CollisionBox, type WalkSurface } from './collision.ts';
import { CollisionIndex } from './collisionIndex.ts';
import { work } from './profiling.ts';
import type { Vec3 } from './types.ts';

export interface NavigationNode {
  id: string;
  position: Vec3;
  neighbors: readonly string[];
}

export interface NavigationGraph {
  nodes: readonly NavigationNode[];
}

function distanceSquared(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

export function nearestNavigationNode(graph: NavigationGraph, position: Vec3): NavigationNode | null {
  let best: NavigationNode | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const node of graph.nodes) {
    const candidate = distanceSquared(node.position, position);
    if (candidate < bestDistance || (candidate === bestDistance && node.id < (best?.id ?? ''))) {
      best = node;
      bestDistance = candidate;
    }
  }
  return best;
}

function nodeMap(graph: NavigationGraph): Map<string, NavigationNode> {
  return new Map(graph.nodes.map((node) => [node.id, node]));
}

export function shortestNavigationPath(
  graph: NavigationGraph,
  startId: string,
  goalId: string,
): NavigationNode[] {
  const nodes = nodeMap(graph);
  if (!nodes.has(startId) || !nodes.has(goalId)) return [];
  if (startId === goalId) return [nodes.get(startId)!];

  const queue = [startId];
  const previous = new Map<string, string | null>([[startId, null]]);
  for (let index = 0; index < queue.length; index += 1) {
    const id = queue[index];
    const node = nodes.get(id)!;
    for (const neighbor of [...node.neighbors].sort()) {
      if (!nodes.has(neighbor) || previous.has(neighbor)) continue;
      previous.set(neighbor, id);
      if (neighbor === goalId) break;
      queue.push(neighbor);
    }
    if (previous.has(goalId)) break;
  }
  if (!previous.has(goalId)) return [];
  const ids: string[] = [];
  let current: string | null = goalId;
  while (current) {
    ids.push(current);
    current = previous.get(current) ?? null;
  }
  ids.reverse();
  return ids.map((id) => nodes.get(id)!);
}

export function hasClearNavigationLine(
  start: Vec3,
  end: Vec3,
  collisionBoxes: readonly CollisionBox[],
  radius = 0,
  height = 1.72,
): boolean {
  return !collisionBoxes.some((box) => segmentHitsExpandedBox(
    start, end, box, radius, height,
  ));
}

export function navigationWaypoint(
  graph: NavigationGraph | undefined,
  start: Vec3,
  goal: Vec3,
  collisionBoxes: readonly CollisionBox[],
  radius = 0,
  surfaces: readonly WalkSurface[] = [],
): Vec3 {
  return createNavigationQuery(graph, collisionBoxes, radius, surfaces)(start, goal);
}

export type NavigationQuery = (start: Vec3, goal: Vec3) => Vec3;

/** A body tall enough to test lines with is 1.72 m, as the zombies are. */
const LINE_HEIGHT = 1.72;
/** Nodes are found through a grid of this cell size. */
const NODE_CELL = 3;
/** Answers about where a position is nearest the graph are remembered for this many positions. */
const NEAREST_MEMORY = 256;
/** Routes are remembered for this many start/goal pairs before the memory is cleared. */
const ROUTE_MEMORY = 4096;
/** Within this far of the first node of its route, a body counts as standing at it and heads for the next. */
const AT_NODE = 0.25;

/**
 * Everything about a map's navigation that does not change while a match runs: the graph laid out for quick lookup,
 * which links are clear of the fixed walls and are floor all the way, and a grid over the walls. Build one per map
 * (see `navigationFieldFor`); then `query` makes the question-answerer for the moment's doors and other movable
 * solids, which is cheap enough to remake whenever one changes.
 */
export class NavigationField {
  private readonly nodes: readonly NavigationNode[];
  /** For each node, the nodes it links to, in id order (the order routes are searched in). */
  private readonly links: Int32Array[];
  /** `links`, cut to the ones clear of the fixed walls and walkable, worked out the first time each is wanted. */
  private readonly clearLinks: Array<Int32Array | undefined>;
  private readonly walls: CollisionIndex;
  private readonly gridMinX: number;
  private readonly gridMinZ: number;
  private readonly gridMaxX: number;
  private readonly gridMaxZ: number;
  private readonly gridMinY: number;
  private readonly gridMaxY: number;
  private readonly columns: number;
  private readonly rows: number;
  private readonly buckets: number[][];
  private readonly tested: Uint32Array;
  private testEpoch = 0;
  private readonly parent: Int32Array;
  private readonly reached: Uint32Array;
  private reachEpoch = 0;
  private readonly queue: Int32Array;

  constructor(readonly graph: NavigationGraph | undefined, readonly fixed: readonly CollisionBox[],
    readonly radius: number, readonly surfaces: readonly WalkSurface[]) {
    this.nodes = graph?.nodes ?? [];
    const count = this.nodes.length;
    const indexOf = new Map<string, number>(this.nodes.map((node, index) => [node.id, index]));
    this.links = this.nodes.map(node => Int32Array.from([...node.neighbors].sort()
      .flatMap(id => indexOf.has(id) ? [indexOf.get(id)!] : [])));
    this.clearLinks = new Array(count).fill(undefined);
    this.walls = new CollisionIndex(fixed);
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const { position } of this.nodes) {
      minX = Math.min(minX, position.x); maxX = Math.max(maxX, position.x);
      minZ = Math.min(minZ, position.z); maxZ = Math.max(maxZ, position.z);
      minY = Math.min(minY, position.y); maxY = Math.max(maxY, position.y);
    }
    if (!count) minX = minZ = maxX = maxZ = minY = maxY = 0;
    this.gridMinX = minX; this.gridMaxX = maxX; this.gridMinZ = minZ; this.gridMaxZ = maxZ; this.gridMinY = minY; this.gridMaxY = maxY;
    this.columns = Math.floor((maxX - minX) / NODE_CELL) + 1;
    this.rows = Math.floor((maxZ - minZ) / NODE_CELL) + 1;
    this.buckets = Array.from({ length: this.columns * this.rows }, () => []);
    this.nodes.forEach(({ position }, index) => {
      this.buckets[this.row(position.z) * this.columns + this.column(position.x)].push(index);
    });
    this.tested = new Uint32Array(count);
    this.parent = new Int32Array(count);
    this.reached = new Uint32Array(count);
    this.queue = new Int32Array(count);
  }

  /** Whether this field was built for these very walls, radius and floors. */
  matches(fixed: readonly CollisionBox[], radius: number, surfaces: readonly WalkSurface[]): boolean {
    return radius === this.radius && surfaces === this.surfaces && fixed.length === this.fixed.length
      && fixed.every((box, index) => box === this.fixed[index]);
  }

  private column(x: number): number {
    return Math.min(this.columns - 1, Math.max(0, Math.floor((x - this.gridMinX) / NODE_CELL)));
  }

  private row(z: number): number {
    return Math.min(this.rows - 1, Math.max(0, Math.floor((z - this.gridMinZ) / NODE_CELL)));
  }

  /** The links of a node that a body can walk against the fixed walls and floors alone. */
  private clear(index: number): Int32Array {
    let links = this.clearLinks[index];
    if (links) return links;
    const from = this.nodes[index].position, open: number[] = [];
    for (const other of this.links[index]) {
      const to = this.nodes[other].position;
      work.navigationLineTests++;
      if (!this.walls.blocks(from, to, this.radius, LINE_HEIGHT) && hasWalkableConnection(from, to, this.surfaces)) open.push(other);
    }
    links = Int32Array.from(open);
    this.clearLinks[index] = links;
    return links;
  }

  /**
   * The answerer of "which way do I go to get from here to there" for the fixed walls plus `movable` solids (the
   * doors that are shut, the box, hazards): the point to head for. It is straight at the goal when the way is
   * clear, else the furthest node along the shortest route that can be walked to directly, and the start itself
   * when there is no way. (Each end of the route is the nearest node that can be walked to, or failing that the nearest.) The route is a fewest-links one over the links these solids leave open.
   */
  query(movable: readonly CollisionBox[] = []): NavigationQuery {
    work.navigationRebuilds++;
    const { nodes, radius, surfaces } = this;
    const blocked = (a: Vec3, b: Vec3) => this.walls.blocks(a, b, radius, LINE_HEIGHT)
      || movable.some(box => segmentHitsExpandedBox(a, b, box, radius, LINE_HEIGHT));
    const traversable = (a: Vec3, b: Vec3) => { work.navigationLineTests++; return !blocked(a, b) && hasWalkableConnection(a, b, surfaces); };
    const open: Array<Int32Array | undefined> = new Array(nodes.length).fill(undefined);
    const openLinks = (index: number): Int32Array => {
      let links = open[index];
      if (links) return links;
      links = this.clear(index);
      if (movable.length) {
        const from = nodes[index].position;
        links = links.filter(other => !movable.some(box => segmentHitsExpandedBox(from, nodes[other].position, box, radius, LINE_HEIGHT)));
      }
      open[index] = links;
      return links;
    };
    const routes = new Map<number, Int32Array>();
    const nearest = new Map<string, number>();
    const nearestReachable = (position: Vec3): number => {
      const key = `${position.x},${position.y},${position.z}`;
      const known = nearest.get(key);
      if (known !== undefined) { work.navigationNodeHits++; return known; }
      // A spot no node can be walked to from (a nook between nodes) heads for the nearest node anyway: standing still
      // there forever is worse than pressing toward it and sliding along whatever is in the way.
      let found = this.nearestWhere(position, traversable);
      if (found < 0) found = this.nearestWhere(position, () => true);
      if (nearest.size >= NEAREST_MEMORY) nearest.delete(nearest.keys().next().value!);
      nearest.set(key, found);
      return found;
    };
    return (start, goal) => {
      work.navigationQueries++;
      if (traversable(start, goal)) { work.navigationDirect++; return goal; }
      if (nodes.length === 0) return goal;
      const startNode = nearestReachable(start);
      const goalNode = nearestReachable(goal);
      if (startNode < 0 || goalNode < 0) return start;
      const routeKey = startNode * nodes.length + goalNode;
      let route = routes.get(routeKey);
      if (route) work.navigationSearchHits++;
      else {
        work.navigationSearches++;
        route = this.route(openLinks, startNode, goalNode);
        if (routes.size >= ROUTE_MEMORY) routes.clear();
        routes.set(routeKey, route);
      }
      if (route.length === 0) return start;
      // Standing at the route's first node, the way on is the next: whether some far node is in sight from this very
      // spot can turn on a centimetre, and heading back for the first one then forth again is how a body ends up dithering.
      const first = nodes[route[0]].position;
      const lowest = route.length > 1 && Math.hypot(first.x - start.x, first.z - start.z) < AT_NODE && Math.abs(first.y - start.y) < 1 ? 1 : 0;
      for (let index = route.length - 1; index >= lowest; index -= 1) {
        const position = nodes[route[index]].position;
        if (traversable(start, position)) return position;
      }
      return nodes[route[lowest]].position;
    };
  }

  /**
   * The node nearest `position` (ties to the smaller id) that `reachable` accepts, or -1. Nodes are tried nearest
   * first from a widening ring, so only those closer than the answer are ever tried.
   */
  private nearestWhere(position: Vec3, reachable: (from: Vec3, to: Vec3) => boolean): number {
    if (!this.nodes.length) return -1;
    if (++this.testEpoch >= 0xffff_ffff) { this.tested.fill(0); this.testEpoch = 1; }
    const epoch = this.testEpoch;
    const farthest = Math.max(Math.abs(position.x - this.gridMinX), Math.abs(position.x - this.gridMaxX)) ** 2
      + Math.max(Math.abs(position.z - this.gridMinZ), Math.abs(position.z - this.gridMaxZ)) ** 2
      + Math.max(Math.abs(position.y - this.gridMinY), Math.abs(position.y - this.gridMaxY)) ** 2;
    for (let radius = NODE_CELL; ; radius *= 2) {
      const limit = radius * radius;
      const found: Array<{ index: number; distance: number }> = [];
      const c1 = this.column(position.x + radius), r1 = this.row(position.z + radius);
      for (let r = this.row(position.z - radius); r <= r1; r++) for (let c = this.column(position.x - radius); c <= c1; c++) {
        for (const index of this.buckets[r * this.columns + c]) {
          if (this.tested[index] === epoch) continue;
          const distance = distanceSquared(this.nodes[index].position, position);
          if (distance <= limit) found.push({ index, distance });
        }
      }
      found.sort((a, b) => a.distance - b.distance || this.nodes[a.index].id.localeCompare(this.nodes[b.index].id));
      for (const { index } of found) {
        this.tested[index] = epoch;
        work.navigationNodeScans++;
        if (reachable(position, this.nodes[index].position)) return index;
      }
      if (limit >= farthest) return -1;
    }
  }

  /** The fewest-links route from one node to another over the links `open` allows (empty when there is none). */
  private route(open: (index: number) => Int32Array, start: number, goal: number): Int32Array {
    if (start === goal) return Int32Array.of(start);
    if (++this.reachEpoch >= 0xffff_ffff) { this.reached.fill(0); this.reachEpoch = 1; }
    const epoch = this.reachEpoch, { queue, parent, reached } = this;
    reached[start] = epoch; parent[start] = -1; queue[0] = start;
    let tail = 1;
    for (let head = 0; head < tail; head++) {
      const from = queue[head];
      for (const next of open(from)) {
        if (reached[next] === epoch) continue;
        reached[next] = epoch; parent[next] = from;
        if (next === goal) {
          const path: number[] = [];
          for (let node = goal; node >= 0; node = parent[node]) path.push(node);
          return Int32Array.from(path.reverse());
        }
        queue[tail++] = next;
      }
    }
    return new Int32Array(0);
  }
}

const fields = new WeakMap<NavigationGraph, NavigationField>();

/** The field for these walls and floors, made once and shared by everything that asks for the same. */
export function navigationFieldFor(graph: NavigationGraph | undefined, fixed: readonly CollisionBox[], radius: number,
  surfaces: readonly WalkSurface[]): NavigationField {
  if (!graph) return new NavigationField(graph, fixed, radius, surfaces);
  let field = fields.get(graph);
  if (!field?.matches(fixed, radius, surfaces)) { field = new NavigationField(graph, fixed, radius, surfaces); fields.set(graph, field); }
  return field;
}

/** A query over the given walls, all treated as fixed. A round can share this one across all its zombies. */
export function createNavigationQuery(
  graph: NavigationGraph | undefined,
  collisionBoxes: readonly CollisionBox[],
  radius = 0,
  surfaces: readonly WalkSurface[] = [],
): NavigationQuery {
  return navigationFieldFor(graph, collisionBoxes, radius, surfaces).query();
}

// A clear line through air is not a route between floors. Sample support along
// the segment so pursuit follows the actual ramps and cannot shortcut a stairwell.
export function hasWalkableConnection(a: Vec3, b: Vec3, surfaces: readonly WalkSurface[]): boolean {
  if (!surfaces.length) return true;
  const count = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.15));
  work.navigationFloorSamples += count;
  // Only floors the line passes over can matter.
  const lowX = Math.min(a.x, b.x) - 1e-6, highX = Math.max(a.x, b.x) + 1e-6;
  const lowZ = Math.min(a.z, b.z) - 1e-6, highZ = Math.max(a.z, b.z) + 1e-6;
  const under = surfaces.filter(surface => surface.maxX >= lowX && surface.minX <= highX && surface.maxZ >= lowZ && surface.minZ <= highZ);
  let height = a.y;
  for (let i = 1; i <= count; i++) {
    const t = i / count;
    const next = sampleWalkHeight(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, height, under, 0.2);
    if (Math.abs(next - height) > 0.21 || Math.abs(next - (a.y + (b.y - a.y) * t)) > 0.35) return false;
    height = next;
  }
  return Math.abs(height - b.y) < 0.2;
}
