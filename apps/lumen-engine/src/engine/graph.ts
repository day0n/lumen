import type { WorkflowEdge, WorkflowNode } from '@lumen/shared/domain';
import Graph from 'graphology';

export type WorkflowGraph = Graph<WorkflowNode, WorkflowEdge>;

export function buildGraph(nodes: WorkflowNode[], edges: WorkflowEdge[]): WorkflowGraph {
  const graph = new Graph<WorkflowNode, WorkflowEdge>({ type: 'directed' });

  for (const node of nodes) {
    graph.addNode(node.id, node);
  }

  for (const edge of edges) {
    if (
      graph.hasNode(edge.source) &&
      graph.hasNode(edge.target) &&
      !graph.hasDirectedEdge(edge.source, edge.target)
    ) {
      graph.addDirectedEdgeWithKey(edge.id, edge.source, edge.target, edge);
    }
  }

  return graph;
}

export function topologicalSort(graph: WorkflowGraph, nodeIds?: string[]): string[] {
  const targetIds = nodeIds && nodeIds.length > 0 ? new Set(nodeIds) : new Set(graph.nodes());

  const inDegree = new Map<string, number>();
  for (const id of targetIds) {
    inDegree.set(id, 0);
  }

  graph.forEachEdge((_edge, _attrs, source, target) => {
    if (targetIds.has(source) && targetIds.has(target)) {
      inDegree.set(target, (inDegree.get(target) ?? 0) + 1);
    }
  });

  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const sorted: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    sorted.push(current);

    for (const neighbor of graph.outNeighbors(current)) {
      if (!targetIds.has(neighbor)) continue;
      const newDeg = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, newDeg);
      if (newDeg === 0) queue.push(neighbor);
    }
  }

  return sorted;
}
