'use client';

/**
 * Agent SSE 客户端 hook。
 *
 * UI 需要的不只是 assistant 文本，还包括 run 生命周期、thinking delta、
 * step / tool 事件和断线重连状态。这里把 SSE 事件收拢成每条 assistant
 * message 自带的 timeline，ChatPanel 只负责渲染。
 */

import { useAuth } from '@clerk/nextjs';
import { fetchEventSource } from '@microsoft/fetch-event-source';
import * as Sentry from '@sentry/nextjs';
import { nanoid } from 'nanoid';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const AGENT_URL = process.env.NEXT_PUBLIC_AGENT_URL ?? 'http://localhost:3001';

export type ChatRole = 'user' | 'assistant';

export type ChatTimelineKind =
  | 'connection'
  | 'run'
  | 'step'
  | 'thinking'
  | 'tool'
  | 'tool_event'
  | 'message'
  | 'error';

export type ChatTimelineStatus = 'queued' | 'running' | 'success' | 'error' | 'info';

export interface ChatTimelineItem {
  id: string;
  kind: ChatTimelineKind;
  status: ChatTimelineStatus;
  title: string;
  detail?: string;
  createdAt: number;
  durationMs?: number;
  toolName?: string;
  eventName?: string;
  payload?: Record<string, unknown>;
}

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: number;
  status: 'streaming' | 'done' | 'failed';
  error?: string;
  runId?: string;
  thinking?: string;
  events?: ChatTimelineItem[];
  usage?: Record<string, number>;
}

export type AgentChatStatus = 'idle' | 'creating' | 'streaming' | 'reconnecting' | 'error';

interface UseAgentChatOptions {
  sessionId?: string;
  profile?: string;
  context?: Record<string, unknown>;
  onWorkflowUpdate?: (data: Record<string, unknown>) => void | Promise<void>;
  onWorkflowNodeStatus?: (data: Record<string, unknown>) => void | Promise<void>;
}

interface SseEnvelope {
  event: string;
  data: Record<string, unknown>;
}

class TerminalSignal extends Error {
  constructor(readonly reason: 'completed' | 'failed' | 'stopped') {
    super(`agent stream terminal: ${reason}`);
    this.name = 'AgentTerminalSignal';
  }
}

class NonRetriableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NonRetriableError';
  }
}

const MAX_CREATE_ATTEMPTS = 3;
const CREATE_DELAYS_MS = [1000, 3000, 8000];

const MAX_RECONNECT_ATTEMPTS = 10;
const RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000, 15000, 30000];

const MAX_SEEN_IDS = 500;
const MAX_TIMELINE_ITEMS = 80;

const TERMINAL_EVENT_NAMES = new Set([
  'agent.completed',
  'agent.failed',
  'agent.stopped',
  'run.completed',
  'run.failed',
  'run.cancelled',
]);

interface WrappedCreateRunResponse {
  ok: true;
  data: { run_id: string; session_id: string };
}

interface DirectCreateRunResponse {
  run_id: string;
  session_id: string;
}

interface ApiError {
  ok?: false;
  error?: string | { message?: string };
  message?: string;
}

type CreateRunPayload = WrappedCreateRunResponse | DirectCreateRunResponse | ApiError;

interface HistoryResponse {
  session_id: string;
  workflow_id?: string | null;
  revision?: number;
  updated_at?: string;
  messages?: StoredHistoryMessage[];
}

export interface AgentSessionSummary {
  session_id: string;
  workflow_id?: string | null;
  summary?: string | null;
  message_count?: number;
  turn_count?: number;
  status?: string;
  revision?: number;
  last_message_preview?: string | null;
  created_at?: string;
  updated_at?: string;
}

interface SessionsResponse {
  sessions?: AgentSessionSummary[];
  has_more?: boolean;
}

interface StoredHistoryMessage {
  role?: string;
  content?: unknown;
  turn?: number;
  created_at?: string;
  tool_call_id?: string;
  tool_name?: string;
  tool_call?: Record<string, unknown>;
  event?: string;
  event_data?: Record<string, unknown>;
  status?: string;
  error?: string | null;
  duration_ms?: number;
  output_size_bytes?: number;
}

