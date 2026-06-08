import {
  buildCompositionVideoUrlLookup,
  parseCompositionTimeline,
  tryCompileCompositionClips,
  type LumenCanvas,
} from '@lumen/shared/domain';

import { generateAncestorFlow } from './flow-graph';
import type { CanvasEdgeShape, CanvasNodeShape, NodeStatus } from './types';

const RUNNABLE_STATUSES: NodeStatus[] = ['idle', 'error', 'success', 'cancelled'];

function isRunnableStatus(status: NodeStatus) {
  return RUNNABLE_STATUSES.includes(status);
}

function hasRequiredPrompt(node: CanvasNodeShape): boolean {
  if (node.data.kind === 'composition') return true;
  return node.data.prompt.trim().length > 0;
}

function hasProducedOutput(node: CanvasNodeShape): boolean {
  const output = node.data.output?.trim();
  return Boolean(output && !output.startsWith('blob:'));
}

function canIgnoreMissingSourceOutput(target: CanvasNodeShape, source: CanvasNodeShape): boolean {
  return target.data.kind === 'video' && source.data.kind === 'image';
}

function canRunCompositionNode(
  node: CanvasNodeShape,
  nodes: CanvasNodeShape[],
  edges: CanvasEdgeShape[],
): boolean {
  const timeline = parseCompositionTimeline(node.data.settings ?? {});
  if (!timeline || timeline.clips.length === 0) return false;

  const lookup = buildCompositionVideoUrlLookup(
    { nodes, edges } as unknown as LumenCanvas,
    node.id,
  );
  const incoming = edges.filter((edge) => edge.target === node.id);
  const byId = new Map(nodes.map((item) => [item.id, item]));

  for (const edge of incoming) {
    const source = byId.get(edge.source);
    if (!source) return false;
    const output = source.data.output?.trim();
    if (source.data.kind === 'video') {
      if (!output || output.startsWith('blob:')) return false;
      lookup.set(source.id, output);
      continue;
    }
    if (source.data.kind === 'audio') {
      if (!output || output.startsWith('blob:')) return false;
    }
  }

  const compiled = tryCompileCompositionClips(timeline, lookup);
  return compiled.ok;
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

  if (node.data.kind === 'composition') {
    return canRunCompositionNode(node, nodes, edges);
  }

  const incomingEdges = edges.filter((edge) => edge.target === id);

  if (incomingEdges.length === 0) {
    return true;
  }

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  for (const edge of incomingEdges) {
    const source = nodeMap.get(edge.source);
    if (!source) return false;
    if (!hasProducedOutput(source) && !canIgnoreMissingSourceOutput(node, source)) return false;
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
    if (node.data.kind === 'composition' && !canRunCompositionNode(node, nodes, edges)) {
      return false;
    }
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
      if (!hasProducedOutput(source) && !canIgnoreMissingSourceOutput(entry, source)) return false;
    }
  }

  return true;
}

export { generateAncestorFlow };
