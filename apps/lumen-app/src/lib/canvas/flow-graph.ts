import type { CanvasEdgeShape, CanvasNodeShape } from './types';

export interface AncestorFlow<TNode extends CanvasNodeShape, TEdge extends CanvasEdgeShape> {
  nodes: TNode[];
  edges: TEdge[];
}

export function generateAncestorFlow<TNode extends CanvasNodeShape, TEdge extends CanvasEdgeShape>(
  targetNodeId: string,
  nodes: TNode[],
  edges: TEdge[],
): AncestorFlow<TNode, TEdge> {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const allowedIds = new Set(nodes.map((node) => node.id));
  const filteredEdges = edges.filter((e) => allowedIds.has(e.source) && allowedIds.has(e.target));

  const reverseAdj = new Map<string, string[]>();
  for (const node of nodes) reverseAdj.set(node.id, []);
  for (const edge of filteredEdges) reverseAdj.get(edge.target)?.push(edge.source);

  const visited = new Set<string>();
  const stack = [targetNodeId];
  while (stack.length) {
    const current = stack.pop()!;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const parent of reverseAdj.get(current) ?? []) {
      if (!visited.has(parent)) stack.push(parent);
    }
  }

  const subgraphNodes = nodes.filter((node) => visited.has(node.id));
  const subgraphEdges = filteredEdges.filter((e) => visited.has(e.source) && visited.has(e.target));

  const adjList = new Map<string, string[]>();
  for (const node of subgraphNodes) adjList.set(node.id, []);
  for (const edge of subgraphEdges) adjList.get(edge.source)?.push(edge.target);

  const inDegree = new Map<string, number>();
  for (const node of subgraphNodes) inDegree.set(node.id, 0);
  for (const edge of subgraphEdges) {
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
  }

  const queue = [...inDegree.entries()].filter(([, deg]) => deg === 0).map(([id]) => id);
  const topoOrder: string[] = [];
  while (queue.length) {
    const current = queue.shift()!;
    topoOrder.push(current);
    for (const child of adjList.get(current) ?? []) {
      inDegree.set(child, (inDegree.get(child) ?? 1) - 1);
      if (inDegree.get(child) === 0) queue.push(child);
    }
  }

  return {
    nodes: topoOrder.map((id) => nodeById.get(id)!).filter(Boolean) as TNode[],
    edges: subgraphEdges,
  };
}