export function useAgentChat({
  sessionId,
  profile = 'main',
  context,
  onWorkflowUpdate,
  onWorkflowNodeStatus,
}: UseAgentChatOptions = {}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<AgentChatStatus>('idle');
  const [errorText, setErrorText] = useState<string | null>(null);
  const { getToken } = useAuth();

  const sid = useMemo(() => sessionId ?? `studio-${nanoid(12)}`, [sessionId]);
  const abortRef = useRef<AbortController | null>(null);
  const activeRunIdRef = useRef<string | null>(null);
  const activeAssistantIdRef = useRef<string | null>(null);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  useEffect(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    activeRunIdRef.current = null;
    activeAssistantIdRef.current = null;
    setMessages([]);
    setStatus('idle');
    setErrorText(null);

    if (!sessionId) return;

    const controller = new AbortController();
    void getToken()
      .catch(() => null)
      .then((token) =>
        fetchSessionHistory({
          sessionId,
          signal: controller.signal,
          token,
        }),
      )
      .then((historyMessages) => {
        if (controller.signal.aborted || historyMessages.length === 0) return;
        setMessages((prev) => (prev.length === 0 ? historyMessages : prev));
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        console.error('failed to load agent session history', err);
      });

    return () => controller.abort();
  }, [getToken, sessionId]);

  const updateMessage = useCallback(
    (id: string, patch: Partial<ChatMessage> | ((prev: ChatMessage) => Partial<ChatMessage>)) => {
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== id) return m;
          const delta = typeof patch === 'function' ? patch(m) : patch;
          return { ...m, ...delta };
        }),
      );
    },
    [],
  );

  const stop = useCallback(() => {
    const runId = activeRunIdRef.current;
    const assistantId = activeAssistantIdRef.current;

    abortRef.current?.abort();
    abortRef.current = null;
    activeRunIdRef.current = null;
    activeAssistantIdRef.current = null;
    setStatus('idle');

    if (assistantId) {
      updateMessage(assistantId, (prev) => ({
        status: 'done',
        events: upsertTimeline(prev.events, {
          id: 'run.cancelled.client',
          kind: 'run',
          status: 'info',
          title: '已停止当前任务',
          detail: runId ? `run ${runId.slice(0, 8)}` : undefined,
          createdAt: Date.now(),
        }),
      }));
    }

    if (runId) {
      void getToken()
        .catch(() => null)
        .then((token) => {
          const headers: Record<string, string> = {};
          if (token) headers.authorization = `Bearer ${token}`;
          return fetch(`${AGENT_URL}/v1/agent/runs/${encodeURIComponent(runId)}/cancel`, {
            method: 'POST',
            headers,
          });
        })
        .catch(() => {
          /* noop */
        });
    }
  }, [getToken, updateMessage]);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      abortRef.current?.abort();

      const now = Date.now();
      const userMessage: ChatMessage = {
        id: nanoid(),
        role: 'user',
        content: trimmed,
        createdAt: now,
        status: 'done',
      };
      const assistantMessage: ChatMessage = {
        id: nanoid(),
        role: 'assistant',
        content: '',
        createdAt: now,
        status: 'streaming',
        thinking: '',
        events: [
          {
            id: 'run.create',
            kind: 'run',
            status: 'queued',
            title: '正在提交任务',
            detail: profile,
            createdAt: now,
          },
        ],
      };

      setMessages((prev) => [...prev, userMessage, assistantMessage]);
      setStatus('creating');
      setErrorText(null);
      activeAssistantIdRef.current = assistantMessage.id;

      const controller = new AbortController();
      abortRef.current = controller;

      const token = await getToken().catch(() => null);

      // step 1: create run
      let runId: string;
      try {
        runId = await createRun({
          sessionId: sid,
          profile,
          message: trimmed,
          context,
          signal: controller.signal,
          token,
        });
      } catch (err) {
        if (controller.signal.aborted) {
          updateMessage(assistantMessage.id, { status: 'done' });
          setStatus('idle');
          return;
        }
        const message = err instanceof Error ? err.message : String(err);
        updateMessage(assistantMessage.id, (prev) => ({
          status: 'failed',
          error: message,
          events: upsertTimeline(prev.events, {
            id: 'run.create.failed',
            kind: 'error',
            status: 'error',
            title: '任务提交失败',
            detail: message,
            createdAt: Date.now(),
          }),
        }));
        setStatus('error');
        setErrorText(message);
        return;
      }

      activeRunIdRef.current = runId;
      updateMessage(assistantMessage.id, (prev) => ({
        runId,
        events: upsertTimeline(prev.events, {
          id: 'run.create',
          kind: 'run',
          status: 'success',
          title: '任务已进入队列',
          detail: `run ${runId.slice(0, 8)}`,
          createdAt: Date.now(),
        }),
      }));

      // step 2: subscribe events
      const seenEventIds = new Set<string>();
      const recentEventIds: string[] = [];
      const shouldSkip = (id: string) => {
        if (!id) return false;
        if (seenEventIds.has(id)) return true;
        seenEventIds.add(id);
        recentEventIds.push(id);
        if (recentEventIds.length > MAX_SEEN_IDS) {
          const dropped = recentEventIds.shift();
          if (dropped) seenEventIds.delete(dropped);
        }
        return false;
      };

      let reconnectAttempt = 0;
      let terminalReason: 'completed' | 'failed' | 'stopped' | null = null;

      const eventsHeaders: Record<string, string> = { accept: 'text/event-stream' };
      if (token) eventsHeaders.authorization = `Bearer ${token}`;
      const eventsTrace = Sentry.getTraceData();
      if (eventsTrace['sentry-trace']) {
        eventsHeaders['sentry-trace'] = eventsTrace['sentry-trace'];
        if (eventsTrace.baggage) eventsHeaders.baggage = eventsTrace.baggage;
      }

      try {
        await fetchEventSource(`${AGENT_URL}/v1/agent/runs/${encodeURIComponent(runId)}/events`, {
          method: 'GET',
          headers: eventsHeaders,
          signal: controller.signal,
          openWhenHidden: true,

          onopen: async (response) => {
            if (!response.ok) {
              const body = await response.text().catch(() => '');
              throw new NonRetriableError(body || `HTTP ${response.status}`);
            }
            const ct = response.headers.get('content-type') ?? '';
            if (!ct.toLowerCase().includes('text/event-stream')) {
              throw new NonRetriableError(`unexpected content-type: ${ct}`);
            }
            reconnectAttempt = 0;
            setStatus('streaming');
            updateMessage(assistantMessage.id, (prev) => ({
              events: upsertTimeline(prev.events, {
                id: 'events.connected',
                kind: 'connection',
                status: 'success',
                title: '事件流已连接',
                createdAt: Date.now(),
              }),
            }));
          },

          onmessage: (msg) => {
            if (msg.id && shouldSkip(msg.id)) return;
            if (!msg.event) return;

            let data: Record<string, unknown> = {};
            if (msg.data) {
              try {
                data = JSON.parse(msg.data) as Record<string, unknown>;
              } catch {
                data = { raw: msg.data };
              }
            }

            const env: SseEnvelope = { event: msg.event, data };
            handleEvent(env, assistantMessage.id, updateMessage, {
              onWorkflowUpdate,
              onWorkflowNodeStatus,
            });

            if (env.event === 'agent.completed' || env.event === 'run.completed') {
              terminalReason = 'completed';
              throw new TerminalSignal('completed');
            }
            if (env.event === 'agent.failed' || env.event === 'run.failed') {
              terminalReason = 'failed';
              throw new TerminalSignal('failed');
            }
            if (env.event === 'agent.stopped' || env.event === 'run.cancelled') {
              terminalReason = 'stopped';
              throw new TerminalSignal('stopped');
            }
          },

          onclose: () => {
            if (terminalReason === null) {
              throw new Error('agent stream closed unexpectedly');
            }
          },

          onerror: (err) => {
            if (err instanceof TerminalSignal) throw err;
            if (err instanceof NonRetriableError) throw err;
            reconnectAttempt += 1;
            if (reconnectAttempt > MAX_RECONNECT_ATTEMPTS) throw err;
            setStatus('reconnecting');
            updateMessage(assistantMessage.id, (prev) => ({
              events: upsertTimeline(prev.events, {
                id: 'events.reconnecting',
                kind: 'connection',
                status: 'running',
                title: '事件流重连中',
                detail: `第 ${reconnectAttempt} 次`,
                createdAt: Date.now(),
              }),
            }));
            return RECONNECT_DELAYS_MS[
              Math.min(reconnectAttempt - 1, RECONNECT_DELAYS_MS.length - 1)
            ];
          },
        });
      } catch (err) {
        if (err instanceof TerminalSignal) {
          if (err.reason === 'failed') {
            updateMessage(assistantMessage.id, (prev) => ({
              status: 'failed',
              error: prev.error ?? '生成失败',
            }));
            setStatus('error');
            setErrorText('生成失败，请重试');
          } else {
            updateMessage(assistantMessage.id, { status: 'done' });
            setStatus('idle');
          }
          return;
        }

        if (controller.signal.aborted) {
          updateMessage(assistantMessage.id, { status: 'done' });
          setStatus('idle');
          return;
        }

        const message = err instanceof Error ? err.message : String(err);
        updateMessage(assistantMessage.id, (prev) => ({
          status: 'failed',
          error: message,
          events: upsertTimeline(prev.events, {
            id: 'events.failed',
            kind: 'error',
            status: 'error',
            title: '事件流中断',
            detail: message,
            createdAt: Date.now(),
          }),
        }));
        setStatus('error');
        setErrorText(message);
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
        if (activeRunIdRef.current === runId) activeRunIdRef.current = null;
        if (activeAssistantIdRef.current === assistantMessage.id)
          activeAssistantIdRef.current = null;
      }
    },
    [profile, sid, context, onWorkflowUpdate, onWorkflowNodeStatus, updateMessage, getToken],
  );

  return { messages, status, errorText, send, stop, sessionId: sid };
}

