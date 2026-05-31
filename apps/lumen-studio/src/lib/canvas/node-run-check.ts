import { generateAncestorFlow } from './flow-graph';
import type { CanvasEdgeShape, CanvasNodeShape, NodeStatus } from './types';

const RUNNABLE_STATUSES: NodeStatus[] = ['idle', 'error', 'success'];

function isRunnableStatus(status: NodeStatus) {
  return RUNNABLE_STATUSES.includes(status);
}

function getSettingString(settings: Record<string, unknown>, key: string) {
  const value = settings[key];
  return typeof value === 'string' ? value.trim() : '';
}

function hasSettingStringArray(settings: Record<string, unknown>, key: string) {
  const value = settings[key];
  return Array.isArray(value) && value.some((item) => typeof item === 'string' && item.trim());
}

function hasSettingClips(settings: Record<string, unknown>) {
  const value = settings.inputClips ?? settings.clips;
  return (
    Array.isArray(value) &&
    value.some((item) => {
      if (!item || typeof item !== 'object') return false;
      const url = (item as Record<string, unknown>).url;
      return typeof url === 'string' && url.trim().length > 0;
    })
  );
}

function hasOwnInput(node: CanvasNodeShape): boolean {
  if (node.data.prompt.trim().length > 0) return true;
  if (getSettingString(node.data.settings, 'inputImage')) return true;
  if (getSettingString(node.data.settings, 'inputLastFrameImage')) return true;
  if (getSettingString(node.data.settings, 'inputVideo')) return true;
  if (hasSettingStringArray(node.data.settings, 'inputVideos')) return true;
  if (hasSettingClips(node.data.settings)) return true;
  return false;
}

function hasProducedOutput(node: CanvasNodeShape): boolean {
  return Boolean(node.data.output && node.data.output.trim().length > 0);
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

  const incomingEdges = edges.filter((edge) => edge.target === id);

  if (incomingEdges.length === 0) {
    return hasOwnInput(node);
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
      if (!hasOwnInput(entry)) return false;
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
