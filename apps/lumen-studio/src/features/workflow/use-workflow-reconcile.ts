'use client';

import { useCallback, useEffect, useRef } from 'react';

import type { NodeStatus, PublicErrorFields } from '@lumen/shared/domain';

import {
  type WorkflowNodeResultPayload,
  mapWorkflowResultToNodeState,
  shouldApplyWorkflowReconcile,
  shouldReconcileWorkflowNode,
} from './reconcile-workflow-nodes';

interface CanvasNodeSnapshot {
  id: string;
  status?: NodeStatus;
  output?: string | null;
}

interface UseWorkflowReconcileOptions {
  projectId: string | null;
  nodes: CanvasNodeSnapshot[];
  enabled?: boolean;
  onNodeStateChange: (
    nodeId: string,
    state: {
      status: NodeStatus;
      output: string | null;
      error: string | null;
      activeRunId?: string | null;
      progress: number;
    } & PublicErrorFields,
  ) => void;
}

export function useWorkflowReconcile({
  projectId,
  nodes,
  enabled = true,
  onNodeStateChange,
}: UseWorkflowReconcileOptions) {
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;

  const reconcile = useCallback(async () => {
    if (!projectId || !enabled) return;

    const targets = nodesRef.current.filter((node) =>
      shouldReconcileWorkflowNode(node.id, node.status, node.output ?? null),
    );
    if (targets.length === 0) return;

    const nodeIds = targets.map((node) => node.id).join(',');
    const response = await fetch(
      `/api/projects/${projectId}/workflow-status?nodeIds=${encodeURIComponent(nodeIds)}`,
    );
    if (!response.ok) return;

    const payload = (await response.json()) as { results?: WorkflowNodeResultPayload[] };
    const results = payload.results ?? [];
    const nodeMap = new Map(nodesRef.current.map((node) => [node.id, node]));

    for (const result of results) {
      const incoming = mapWorkflowResultToNodeState(result);
      if (!incoming) continue;

      const currentNode = nodeMap.get(result.nodeId);
      const current = {
        status: currentNode?.status ?? 'idle',
        output: currentNode?.output ?? null,
        error: null,
        progress: currentNode?.status === 'running' ? 0.45 : 0,
      };

      if (!shouldApplyWorkflowReconcile(current, incoming)) continue;
      onNodeStateChange(result.nodeId, incoming);
    }
  }, [enabled, onNodeStateChange, projectId]);

  useEffect(() => {
    if (!projectId || !enabled) return;
    void reconcile();
  }, [enabled, projectId, reconcile]);

  useEffect(() => {
    if (!projectId || !enabled) return;

    const hasBusyNodes = nodes.some((node) =>
      shouldReconcileWorkflowNode(node.id, node.status, node.output ?? null),
    );
    if (!hasBusyNodes) return;

    const timer = window.setInterval(() => {
      void reconcile();
    }, 6000);

    return () => window.clearInterval(timer);
  }, [enabled, nodes, projectId, reconcile]);

  return { reconcile };
}