export async function fetchAgentSessions(params: {
  workflowId?: string;
  limit?: number;
  after?: string;
  signal?: AbortSignal;
  token: string | null;
}): Promise<AgentSessionSummary[]> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (params.token) headers.authorization = `Bearer ${params.token}`;

  const query = new URLSearchParams();
  if (params.workflowId) query.set('workflow_id', params.workflowId);
  query.set('limit', String(params.limit ?? 20));
  if (params.after) query.set('after', params.after);

  const response = await fetch(`${AGENT_URL}/v1/agent/sessions?${query.toString()}`, {
    method: 'GET',
    headers,
    signal: params.signal,
  });

  const rawText = await response.text().catch(() => '');
  const payload = parseJsonPayload(rawText) as SessionsResponse | ApiError | null;
  if (!response.ok) {
    throw new Error(readApiError(payload) ?? (rawText || `HTTP ${response.status}`));
  }

  return payload && 'sessions' in payload && Array.isArray(payload.sessions)
    ? payload.sessions
    : [];
}

async function createRun(params: {
  sessionId: string;
  profile: string;
  message: string;
  context?: Record<string, unknown>;
  signal: AbortSignal;
  token: string | null;
}): Promise<string> {
  let attempt = 0;
  let lastError: unknown;

  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (params.token) headers.authorization = `Bearer ${params.token}`;
  // browserTracingIntegration 应该会自动给 fetch 注入；这里再手动兜底一次，
  // 防止第三方封装把头吞掉，保证 Flow A（对话）一定串到 agent 的 trace。
  const td = Sentry.getTraceData();
  if (td['sentry-trace']) {
    headers['sentry-trace'] = td['sentry-trace'];
    if (td.baggage) headers.baggage = td.baggage;
  }

  while (attempt < MAX_CREATE_ATTEMPTS) {
    attempt += 1;
    try {
      const response = await fetch(`${AGENT_URL}/v1/agent/runs`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          session_id: params.sessionId,
          message: params.message,
          profile: params.profile,
          context: params.context,
          client_request_id: nanoid(),
        }),
        signal: params.signal,
      });

      const rawText = await response.text().catch(() => '');
      const payload = parseJsonPayload(rawText);

      if (!response.ok) {
        const message = readApiError(payload) ?? (rawText || `HTTP ${response.status}`);
        if (response.status >= 400 && response.status < 500 && response.status !== 408) {
          throw new NonRetriableError(message);
        }
        throw new Error(message);
      }

      const runId = readRunId(payload);
      if (!runId) {
        throw new Error('createRun response missing run_id');
      }
      return runId;
    } catch (err) {
      if (params.signal.aborted) throw err;
      if (err instanceof NonRetriableError) throw err;
      lastError = err;
      if (attempt >= MAX_CREATE_ATTEMPTS) break;
      const delay = CREATE_DELAYS_MS[attempt - 1] ?? 8000;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function fetchSessionHistory(params: {
  sessionId: string;
  signal: AbortSignal;
  token: string | null;
}): Promise<ChatMessage[]> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (params.token) headers.authorization = `Bearer ${params.token}`;

  const response = await fetch(
    `${AGENT_URL}/v1/agent/sessions/${encodeURIComponent(params.sessionId)}/messages?limit=240`,
    {
      method: 'GET',
      headers,
      signal: params.signal,
    },
  );

  if (response.status === 404) return [];
  const rawText = await response.text().catch(() => '');
  const payload = parseJsonPayload(rawText) as HistoryResponse | ApiError | null;
  if (!response.ok) {
    throw new Error(readApiError(payload) ?? (rawText || `HTTP ${response.status}`));
  }

  const messages =
    payload && 'messages' in payload && Array.isArray(payload.messages) ? payload.messages : [];
  return projectHistoryMessages(messages);
}

