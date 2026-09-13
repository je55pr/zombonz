import type { CollisionBox } from './collision.ts';
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
}function nodeMap(graph: NavigationGraph): Map<string, NavigationNode> {
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

function segmentHitsExpandedBox(
  start: Vec3,
  end: Vec3,
  box: CollisionBox,
  radius: number,
  height: number,
): boolean {
  const minX = box.min.x - radius;
  const maxX = box.max.x + radius;
  const minZ = box.min.z - radius;
  const maxZ = box.max.z + radius;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const dz = end.z - start.z;
  const minY = box.min.y - height;
  const maxY = box.max.y;
  let near = 0;
  let far = 1;
  for (const [origin, delta, min, max] of [
    [start.x, dx, minX, maxX],
    [start.y, dy, minY, maxY],
    [start.z, dz, minZ, maxZ],
  ] as const) {
    if (Math.abs(delta) < 1e-9) {
      if (origin < min || origin > max) return false;
      continue;
    }
    let t1 = (min - origin) / delta;
    let t2 = (max - origin) / delta;
    if (t1 > t2) [t1, t2] = [t2, t1];
    near = Math.max(near, t1);
    far = Math.min(far, t2);
    if (near > far) return false;
  }
  return far >= 0 && near <= 1;
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
): Vec3 {
  if (hasClearNavigationLine(start, goal, collisionBoxes, radius)) return goal;
  if (!graph || graph.nodes.length === 0) return goal;
  const startNode = nearestNavigationNode(graph, start);
  const goalNode = nearestNavigationNode(graph, goal);
  if (!startNode || !goalNode) return goal;
  const path = shortestNavigationPath(graph, startNode.id, goalNode.id);
  if (path.length === 0) return goal;
  for (let index = path.length - 1; index >= 0; index -= 1) {
    const node = path[index];
    if (hasClearNavigationLine(start, node.position, collisionBoxes, radius)) {
      return node.position;
    }
  }
  return path[0].position;
}
