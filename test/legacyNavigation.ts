import { segmentHitsExpandedBox, type CollisionBox, type WalkSurface } from '../src/core/collision.ts';
import { hasWalkableConnection, shortestNavigationPath, type NavigationGraph, type NavigationNode, type NavigationQuery } from '../src/core/navigation.ts';
import type { Vec3 } from '../src/core/types.ts';

/**
 * The navigation query as it was written before it was made fast: every question scans the whole graph and every
 * wall. It is slow, but it is plainly correct, so the tests hold the fast one to giving the very same answers.
 */
export function referenceNavigationQuery(graph: NavigationGraph | undefined, boxes: readonly CollisionBox[], radius = 0,
  surfaces: readonly WalkSurface[] = []): NavigationQuery {
  const distanceSquared = (a: Vec3, b: Vec3) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2;
  const traversable = (a: Vec3, b: Vec3) => !boxes.some(box => segmentHitsExpandedBox(a, b, box, radius, 1.72))
    && hasWalkableConnection(a, b, surfaces);
  const byId = new Map<string, NavigationNode>((graph?.nodes ?? []).map(node => [node.id, node]));
  const openGraph: NavigationGraph | undefined = graph && { nodes: graph.nodes.map(node => ({ ...node,
    neighbors: node.neighbors.filter(id => { const next = byId.get(id); return next && traversable(node.position, next.position); }) })) };
  const nearestReachable = (position: Vec3) => {
    let best: NavigationNode | undefined, bestDistance = Infinity;
    for (const node of graph?.nodes ?? []) {
      const distance = distanceSquared(node.position, position);
      if ((distance < bestDistance || (distance === bestDistance && node.id.localeCompare(best!.id) < 0))
        && traversable(position, node.position)) { best = node; bestDistance = distance; }
    }
    return best;
  };
  return (start, goal) => {
    if (traversable(start, goal)) return goal;
    if (!graph || graph.nodes.length === 0) return goal;
    const startNode = nearestReachable(start), goalNode = nearestReachable(goal);
    if (!startNode || !goalNode) return start;
    const path = shortestNavigationPath(openGraph!, startNode.id, goalNode.id);
    if (path.length === 0) return start;
    for (let index = path.length - 1; index >= 0; index -= 1) if (traversable(start, path[index].position)) return path[index].position;
    return path[0].position;
  };
}