function projectHistoryMessages(stored: StoredHistoryMessage[]): ChatMessage[] {
  const messages: ChatMessage[] = [];
  const assistantByTurn = new Map<string, ChatMessage>();

  const ensureAssistant = (turnKey: string, createdAt: number) => {
    const existing = assistantByTurn.get(turnKey);
    if (existing) return existing;

    const message: ChatMessage = {
      id: `history-assistant-${turnKey}-${messages.length}`,
      role: 'assistant',
      content: '',
      createdAt,
      status: 'done',
      thinking: '',
      events: [],
    };
    assistantByTurn.set(turnKey, message);
    messages.push(message);
    return message;
  };

  stored.forEach((item, index) => {
    const role = readString(item.role);
    const createdAt = parseHistoryTimestamp(item.created_at);
    const turnKey =
      typeof item.turn === 'number' && Number.isFinite(item.turn)
        ? String(item.turn)
        : `t-${index}`;

    if (role === 'user') {
      messages.push({
        id: `history-user-${turnKey}-${index}`,
        role: 'user',
        content: historyContentToText(item.content),
        createdAt,
        status: 'done',
      });
      return;
    }

    if (role === 'assistant') {
      const content = historyContentToText(item.content);
      if (!content && !assistantByTurn.has(turnKey)) return;
      const assistant = ensureAssistant(turnKey, createdAt);
      assistant.content = content || assistant.content;
      assistant.status = 'done';
      return;
    }

    if (role === 'tool_call') {
      const assistant = ensureAssistant(turnKey, createdAt);
      const toolName = item.tool_name ?? 'tool';
      const toolCallId = item.tool_call_id ?? `history-${index}`;
      const args = asRecord(item.tool_call);
      assistant.events = upsertTimeline(assistant.events, {
        id: `tool.${toolCallId}`,
        kind: 'tool',
        status: 'running',
        title: `调用 ${formatToolName(toolName)}`,
        detail: summarizeArguments(args),
        toolName,
        payload: args,
        createdAt,
      });
      return;
    }

    if (role === 'tool_result') {
      const assistant = ensureAssistant(turnKey, createdAt);
      const toolName = item.tool_name ?? 'tool';
      const toolCallId = item.tool_call_id ?? `history-${index}`;
      const status = item.status === 'error' ? 'error' : 'success';
      assistant.events = upsertTimeline(assistant.events, {
        id: `tool.${toolCallId}`,
        kind: 'tool',
        status,
        title:
          status === 'error'
            ? `${formatToolName(toolName)} 执行失败`
            : `${formatToolName(toolName)} 已完成`,
        detail:
          item.error ??
          formatToolResultDetail(readNumber(item.duration_ms), readNumber(item.output_size_bytes)),
        durationMs: readNumber(item.duration_ms) ?? undefined,
        toolName,
        createdAt,
      });
      return;
    }

    if (role === 'tool_event') {
      const assistant = ensureAssistant(turnKey, createdAt);
      const toolName = item.tool_name ?? 'tool';
      const eventName = item.event ?? 'event';
      const data = asRecord(item.event_data);
      assistant.events = appendTimeline(assistant.events, {
        id: workflowTimelineId(item.tool_call_id ?? `history-${index}`, eventName, data),
        kind: 'tool_event',
        status: workflowTimelineStatus(eventName, data),
        title: formatWorkflowEventTitle(eventName, data),
        detail: summarizeWorkflowEventDetail(eventName, data) || formatToolName(toolName),
        toolName,
        eventName,
        payload: data,
        createdAt,
      });
    }
  });

  return messages.filter(
    (message) => message.role === 'user' || message.content || message.events?.length,
  );
}

