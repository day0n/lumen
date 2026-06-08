'use client';

import { translate } from '@/i18n/messages';
import type { Locale } from '@/i18n/routing';
import { useAuth } from '@clerk/nextjs';
import type { NodeStatus, PublicErrorFields } from '@lumen/shared/domain';
import type { ClientRunMessage, ServerEvent } from '@lumen/shared/protocols';
import * as Sentry from '@sentry/nextjs';
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
    images: string[];
    video: string | null;
    videos: string[];
    audio: string | null;
    audios: string[];
    clips: Array<{
      url: string;
      start?: number;
      duration?: number;
      volume?: number;
      title?: string;
    }>;
  };
  model: { id: string; settings: Record<string, unknown> };
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
}

export interface NodeState extends PublicErrorFields {
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
  locale?: Locale;
  onNodeStateChange?: (nodeId: string, state: NodeState) => void;
  onFlowDone?: () => void;
}

interface ActiveRun {
  runId: string;
  ws: WebSocket;
  nodeIds: string[];
  flowSpan: Sentry.Span | undefined;
  opened: boolean;
  flowDone: boolean;
  cancelled: boolean;
}

export function useWorkflowWs({
  url,
  projectId,
  workflowId,
  userId,
  locale = 'en',
  onNodeStateChange,
  onFlowDone,
}: UseWorkflowWsOptions) {
  const socketsRef = useRef<Set<WebSocket>>(new Set());
  const activeRunsRef = useRef<Map<string, ActiveRun>>(new Map());
  const nodeRunIndexRef = useRef<Map<string, Set<string>>>(new Map());
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [nodeStates, setNodeStates] = useState<Record<string, NodeState>>({});
  const { getToken } = useAuth();

  const removeRun = useCallback((run: ActiveRun) => {
    activeRunsRef.current.delete(run.runId);
    socketsRef.current.delete(run.ws);
    for (const nodeId of run.nodeIds) {
      const runIds = nodeRunIndexRef.current.get(nodeId);
      if (!runIds) continue;
      runIds.delete(run.runId);
      if (runIds.size === 0) nodeRunIndexRef.current.delete(nodeId);
    }
  }, []);

  useEffect(() => {
    return () => {
      for (const run of activeRunsRef.current.values()) {
        run.cancelled = true;
        run.flowSpan?.setStatus({ code: 1 });
        run.flowSpan?.end();
      }
      for (const ws of socketsRef.current) {
        ws.close();
      }
      activeRunsRef.current.clear();
      nodeRunIndexRef.current.clear();
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
          updateNode(event.nodeId, (prev) => ({
            ...prev,
            status: 'error',
            error: event.error,
            errorCode: event.errorCode,
            errorName: event.errorName,
            errorI18nKey: event.errorI18nKey,
            retryable: event.retryable,
            attempts: event.attempts,
          }));
          break;
        case 'node:cancel':
          updateNode(event.nodeId, (prev) => {
            if (prev.status === 'success') return prev;
            return {
              ...prev,
              status: 'cancelled',
              error: event.reason ?? translate(locale, 'canvas.node.cancelled'),
            };
          });
          break;
        case 'flow:done':
          onFlowDone?.();
          break;
        case 'flow:cancel':
          break;
      }
    },
    [locale, onFlowDone, updateNode],
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
          if (current.status === 'success' || current.status === 'cancelled') continue;
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

  const markRunCancelled = useCallback(
    (run: ActiveRun, reason: string) => {
      run.cancelled = true;
      setNodeStates((prev) => {
        const nextStates = { ...prev };
        for (const nodeId of run.nodeIds) {
          const current = nextStates[nodeId] ?? {
            status: 'idle',
            output: null,
            error: null,
            progress: 0,
          };
          if (current.status === 'success') continue;
          const next: NodeState = {
            ...current,
            status: 'cancelled',
            error: reason,
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

      // 立即把目标节点标记为排队中，不等 websocket 握手 —— 点击运行就有反馈。
      setNodeStates((prev) => {
        const nextStates = { ...prev };
        for (const nodeId of targetNodeIds) {
          const next: NodeState = { status: 'queued', output: null, error: null, progress: 0 };
          nextStates[nodeId] = next;
          onNodeStateChange?.(nodeId, next);
        }
        return nextStates;
      });

      if (!url) {
        const error = translate(locale, 'canvas.engineMissing');
        setConnectionError(error);
        markRunConnectionFailed(targetNodeIds, error);
        return;
      }

      const runId = nanoid(16);
      // 客户端 ws.flow.run span：量用户视角的整条工作流耗时，onclose 时收尾。
      // 在它的 scope 内取 trace 注入消息，让 engine 的 workflow.execute 挂到它下面。
      const flowSpan = Sentry.startInactiveSpan({
        name: 'ws.flow.run',
        op: 'websocket.client',
        attributes: {
          run_id: runId,
          project_id: projectId ?? undefined,
          node_count: targetNodeIds.length,
        },
      });
      const td = Sentry.withActiveSpan(flowSpan, () => Sentry.getTraceData());

      const message: ClientRunMessage = {
        action: 'run',
        runId,
        projectId: projectId ?? undefined,
        workflowId: workflowId ?? projectId ?? undefined,
        userId: userId ?? undefined,
        nodeIds: nodeIds && nodeIds.length > 0 ? nodeIds : undefined,
        nodes,
        edges,
        trace: td['sentry-trace']
          ? { sentryTrace: td['sentry-trace'], baggage: td.baggage }
          : undefined,
      };

      void getToken()
        .then((token) => {
          if (!token) {
            throw new Error('missing auth token');
          }

          const ws = new WebSocket(toWebSocketUrl(url), buildAuthProtocols(token));
          socketsRef.current.add(ws);
          const run: ActiveRun = {
            runId,
            ws,
            nodeIds: targetNodeIds,
            flowSpan,
            opened: false,
            flowDone: false,
            cancelled: false,
          };
          activeRunsRef.current.set(runId, run);
          for (const nodeId of targetNodeIds) {
            const runIds = nodeRunIndexRef.current.get(nodeId) ?? new Set<string>();
            runIds.add(runId);
            nodeRunIndexRef.current.set(nodeId, runIds);
          }

          const closeSocket = () => {
            removeRun(run);
            if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
              ws.close();
            }
          };

          ws.onopen = () => {
            run.opened = true;
            setConnectionError(null);
            ws.send(JSON.stringify(message));
          };

          ws.onmessage = (evt) => {
            try {
              const event = JSON.parse(evt.data) as ServerEvent;
              handleEvent(event);
              if (event.event === 'flow:done') {
                run.flowDone = true;
                closeSocket();
              } else if (event.event === 'flow:cancel') {
                run.cancelled = true;
                closeSocket();
              }
            } catch {
              // ignore malformed messages
            }
          };

          ws.onerror = () => {
            const error = run.opened
              ? translate(locale, 'canvas.connectionError')
              : translate(locale, 'canvas.engineConnectionFailed');
            if (!run.cancelled) setConnectionError(error);
          };

          ws.onclose = () => {
            removeRun(run);
            // 收尾 ws.flow.run span：flowDone/cancelled=正常收尾，否则标记异常。
            run.flowSpan?.setStatus({ code: run.flowDone || run.cancelled ? 1 : 2 });
            run.flowSpan?.end();
            if (run.flowDone || run.cancelled) return;
            // 断线时不要把节点直接标成 error：engine 可能仍在跑，交给 workflow-status 轮询恢复。
            const error = run.opened
              ? translate(locale, 'canvas.connectionClosed')
              : translate(locale, 'canvas.engineConnectionFailed');
            setConnectionError(error);
          };
        })
        .catch((err) => {
          Sentry.captureException(err);
          const error = translate(locale, 'canvas.engineConnectionFailed');
          setConnectionError(error);
          markRunConnectionFailed(targetNodeIds, error);
          flowSpan?.setStatus({ code: 2 });
          flowSpan?.end();
        });
    },
    [
      getToken,
      handleEvent,
      locale,
      markRunConnectionFailed,
      onNodeStateChange,
      projectId,
      removeRun,
      url,
      userId,
      workflowId,
    ],
  );

  const cancelNodes = useCallback(
    (nodeIds: string[], reason = translate(locale, 'canvas.node.cancelled')) => {
      const runIds = new Set<string>();
      for (const nodeId of nodeIds) {
        for (const runId of nodeRunIndexRef.current.get(nodeId) ?? []) runIds.add(runId);
      }

      for (const runId of runIds) {
        const run = activeRunsRef.current.get(runId);
        if (!run || run.cancelled || run.flowDone) continue;
        markRunCancelled(run, reason);
        if (run.ws.readyState === WebSocket.OPEN) {
          run.ws.send(
            JSON.stringify({
              action: 'cancel',
              runId,
              nodeIds: run.nodeIds,
              reason,
            }),
          );
        } else if (run.ws.readyState === WebSocket.CONNECTING) {
          run.ws.close();
        }
      }
    },
    [locale, markRunCancelled],
  );

  return { cancelNodes, connectionError, nodeStates, runNodes };
}

function toWebSocketUrl(url: string): string {
  const parsed = new URL(url, window.location.href);
  if (parsed.protocol === 'http:') parsed.protocol = 'ws:';
  if (parsed.protocol === 'https:') parsed.protocol = 'wss:';
  return parsed.toString();
}

function buildAuthProtocols(token: string): string[] {
  return ['lumen-flow-v1', `clerk.${token}`];
}
