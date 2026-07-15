import type { CanvasConnectionShape, CanvasEdgeShape } from './types';

export function checkCycle(
  edges: CanvasEdgeShape[],
  newConnection: CanvasConnectionShape,
): boolean {
  if (!newConnection.source || !newConnection.target) return false;
  if (newConnection.source === newConnection.target) return false;

  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    if (!adjacency.has(edge.source)) adjacency.set(edge.source, []);
    if (!adjacency.has(edge.target)) adjacency.set(edge.target, []);
    adjacency.get(edge.source)!.push(edge.target);
  }
  if (!adjacency.has(newConnection.source)) adjacency.set(newConnection.source, []);
  if (!adjacency.has(newConnection.target)) adjacency.set(newConnection.target, []);

  const visited = new Set<string>();
  const target = newConnection.target;
  const source = newConnection.source;

  const stack: string[] = [target];
  while (stack.length) {
    const current = stack.pop()!;
    if (current === source) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    const neighbors = adjacency.get(current) ?? [];
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) stack.push(neighbor);
    }
  }
  return false;
}