function parseHistoryTimestamp(value: unknown): number {
  if (typeof value !== 'string') return Date.now();
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : Date.now();
}

function historyContentToText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value
      .map((part) => {
        const record = asRecord(part);
        return readString(record.text) ?? readString(record.content) ?? '';
      })
      .filter(Boolean)
      .join('\n');
  }
  if (value === null || value === undefined) return '';
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function handleEvent(
  env: SseEnvelope,
  assistantId: string,
  updateMessage: (
    id: string,
    patch: Partial<ChatMessage> | ((prev: ChatMessage) => Partial<ChatMessage>),
  ) => void,
  handlers: {
    onWorkflowUpdate?: (data: Record<string, unknown>) => void | Promise<void>;
    onWorkflowNodeStatus?: (data: Record<string, unknown>) => void | Promise<void>;
  } = {},
) {
  switch (env.event) {
    case 'agent.started': {
      const runId = readString(env.data.run_id);
      updateMessage(assistantId, (prev) => ({
        runId: runId ?? prev.runId,
        events: upsertTimeline(prev.events, {
          id: 'agent.started',
          kind: 'run',
          status: 'running',
          title: 'Agent 已启动',
          detail: runId ? `run ${runId.slice(0, 8)}` : undefined,
          createdAt: Date.now(),
        }),
      }));
      return;
    }

    case 'message.delta': {
      const delta = readString(env.data.content) ?? '';
      if (!delta) return;
      updateMessage(assistantId, (prev) => ({ content: prev.content + delta }));
      return;
    }

    case 'thinking.delta': {
      const delta = readString(env.data.content) ?? '';
      if (!delta) return;
      updateMessage(assistantId, (prev) => ({
        thinking: `${prev.thinking ?? ''}${delta}`,
        events: upsertTimeline(prev.events, {
          id: 'thinking.live',
          kind: 'thinking',
          status: 'running',
          title: '正在思考',
          detail: compactText(delta, 90),
          createdAt: Date.now(),
        }),
      }));
      return;
    }

    case 'step.started': {
      const iteration = readNumber(env.data.iteration);
      const id = `step.${iteration ?? 'unknown'}`;
      updateMessage(assistantId, (prev) => ({
        events: upsertTimeline(prev.events, {
          id,
          kind: 'step',
          status: 'running',
          title: iteration ? `第 ${iteration} 轮推理` : '开始推理',
          createdAt: Date.now(),
        }),
      }));
      return;
    }

    case 'step.completed': {
      const iteration = readNumber(env.data.iteration);
      const id = `step.${iteration ?? 'unknown'}`;
      updateMessage(assistantId, (prev) => ({
        events: upsertTimeline(prev.events, {
          id,
          kind: 'step',
          status: 'success',
          title: iteration ? `第 ${iteration} 轮完成` : '推理完成',
          createdAt: Date.now(),
        }),
      }));
      return;
    }

    case 'tool.started': {
      const toolName = readString(env.data.tool_name) ?? 'tool';
      const toolCallId = readString(env.data.tool_call_id) ?? nanoid(8);
      const args = asRecord(env.data.arguments);
      updateMessage(assistantId, (prev) => ({
        events: upsertTimeline(prev.events, {
          id: `tool.${toolCallId}`,
          kind: 'tool',
          status: 'running',
          title: `调用 ${formatToolName(toolName)}`,
          detail: summarizeArguments(args),
          toolName,
          payload: args,
          createdAt: Date.now(),
        }),
      }));
      return;
    }

    case 'tool.event': {
      const toolName = readString(env.data.tool_name) ?? 'tool';
      const eventName = readString(env.data.event) ?? 'event';
      const toolCallId = readString(env.data.tool_call_id) ?? nanoid(8);
      const data = asRecord(env.data.data);
      notifyWorkflowHandler(eventName, data, handlers);
      updateMessage(assistantId, (prev) => ({
        events: upsertTimeline(prev.events, {
          id: workflowTimelineId(toolCallId, eventName, data),
          kind: 'tool_event',
          status: workflowTimelineStatus(eventName, data),
          title: formatWorkflowEventTitle(eventName, data),
          detail: summarizeWorkflowEventDetail(eventName, data) || formatToolName(toolName),
          toolName,
          eventName,
          payload: data,
          createdAt: Date.now(),
        }),
      }));
      return;
    }

    case 'tool.completed': {
      const toolName = readString(env.data.tool_name) ?? 'tool';
      const toolCallId = readString(env.data.tool_call_id) ?? nanoid(8);
      const status = readString(env.data.status) === 'error' ? 'error' : 'success';
      const durationMs = readNumber(env.data.duration_ms);
      const error = readString(env.data.error);
      const bytes = readNumber(env.data.output_size_bytes);
      updateMessage(assistantId, (prev) => ({
        events: upsertTimeline(prev.events, {
          id: `tool.${toolCallId}`,
          kind: 'tool',
          status,
          title:
            status === 'error'
              ? `${formatToolName(toolName)} 执行失败`
              : `${formatToolName(toolName)} 已完成`,
          detail: error ?? formatToolResultDetail(durationMs, bytes),
          durationMs: durationMs ?? undefined,
          toolName,
          createdAt: Date.now(),
        }),
      }));
      return;
    }

    case 'tool.failed': {
      const toolName = readString(env.data.tool_name) ?? 'tool';
      const toolCallId = readString(env.data.tool_call_id) ?? nanoid(8);
      const error = readString(env.data.error) ?? '工具执行失败';
      updateMessage(assistantId, (prev) => ({
        events: upsertTimeline(prev.events, {
          id: `tool.${toolCallId}`,
          kind: 'tool',
          status: 'error',
          title: `${formatToolName(toolName)} 执行失败`,
          detail: error,
          toolName,
          createdAt: Date.now(),
        }),
      }));
      return;
    }

    case 'agent.completed': {
      const final = readString(env.data.content);
      const usage = asNumberRecord(env.data.usage);
      updateMessage(assistantId, (prev) => ({
        status: 'done',
        content: final && final.length > 0 ? final : prev.content,
        usage: usage ?? prev.usage,
        events: upsertTimeline(prev.events, {
          id: 'agent.completed',
          kind: 'message',
          status: 'success',
          title: '回复已完成',
          createdAt: Date.now(),
        }),
      }));
      return;
    }

    case 'run.completed': {
      updateMessage(assistantId, (prev) => ({
        events: upsertTimeline(prev.events, {
          id: 'run.completed',
          kind: 'run',
          status: 'success',
          title: '任务已完成',
          createdAt: Date.now(),
        }),
      }));
      return;
    }

    case 'agent.stopped':
    case 'run.cancelled': {
      updateMessage(assistantId, (prev) => ({
        status: 'done',
        events: upsertTimeline(prev.events, {
          id: 'run.cancelled',
          kind: 'run',
          status: 'info',
          title: '任务已停止',
          createdAt: Date.now(),
        }),
      }));
      return;
    }

    case 'agent.failed':
    case 'run.failed': {
      const error = readString(env.data.error) ?? '生成失败';
      updateMessage(assistantId, (prev) => ({
        status: 'failed',
        error,
        events: upsertTimeline(prev.events, {
          id: env.event,
          kind: 'error',
          status: 'error',
          title: env.event === 'run.failed' ? '任务执行失败' : 'Agent 执行失败',
          detail: error,
          createdAt: Date.now(),
        }),
      }));
      return;
    }

    case 'agent.heartbeat':
      return;

    default:
      if (TERMINAL_EVENT_NAMES.has(env.event)) return;
      updateMessage(assistantId, (prev) => ({
        events: appendTimeline(prev.events, {
          id: `event.${nanoid(8)}`,
          kind: 'connection',
          status: 'info',
          title: formatEventName(env.event),
          detail: summarizeArguments(env.data),
          payload: env.data,
          createdAt: Date.now(),
        }),
      }));
      return;
  }
}

