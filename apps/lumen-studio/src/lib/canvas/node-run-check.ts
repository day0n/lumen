import { generateAncestorFlow } from './flow-graph';
import type { CanvasEdgeShape, CanvasNodeShape, NodeStatus } from './types';

const RUNNABLE_STATUSES: NodeStatus[] = ['idle', 'error', 'success', 'cancelled'];

function isRunnableStatus(status: NodeStatus) {
  return RUNNABLE_STATUSES.includes(status);
}

function hasRequiredPrompt(node: CanvasNodeShape): boolean {
  return node.data.prompt.trim().length > 0;
}

function hasProducedOutput(node: CanvasNodeShape): boolean {
  const output = node.data.output?.trim();
  return Boolean(output && !output.startsWith('blob:'));
}

export interface CanRunSingleNodeArgs<
  TNode extends CanvasNodeShape,
  TEdge extends CanvasEdgeShape,
> {
  id: string;
  nodes: TNode[];
  edges: TEdge[];
}

export function canRunSingleNode<TNode extends CanvasNodeShape, TEdge extends CanvasEdgeShape>({
  id,
  nodes,
  edges,
}: CanRunSingleNodeArgs<TNode, TEdge>): boolean {
  const node = nodes.find((n) => n.id === id);
  if (!node) return false;
  if (!isRunnableStatus(node.data.status)) return false;
  if (!hasRequiredPrompt(node)) return false;

  const incomingEdges = edges.filter((edge) => edge.target === id);

  if (incomingEdges.length === 0) {
    return true;
  }

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  for (const edge of incomingEdges) {
    const source = nodeMap.get(edge.source);
    if (!source) return false;
    if (!hasProducedOutput(source)) return false;
  }
  return true;
}

export interface CanRunSelectedNodesArgs<
  TNode extends CanvasNodeShape,
  TEdge extends CanvasEdgeShape,
> {
  selectedIds: string[];
  nodes: TNode[];
  edges: TEdge[];
}

export function canRunSelectedNodes<TNode extends CanvasNodeShape, TEdge extends CanvasEdgeShape>({
  selectedIds,
  nodes,
  edges,
}: CanRunSelectedNodesArgs<TNode, TEdge>): boolean {
  if (selectedIds.length === 0) return false;

  const selectedSet = new Set(selectedIds);
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const selectedNodes = selectedIds.map((sid) => nodeMap.get(sid)).filter(Boolean) as TNode[];
  if (selectedNodes.length === 0) return false;

  for (const node of selectedNodes) {
    if (!isRunnableStatus(node.data.status)) return false;
    if (!hasRequiredPrompt(node)) return false;
  }

  const entryIds: string[] = [];
  for (const node of selectedNodes) {
    const hasIncomingFromSelected = edges.some(
      (edge) => edge.target === node.id && selectedSet.has(edge.source),
    );
    if (!hasIncomingFromSelected) entryIds.push(node.id);
  }

  for (const entryId of entryIds) {
    const entry = nodeMap.get(entryId);
    if (!entry) return false;

    const externalIncoming = edges.filter(
      (edge) => edge.target === entryId && !selectedSet.has(edge.source),
    );

    if (externalIncoming.length === 0) {
      continue;
    }

    for (const edge of externalIncoming) {
      const source = nodeMap.get(edge.source);
      if (!source) return false;
      if (!hasProducedOutput(source)) return false;
    }
  }

  return true;
}

export { generateAncestorFlow };
