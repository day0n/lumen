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
  input: {
    prompt: string;
    image: string | null;
    lastFrameImage: string | null;
    video: string | null;
  };
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
  workflowId?: string | null;
  userId?: string | null;
  onNodeStateChange?: (nodeId: string, state: NodeState) => void;
  onFlowDone?: () => void;
}

export function useWorkflowWs({
  url,
  projectId,
  workflowId,
  userId,
  onNodeStateChange,
  onFlowDone,
}: UseWorkflowWsOptions) {
  const socketsRef = useRef<Set<WebSocket>>(new Set());
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [nodeStates, setNodeStates] = useState<Record<string, NodeState>>({});

  useEffect(() => {
    return () => {
      for (const ws of socketsRef.current) {
        ws.close();
      }
      socketsRef.current.clear();
    };
  }, []);

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
    [onFlowDone, updateNode],
  );

  const markRunConnectionFailed = useCallback(
    (nodeIds: string[], error: string) => {
      setNodeStates((prev) => {
        const nextStates = { ...prev };
        for (const nodeId of nodeIds) {
          const current = nextStates[nodeId] ?? {
            status: 'idle',
            output: null,
            error: null,
            progress: 0,
          };
          if (current.status === 'success') continue;
          const next: NodeState = {
            ...current,
            status: 'error',
            error,
          };
          nextStates[nodeId] = next;
          onNodeStateChange?.(nodeId, next);
        }
        return nextStates;
      });
    },
    [onNodeStateChange],
  );

  const runNodes = useCallback(
    (nodeIds: string[] | undefined, nodes: WorkflowNode[], edges: WorkflowEdge[]) => {
      const targetNodeIds = nodeIds && nodeIds.length > 0 ? nodeIds : nodes.map((node) => node.id);
      if (!url) {
        const error = '工作流引擎地址不可用';
        setConnectionError(error);
        markRunConnectionFailed(targetNodeIds, error);
        return;
      }

      const message = {
        runId: nanoid(16),
        projectId: projectId ?? undefined,
        workflowId: workflowId ?? projectId ?? undefined,
        userId: userId ?? undefined,
        nodeIds,
        nodes,
        edges,
      };

      const ws = new WebSocket(url);
      socketsRef.current.add(ws);
      let opened = false;
      let flowDone = false;

      const closeSocket = () => {
        socketsRef.current.delete(ws);
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close();
        }
      };

      ws.onopen = () => {
        opened = true;
        setConnectionError(null);
        ws.send(JSON.stringify(message));
      };

      ws.onmessage = (evt) => {
        try {
          const event = JSON.parse(evt.data) as ServerEvent;
          handleEvent(event);
          if (event.event === 'flow:done') {
            flowDone = true;
            closeSocket();
          }
        } catch {
          // ignore malformed messages
        }
      };

      ws.onerror = () => {
        const error = opened ? '工作流连接异常' : '工作流引擎连接失败';
        setConnectionError(error);
      };

      ws.onclose = () => {
        socketsRef.current.delete(ws);
        if (flowDone) return;
        const error = opened ? '工作流连接已断开' : '工作流引擎连接失败';
        setConnectionError(error);
        markRunConnectionFailed(targetNodeIds, error);
      };
    },
    [handleEvent, markRunConnectionFailed, projectId, url, userId, workflowId],
  );

  return { connectionError, nodeStates, runNodes };
}