function parseJsonPayload(rawText: string): CreateRunPayload | null {
  if (!rawText) return null;
  try {
    return JSON.parse(rawText) as CreateRunPayload;
  } catch {
    return null;
  }
}

function readRunId(payload: CreateRunPayload | null): string | null {
  if (!payload) return null;
  if ('run_id' in payload && typeof payload.run_id === 'string') return payload.run_id;
  if (
    'ok' in payload &&
    payload.ok === true &&
    payload.data &&
    typeof payload.data.run_id === 'string'
  ) {
    return payload.data.run_id;
  }
  return null;
}

function readApiError(
  payload: ApiError | CreateRunPayload | HistoryResponse | SessionsResponse | null,
): string | null {
  if (!payload) return null;
  if ('message' in payload && typeof payload.message === 'string') return payload.message;
  if (!('error' in payload)) return null;
  if (typeof payload.error === 'string') return payload.error;
  if (payload.error && typeof payload.error.message === 'string') return payload.error.message;
  return null;
}

function notifyWorkflowHandler(
  eventName: string,
  data: Record<string, unknown>,
  handlers: {
    onWorkflowUpdate?: (data: Record<string, unknown>) => void | Promise<void>;
    onWorkflowNodeStatus?: (data: Record<string, unknown>) => void | Promise<void>;
  },
) {
  const handler =
    eventName === 'workflow_update'
      ? handlers.onWorkflowUpdate
      : eventName === 'workflow_node_status'
        ? handlers.onWorkflowNodeStatus
        : undefined;
  if (!handler) return;
  void Promise.resolve(handler(data)).catch((error) => {
    console.error('workflow event handler failed', error);
  });
}

