'use client';

import type { NodeStatus } from '@lumen/shared/domain';
import type { ServerEvent } from '@lumen/shared/protocols';
import { nanoid } from 'nanoid';
import { useCallback, useEffect, useRef, useState } from 'react';

export interface WorkflowNode {
  id: string;
  type: 'text' | 'image' | 'video' | 'audio';
  position: { x: number; y: number };
  output: string | null;
  input: { prompt: string; image: string | null; video: string | null };
  model: { id: string; settings: Record<string, unknown> };
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
}

export interface NodeState {
  status: NodeStatus;
  output: string | null;
  error: string | null;
  progress: number;
}

interface UseWorkflowWsOptions {
  url: string;
  projectId?: string | null;
  onNodeStateChange?: (nodeId: string, state: NodeState) => void;
  onFlowDone?: () => void;
}

export function useWorkflowWs({
  url,
  projectId,
  onNodeStateChange,
  onFlowDone,
}: UseWorkflowWsOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [nodeStates, setNodeStates] = useState<Record<string, NodeState>>({});

  useEffect(() => {
    if (!url) return;

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onerror = () => setConnected(false);

    ws.onmessage = (evt) => {
      try {
        const event = JSON.parse(evt.data) as ServerEvent;
        handleEvent(event);
      } catch {
        // ignore malformed messages
      }
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [url]);

  const handleEvent = useCallback(
    (event: ServerEvent) => {
      switch (event.event) {
        case 'node:queued':
          updateNode(event.nodeId, { status: 'queued', output: null, error: null, progress: 0 });
          break;
        case 'node:start':
          updateNode(event.nodeId, { status: 'running', output: null, error: null, progress: 0 });
          break;
        case 'node:progress':
          updateNode(event.nodeId, (prev) => ({ ...prev, progress: event.progress }));
          break;
        case 'node:done':
          updateNode(event.nodeId, {
            status: 'success',
            output: event.output,
            error: null,
            progress: 1,
          });
          break;
        case 'node:error':
          updateNode(event.nodeId, (prev) => ({ ...prev, status: 'error', error: event.error }));
          break;
        case 'flow:done':
          onFlowDone?.();
          break;
      }
    },
    [onFlowDone],
  );

  const updateNode = useCallback(
    (nodeId: string, update: NodeState | ((prev: NodeState) => NodeState)) => {
      setNodeStates((prev) => {
        const current = prev[nodeId] ?? { status: 'idle', output: null, error: null, progress: 0 };
        const next = typeof update === 'function' ? update(current) : update;
        onNodeStateChange?.(nodeId, next);
        return { ...prev, [nodeId]: next };
      });
    },
    [onNodeStateChange],
  );

  const runNodes = useCallback(
    (nodeIds: string[] | undefined, nodes: WorkflowNode[], edges: WorkflowEdge[]) => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

      const message = {
        runId: nanoid(16),
        projectId: projectId ?? undefined,
        nodeIds,
        nodes,
        edges,
      };
      wsRef.current.send(JSON.stringify(message));
    },
    [projectId],
  );

  return { connected, nodeStates, runNodes };
}
