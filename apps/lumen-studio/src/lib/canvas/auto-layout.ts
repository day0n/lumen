import type { NodeKind } from './types';

type AutoLayoutNode = {
  id: string;
  position: {
    x: number;
    y: number;
  };
  measured?: {
    width?: number;
    height?: number;
  };
  width?: number;
  height?: number;
  data: {
    kind: NodeKind;
  };
};

type AutoLayoutEdge = {
  source: string;
  target: string;
};

function getAutoLayoutNodeSize(node: AutoLayoutNode) {
  const measured = node.measured;
  if (measured?.width !== undefined && measured.height !== undefined) {
    return { width: measured.width, height: measured.height };
  }

  if (node.width !== undefined && node.height !== undefined) {
    return { width: node.width, height: node.height };
  }

  switch (node.data.kind) {
    case 'video':
      return { width: 420, height: 430 };
    case 'text':
      return { width: 390, height: 395 };
    case 'image':
      return { width: 380, height: 405 };
    case 'audio':
      return { width: 360, height: 385 };
    case 'composition':
      return { width: 300, height: 280 };
  }
}

function snapToGrid(value: number, gridSize = 24) {
  return Math.round(value / gridSize) * gridSize;
}

function getAutoLayoutBounds(nodes: AutoLayoutNode[]) {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;

  for (const node of nodes) {
    minX = Math.min(minX, node.position.x);
    minY = Math.min(minY, node.position.y);
  }

  return {
    x: Number.isFinite(minX) ? minX : 0,
    y: Number.isFinite(minY) ? minY : 0,
  };
}

export function arrangeCanvasNodes<TNode extends AutoLayoutNode>(
  nodes: TNode[],
  edges: AutoLayoutEdge[],
) {
  if (nodes.length <= 1) return nodes;

  const nodeIds = new Set(nodes.map((node) => node.id));
  const validEdges = edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target));
  const indegree = new Map<string, number>();
  const outgoing = new Map<string, string[]>();
  const rank = new Map<string, number>();

  for (const node of nodes) {
    indegree.set(node.id, 0);
    outgoing.set(node.id, []);
    rank.set(node.id, 0);
  }

  for (const edge of validEdges) {
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
    outgoing.get(edge.source)?.push(edge.target);
  }

  const positionOrder = [...nodes].sort((a, b) => {
    if (a.position.x !== b.position.x) return a.position.x - b.position.x;
    return a.position.y - b.position.y;
  });
  const queue = positionOrder.filter((node) => (indegree.get(node.id) ?? 0) === 0);
  const visited = new Set<string>();

  while (queue.length > 0) {
    const node = queue.shift();
    if (!node || visited.has(node.id)) continue;
    visited.add(node.id);

    for (const targetId of outgoing.get(node.id) ?? []) {
      rank.set(targetId, Math.max(rank.get(targetId) ?? 0, (rank.get(node.id) ?? 0) + 1));
      indegree.set(targetId, (indegree.get(targetId) ?? 0) - 1);
      if ((indegree.get(targetId) ?? 0) === 0) {
        const targetNode = nodes.find((item) => item.id === targetId);
        if (targetNode) queue.push(targetNode);
      }
    }

    queue.sort((a, b) => {
      if (a.position.x !== b.position.x) return a.position.x - b.position.x;
      return a.position.y - b.position.y;
    });
  }

  const unresolvedNodes = positionOrder.filter((node) => !visited.has(node.id));
  const fallbackRank = Math.max(0, ...Array.from(rank.values())) + (visited.size > 0 ? 1 : 0);
  unresolvedNodes.forEach((node, index) => {
    rank.set(node.id, fallbackRank + index);
  });

  const layers = new Map<number, TNode[]>();
  for (const node of nodes) {
    const nodeRank = rank.get(node.id) ?? 0;
    const layer = layers.get(nodeRank) ?? [];
    layer.push(node);
    layers.set(nodeRank, layer);
  }

  const sortedLayers = Array.from(layers.entries())
    .sort(([a], [b]) => a - b)
    .map(([, layer]) => layer.sort((a, b) => a.position.y - b.position.y));

  const bounds = getAutoLayoutBounds(nodes);
  const startX = snapToGrid(bounds.x);
  const startY = snapToGrid(bounds.y);
  const columnGap = 190;
  const rowGap = 84;
  const layerHeights = sortedLayers.map((layer) =>
    layer.reduce(
      (total, node, index) => total + getAutoLayoutNodeSize(node).height + (index > 0 ? rowGap : 0),
      0,
    ),
  );
  const maxLayerHeight = Math.max(...layerHeights, 0);
  const positions = new Map<string, { x: number; y: number }>();
  let x = startX;

  sortedLayers.forEach((layer, layerIndex) => {
    const layerWidth = Math.max(...layer.map((node) => getAutoLayoutNodeSize(node).width), 0);
    let y = startY + Math.max(0, (maxLayerHeight - (layerHeights[layerIndex] ?? 0)) / 2);

    for (const node of layer) {
      positions.set(node.id, {
        x: snapToGrid(x),
        y: snapToGrid(y),
      });
      y += getAutoLayoutNodeSize(node).height + rowGap;
    }

    x += layerWidth + columnGap;
  });

  return nodes.map((node) => ({
    ...node,
    position: positions.get(node.id) ?? node.position,
  }));
}