function workflowTimelineStatus(
  eventName: string,
  data: Record<string, unknown>,
): ChatTimelineStatus {
  if (eventName === 'workflow_update' || eventName === 'workflow_completed') return 'success';
  if (eventName !== 'workflow_node_status') return 'info';
  const status = readString(data.status);
  if (status === 'queued') return 'queued';
  if (status === 'running') return 'running';
  if (status === 'success') return 'success';
  if (status === 'error') return 'error';
  return 'info';
}

function formatWorkflowEventTitle(eventName: string, data: Record<string, unknown>): string {
  if (eventName === 'workflow_update') return '画布已更新';
  if (eventName === 'workflow_completed') return '工作流运行完成';
  if (eventName === 'workflow_node_status') {
    const status = readString(data.status);
    const nodeTitle = readString(data.node_title);
    const prefix = nodeTitle ? `节点 ${nodeTitle}` : '节点';
    if (status === 'queued') return `${prefix} 已排队`;
    if (status === 'running') return `${prefix} 运行中`;
    if (status === 'success') return `${prefix} 已完成`;
    if (status === 'error') return `${prefix} 运行失败`;
    return '节点状态更新';
  }
  return formatEventName(eventName);
}

function summarizeWorkflowEventDetail(
  eventName: string,
  data: Record<string, unknown>,
): string | undefined {
  if (eventName === 'workflow_update') {
    const nodeCount = readNumber(data.node_count);
    const edgeCount = readNumber(data.edge_count);
    const reason = readString(data.reason);
    const parts = [
      nodeCount !== null ? `${nodeCount} nodes` : null,
      edgeCount !== null ? `${edgeCount} edges` : null,
      reason,
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(' · ') : undefined;
  }
  if (eventName === 'workflow_node_status') {
    const nodeId = readString(data.node_id);
    const nodeKind = readString(data.node_kind);
    const progress = readNumber(data.progress);
    const error = readString(data.error);
    if (error) return compactText(error, 90);
    const parts = [
      nodeKind,
      nodeId ? `node ${nodeId}` : null,
      progress !== null ? `${Math.round(progress * 100)}%` : null,
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(' · ') : undefined;
  }
  return summarizeArguments(data);
}

function workflowTimelineId(
  toolCallId: string,
  eventName: string,
  data: Record<string, unknown>,
): string {
  if (eventName === 'workflow_node_status') {
    const nodeId = readString(data.node_id) ?? 'node';
    return `tool.event.${toolCallId}.${eventName}.${nodeId}`;
  }
  if (eventName === 'workflow_update') {
    const reason = readString(data.reason) ?? 'update';
    const nodeId = readString(data.node_id) ?? 'canvas';
    return `tool.event.${toolCallId}.${eventName}.${reason}.${nodeId}`;
  }
  return `tool.event.${toolCallId}.${eventName}`;
}

function upsertTimeline(
  events: ChatTimelineItem[] | undefined,
  item: ChatTimelineItem,
): ChatTimelineItem[] {
  const current = events ?? [];
  const index = current.findIndex((event) => event.id === item.id);
  if (index === -1) return appendTimeline(current, item);
  const next = current.slice();
  const prev = next[index];
  if (!prev) return appendTimeline(current, item);
  next[index] = { ...prev, ...item, createdAt: prev.createdAt };
  return next.slice(-MAX_TIMELINE_ITEMS);
}

function appendTimeline(
  events: ChatTimelineItem[] | undefined,
  item: ChatTimelineItem,
): ChatTimelineItem[] {
  return [...(events ?? []), item].slice(-MAX_TIMELINE_ITEMS);
}

function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asNumberRecord(value: unknown): Record<string, number> | null {
  const record = asRecord(value);
  const entries = Object.entries(record).filter(([, v]) => typeof v === 'number');
  if (entries.length === 0) return null;
  return Object.fromEntries(entries) as Record<string, number>;
}

function summarizeArguments(value: Record<string, unknown>): string | undefined {
  const entries = Object.entries(value).filter(([, v]) => v !== undefined && v !== null);
  if (entries.length === 0) return undefined;
  return entries
    .slice(0, 3)
    .map(([key, val]) => `${key}: ${compactValue(val)}`)
    .join(' · ');
}

function compactValue(value: unknown): string {
  if (typeof value === 'string') return compactText(value, 54);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `[${value.length} items]`;
  if (value && typeof value === 'object') return '{...}';
  return String(value);
}

function compactText(text: string, maxLength: number): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  if (oneLine.length <= maxLength) return oneLine;
  return `${oneLine.slice(0, maxLength - 1)}…`;
}

function formatToolName(name: string): string {
  const labels: Record<string, string> = {
    load_skill: '加载技能',
    get_workflow: '读取画布',
    edit_workflow: '编辑画布',
    run_workflow_node: '运行节点',
    web_search: '联网搜索',
  };
  if (labels[name]) return labels[name];
  return name
    .split(/[_\-.]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatEventName(name: string): string {
  return name.replace(/[_.]/g, ' ');
}

function formatToolResultDetail(
  durationMs: number | null,
  bytes: number | null,
): string | undefined {
  const parts: string[] = [];
  if (durationMs !== null) parts.push(`${Math.round(durationMs)}ms`);
  if (bytes !== null) parts.push(`${bytes} bytes`);
  return parts.length > 0 ? parts.join(' · ') : undefined;
}
