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

import { translate } from '@/i18n/messages';
import type { Locale } from '@/i18n/routing';
import { formatPublicWorkflowError } from '@/lib/public-workflow-error';

const AGENT_URL = process.env.NEXT_PUBLIC_AGENT_URL ?? 'http://localhost:3001';

export type ChatRole = 'user' | 'assistant';

export type ChatTimelineKind =
  | 'connection'
  | 'run'
  | 'step'
  | 'thinking'
  | 'tool'
  | 'act_event'
  | 'message'
  | 'error';

export type ChatTimelineStatus = 'queued' | 'running' | 'success' | 'error' | 'cancelled' | 'info';
export type ChatFeedback = 'like' | 'dislike';

export interface ChatTimelineItem {
  id: string;
  kind: ChatTimelineKind;
  status: ChatTimelineStatus;
  title: string;
  detail?: string;
  createdAt: number;
  durationMs?: number;
  toolCallId?: string;
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
  turn?: number;
  feedback?: ChatFeedback | null;
  thinking?: string;
  events?: ChatTimelineItem[];
  usage?: Record<string, number>;
}

export type AgentChatStatus = 'idle' | 'creating' | 'streaming' | 'reconnecting' | 'error';

interface UseAgentChatOptions {
  sessionId?: string;
  profile?: string;
  context?: Record<string, unknown>;
  locale?: Locale;
  loadHistory?: boolean;
  onWorkflowUpdate?: (data: Record<string, unknown>) => void | Promise<void>;
  onWorkflowNodeStatus?: (data: Record<string, unknown>) => void | Promise<void>;
}

interface SseEnvelope {
  event: string;
  data: Record<string, unknown>;
}

type WorkflowEventHandlers = {
  onWorkflowUpdate?: (data: Record<string, unknown>) => void | Promise<void>;
  onWorkflowNodeStatus?: (data: Record<string, unknown>) => void | Promise<void>;
  workflowProjectId?: string | null;
};

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
  'run:answer',
  'run:error',
  'run:halt',
  'run:done',
  'run:abort',
  'run:cancel',
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
  run_id?: string;
  feedback?: unknown;
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
  locale = 'en',
  loadHistory = true,
  onWorkflowUpdate,
  onWorkflowNodeStatus,
}: UseAgentChatOptions = {}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<AgentChatStatus>('idle');
  const [errorText, setErrorText] = useState<string | null>(null);
  const { getToken } = useAuth();
  const tt = useCallback(
    (key: string, params?: Record<string, string | number | boolean | null | undefined>) =>
      translate(locale, key, params),
    [locale],
  );

  const sid = useMemo(() => sessionId ?? `studio-${nanoid(12)}`, [sessionId]);
  const sessionHistoryKey = useMemo(() => `${locale}:${sid}`, [locale, sid]);
  const workflowProjectId = useMemo(
    () => readString(context?.project_id) ?? readString(context?.workflow_id),
    [context],
  );
  const abortRef = useRef<AbortController | null>(null);
  const activeRunIdRef = useRef<string | null>(null);
  const activeAssistantIdRef = useRef<string | null>(null);
  const loadedHistoryKeyRef = useRef<string | null>(null);
  const resetHistoryKeyRef = useRef<string | null>(null);
  const workflowHandlersRef = useRef<WorkflowEventHandlers>({
    onWorkflowUpdate,
    onWorkflowNodeStatus,
    workflowProjectId,
  });

  useEffect(() => {
    workflowHandlersRef.current = {
      onWorkflowUpdate,
      onWorkflowNodeStatus,
      workflowProjectId,
    };
  }, [onWorkflowNodeStatus, onWorkflowUpdate, workflowProjectId]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  useEffect(() => {
    if (resetHistoryKeyRef.current === sessionHistoryKey) return;
    resetHistoryKeyRef.current = sessionHistoryKey;
    abortRef.current?.abort();
    abortRef.current = null;
    activeRunIdRef.current = null;
    activeAssistantIdRef.current = null;
    setMessages([]);
    setStatus('idle');
    setErrorText(null);
    loadedHistoryKeyRef.current = null;
  }, [sessionHistoryKey]);

  useEffect(() => {
    if (!sessionId || !loadHistory) return;
    const historyKey = `${locale}:${sessionId}`;
    if (loadedHistoryKeyRef.current === historyKey) return;
    loadedHistoryKeyRef.current = historyKey;

    const controller = new AbortController();
    void getToken()
      .catch(() => null)
      .then((token) =>
        fetchSessionHistory({
          locale,
          sessionId,
          signal: controller.signal,
          token,
        }),
      )
      .then((historyMessages) => {
        if (controller.signal.aborted) return;
        if (historyMessages.length === 0) {
          loadedHistoryKeyRef.current = null;
          return;
        }
        setMessages((prev) => (prev.length === 0 ? historyMessages : prev));
        void replayWorkflowTimelineHandlers(historyMessages, workflowHandlersRef.current);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        loadedHistoryKeyRef.current = null;
        console.error('failed to load agent session history', err);
      });

    return () => controller.abort();
  }, [getToken, loadHistory, locale, sessionId]);

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
          title: tt('chat.timeline.stopped'),
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
  }, [getToken, tt, updateMessage]);

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
            title: tt('chat.timeline.submitting'),
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
          locale,
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
            title: tt('chat.timeline.submitFailed'),
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
          title: tt('chat.timeline.queued'),
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
      eventsHeaders['x-lumen-locale'] = locale;
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
                title: tt('chat.timeline.connected'),
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
            const workflowHandlers = workflowHandlersRef.current;
            handleEvent(env, assistantMessage.id, updateMessage, {
              onWorkflowUpdate: workflowHandlers.onWorkflowUpdate,
              onWorkflowNodeStatus: workflowHandlers.onWorkflowNodeStatus,
              locale,
              workflowProjectId: workflowHandlers.workflowProjectId,
            });

            if (env.event === 'run:answer' || env.event === 'run:done') {
              terminalReason = 'completed';
              throw new TerminalSignal('completed');
            }
            if (env.event === 'run:error' || env.event === 'run:abort') {
              terminalReason = 'failed';
              throw new TerminalSignal('failed');
            }
            if (env.event === 'run:halt' || env.event === 'run:cancel') {
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
                title: tt('chat.timeline.reconnecting'),
                detail: tt('chat.timeline.attempt', { count: reconnectAttempt }),
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
              error: prev.error ?? tt('chat.failed'),
            }));
            setStatus('error');
            setErrorText(tt('chat.retry'));
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
            title: tt('chat.timeline.interrupted'),
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
    [profile, sid, context, locale, updateMessage, getToken, tt],
  );

  const setMessageFeedback = useCallback(
    async (params: {
      messageId: string;
      runId?: string;
      turn?: number;
      feedback: ChatFeedback | null;
      previousFeedback?: ChatFeedback | null;
    }) => {
      if (!params.runId && typeof params.turn !== 'number') {
        throw new Error('message feedback requires runId or turn');
      }

      updateMessage(params.messageId, { feedback: params.feedback });
      try {
        const token = await getToken().catch(() => null);
        await updateAgentMessageFeedback({
          sessionId: sid,
          runId: params.runId,
          turn: params.turn,
          feedback: params.feedback,
          token,
        });
      } catch (err) {
        updateMessage(params.messageId, { feedback: params.previousFeedback ?? null });
        throw err;
      }
    },
    [getToken, sid, updateMessage],
  );

  return { messages, status, errorText, send, stop, setMessageFeedback, sessionId: sid };
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
  locale: Locale;
  signal: AbortSignal;
  token: string | null;
}): Promise<string> {
  let attempt = 0;
  let lastError: unknown;

  const headers: Record<string, string> = { 'content-type': 'application/json' };
  headers['x-lumen-locale'] = params.locale;
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
  locale: Locale;
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
  return projectHistoryMessages(messages, params.locale);
}

function projectHistoryMessages(stored: StoredHistoryMessage[], locale: Locale): ChatMessage[] {
  const messages: ChatMessage[] = [];
  const assistantByTurn = new Map<string, ChatMessage>();

  const ensureAssistant = (turnKey: string, createdAt: number, turn?: number) => {
    const existing = assistantByTurn.get(turnKey);
    if (existing) return existing;

    const message: ChatMessage = {
      id: `history-assistant-${turnKey}-${messages.length}`,
      role: 'assistant',
      content: '',
      createdAt,
      status: 'done',
      turn,
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
    const turn =
      typeof item.turn === 'number' && Number.isFinite(item.turn) ? item.turn : undefined;

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
      const assistant = ensureAssistant(turnKey, createdAt, turn);
      assistant.content = content || assistant.content;
      assistant.runId = readString(item.run_id) ?? assistant.runId;
      assistant.feedback = readFeedback(item.feedback);
      assistant.status = 'done';
      return;
    }

    if (role === 'act_call') {
      const assistant = ensureAssistant(turnKey, createdAt, turn);
      const toolName = item.tool_name ?? 'tool';
      const toolCallId = item.tool_call_id ?? `history-${index}`;
      const args = asRecord(item.tool_call);
      assistant.events = upsertTimeline(assistant.events, {
        id: `tool.${toolCallId}`,
        kind: 'tool',
        status: 'running',
        title: translate(locale, 'chat.timeline.callTool', {
          tool: formatToolName(toolName, locale),
        }),
        detail: summarizeArguments(args),
        toolCallId,
        toolName,
        payload: args,
        createdAt,
      });
      return;
    }

    if (role === 'act_result') {
      const assistant = ensureAssistant(turnKey, createdAt, turn);
      const toolName = item.tool_name ?? 'tool';
      const toolCallId = item.tool_call_id ?? `history-${index}`;
      const status = item.status === 'error' ? 'error' : 'success';
      assistant.events = upsertTimeline(assistant.events, {
        id: `tool.${toolCallId}`,
        kind: 'tool',
        status,
        title:
          status === 'error'
            ? translate(locale, 'chat.timeline.toolFailed', {
                tool: formatToolName(toolName, locale),
              })
            : translate(locale, 'chat.timeline.toolDone', {
                tool: formatToolName(toolName, locale),
              }),
        detail:
          item.error ??
          formatToolResultDetail(readNumber(item.duration_ms), readNumber(item.output_size_bytes)),
        durationMs: readNumber(item.duration_ms) ?? undefined,
        toolCallId,
        toolName,
        createdAt,
      });
      return;
    }

    if (role === 'act_event') {
      const assistant = ensureAssistant(turnKey, createdAt, turn);
      const toolName = item.tool_name ?? 'tool';
      const eventName = item.event ?? 'event';
      const data = asRecord(item.event_data);
      assistant.events = upsertTimeline(assistant.events, {
        id: workflowTimelineId(item.tool_call_id ?? `history-${index}`, eventName, data),
        kind: 'act_event',
        status: workflowTimelineStatus(eventName, data),
        title: formatWorkflowEventTitle(eventName, data, locale),
        detail:
          summarizeWorkflowEventDetail(eventName, data, locale) || formatToolName(toolName, locale),
        toolCallId: item.tool_call_id ?? `history-${index}`,
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

async function updateAgentMessageFeedback(params: {
  sessionId: string;
  runId?: string;
  turn?: number;
  feedback: ChatFeedback | null;
  token: string | null;
}): Promise<void> {
  const headers: Record<string, string> = {
    accept: 'application/json',
    'content-type': 'application/json',
  };
  if (params.token) headers.authorization = `Bearer ${params.token}`;

  const response = await fetch(
    `${AGENT_URL}/v1/agent/sessions/${encodeURIComponent(params.sessionId)}/messages/feedback`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        run_id: params.runId,
        turn: params.turn,
        feedback: params.feedback,
      }),
    },
  );

  if (response.ok) return;
  const rawText = await response.text().catch(() => '');
  const payload = parseJsonPayload(rawText) as ApiError | null;
  throw new Error(readApiError(payload) ?? (rawText || `HTTP ${response.status}`));
}

function readFeedback(value: unknown): ChatFeedback | null {
  return value === 'like' || value === 'dislike' ? value : null;
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
  handlers: { locale?: Locale } & WorkflowEventHandlers = {},
) {
  const locale = handlers.locale ?? 'en';
  const tt = (key: string, params?: Record<string, string | number | boolean | null | undefined>) =>
    translate(locale, key, params);
  switch (env.event) {
    case 'run:open': {
      const runId = readString(env.data.run_id);
      updateMessage(assistantId, (prev) => ({
        runId: runId ?? prev.runId,
        events: upsertTimeline(prev.events, {
          id: 'run:open',
          kind: 'run',
          status: 'running',
          title: tt('chat.timeline.connected'),
          detail: runId ? `run ${runId.slice(0, 8)}` : undefined,
          createdAt: Date.now(),
        }),
      }));
      return;
    }

    case 'stream:text': {
      const delta = readString(env.data.content) ?? '';
      if (!delta) return;
      updateMessage(assistantId, (prev) => ({ content: prev.content + delta }));
      return;
    }

    case 'stream:reasoning': {
      const delta = readString(env.data.content) ?? '';
      if (!delta) return;
      updateMessage(assistantId, (prev) => ({
        thinking: `${prev.thinking ?? ''}${delta}`,
        events: upsertTimeline(prev.events, {
          id: 'thinking.live',
          kind: 'thinking',
          status: 'running',
          title: tt('chat.timeline.thinkingRunning'),
          detail: compactText(delta, 90),
          createdAt: Date.now(),
        }),
      }));
      return;
    }

    case 'turn:enter': {
      const iteration = readNumber(env.data.iteration);
      const id = `step.${iteration ?? 'unknown'}`;
      updateMessage(assistantId, (prev) => ({
        events: upsertTimeline(prev.events, {
          id,
          kind: 'step',
          status: 'running',
          title: tt('chat.timeline.thinkingRunning'),
          detail: iteration ? tt('chat.timeline.attempt', { count: iteration }) : undefined,
          createdAt: Date.now(),
        }),
      }));
      return;
    }

    case 'turn:leave': {
      const iteration = readNumber(env.data.iteration);
      const id = `step.${iteration ?? 'unknown'}`;
      updateMessage(assistantId, (prev) => {
        const now = Date.now();
        const startedAt = prev.events?.find((event) => event.id === id)?.createdAt;
        const durationMs = typeof startedAt === 'number' ? Math.max(0, now - startedAt) : undefined;
        return {
          events: upsertTimeline(prev.events, {
            id,
            kind: 'step',
            status: 'success',
            title: tt('chat.timeline.thinkingSaved'),
            detail: iteration ? tt('chat.timeline.attempt', { count: iteration }) : undefined,
            durationMs,
            createdAt: now,
          }),
        };
      });
      return;
    }

    case 'call:begin': {
      const toolName = readString(env.data.tool_name) ?? 'tool';
      const toolCallId = readString(env.data.tool_call_id) ?? nanoid(8);
      const args = asRecord(env.data.arguments);
      updateMessage(assistantId, (prev) => ({
        events: upsertTimeline(prev.events, {
          id: `tool.${toolCallId}`,
          kind: 'tool',
          status: 'running',
          title: tt('chat.timeline.callTool', { tool: formatToolName(toolName, locale) }),
          detail: summarizeArguments(args),
          toolCallId,
          toolName,
          payload: args,
          createdAt: Date.now(),
        }),
      }));
      return;
    }

    case 'call:signal': {
      const toolName = readString(env.data.tool_name) ?? 'tool';
      const eventName = readString(env.data.event) ?? 'event';
      const toolCallId = readString(env.data.tool_call_id) ?? nanoid(8);
      const data = asRecord(env.data.data);
      notifyWorkflowHandler(eventName, data, handlers);
      updateMessage(assistantId, (prev) => ({
        events: upsertTimeline(prev.events, {
          id: workflowTimelineId(toolCallId, eventName, data),
          kind: 'act_event',
          status: workflowTimelineStatus(eventName, data),
          title: formatWorkflowEventTitle(eventName, data, locale),
          detail:
            summarizeWorkflowEventDetail(eventName, data, locale) ||
            formatToolName(toolName, locale),
          toolCallId,
          toolName,
          eventName,
          payload: data,
          createdAt: Date.now(),
        }),
      }));
      return;
    }

    case 'call:finish': {
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
              ? tt('chat.timeline.toolFailed', { tool: formatToolName(toolName, locale) })
              : tt('chat.timeline.toolDone', { tool: formatToolName(toolName, locale) }),
          detail: error ?? formatToolResultDetail(durationMs, bytes),
          durationMs: durationMs ?? undefined,
          toolCallId,
          toolName,
          createdAt: Date.now(),
        }),
      }));
      return;
    }

    case 'call:error': {
      const toolName = readString(env.data.tool_name) ?? 'tool';
      const toolCallId = readString(env.data.tool_call_id) ?? nanoid(8);
      const error = readString(env.data.error) ?? tt('chat.timeline.toolError');
      updateMessage(assistantId, (prev) => ({
        events: upsertTimeline(prev.events, {
          id: `tool.${toolCallId}`,
          kind: 'tool',
          status: 'error',
          title: tt('chat.timeline.toolFailed', { tool: formatToolName(toolName, locale) }),
          detail: error,
          toolCallId,
          toolName,
          createdAt: Date.now(),
        }),
      }));
      return;
    }

    case 'run:answer': {
      const final = readString(env.data.content);
      const usage = asNumberRecord(env.data.usage);
      updateMessage(assistantId, (prev) => ({
        status: 'done',
        content: final && final.length > 0 ? final : prev.content,
        usage: usage ?? prev.usage,
        events: upsertTimeline(prev.events, {
          id: 'run:answer',
          kind: 'message',
          status: 'success',
          title: tt('chat.timeline.completed'),
          createdAt: Date.now(),
        }),
      }));
      return;
    }

    case 'run:done': {
      updateMessage(assistantId, (prev) => ({
        events: upsertTimeline(prev.events, {
          id: 'run:done',
          kind: 'run',
          status: 'success',
          title: tt('chat.timeline.completed'),
          createdAt: Date.now(),
        }),
      }));
      return;
    }

    case 'run:halt':
    case 'run:cancel': {
      updateMessage(assistantId, (prev) => ({
        status: 'done',
        events: upsertTimeline(prev.events, {
          id: 'run:cancel',
          kind: 'run',
          status: 'info',
          title: tt('chat.timeline.taskStopped'),
          createdAt: Date.now(),
        }),
      }));
      return;
    }

    case 'run:error':
    case 'run:abort': {
      const error = readString(env.data.error) ?? tt('chat.failed');
      updateMessage(assistantId, (prev) => ({
        status: 'failed',
        error,
        events: upsertTimeline(prev.events, {
          id: env.event,
          kind: 'error',
          status: 'error',
          title:
            env.event === 'run:abort'
              ? tt('chat.timeline.taskFailed')
              : tt('chat.timeline.agentFailed'),
          detail: error,
          createdAt: Date.now(),
        }),
      }));
      return;
    }

    case 'run:ping':
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
  handlers: WorkflowEventHandlers,
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

async function replayWorkflowTimelineHandlers(
  messages: ChatMessage[],
  handlers: WorkflowEventHandlers,
) {
  const nodeEvents = new Map<string, ChatTimelineItem>();
  let workflowUpdate: ChatTimelineItem | null = null;

  for (const message of messages) {
    for (const event of message.events ?? []) {
      if (event.kind !== 'act_event' || !event.eventName || !event.payload) continue;
      const eventProjectId = readString(event.payload.project_id);
      if (
        handlers.workflowProjectId &&
        eventProjectId &&
        eventProjectId !== handlers.workflowProjectId
      ) {
        continue;
      }
      if (event.eventName === 'workflow_update') {
        if (!workflowUpdate || event.createdAt >= workflowUpdate.createdAt) workflowUpdate = event;
        continue;
      }
      if (event.eventName !== 'workflow_node_status') continue;
      const nodeId = readString(event.payload.node_id);
      if (!nodeId) continue;
      const current = nodeEvents.get(nodeId);
      if (!current || event.createdAt >= current.createdAt) nodeEvents.set(nodeId, event);
    }
  }

  try {
    if (workflowUpdate?.payload) await handlers.onWorkflowUpdate?.(workflowUpdate.payload);
    const sortedNodeEvents = [...nodeEvents.values()].sort((a, b) => a.createdAt - b.createdAt);
    for (const event of sortedNodeEvents) {
      if (event.payload) await handlers.onWorkflowNodeStatus?.(event.payload);
    }
  } catch (error) {
    console.error('workflow history replay failed', error);
  }
}

function workflowTimelineStatus(
  eventName: string,
  data: Record<string, unknown>,
): ChatTimelineStatus {
  if (eventName === 'workflow_update') return 'success';
  if (eventName === 'workflow_completed') {
    const status = readString(data.status);
    if (status === 'cancelled') return 'cancelled';
    if (status === 'error') return 'error';
    return 'success';
  }
  if (
    eventName === 'ad_video_results' ||
    eventName === 'inspiration_results' ||
    eventName === 'material_results'
  ) {
    return 'success';
  }
  if (eventName !== 'workflow_node_status') return 'info';
  const status = readString(data.status);
  if (status === 'queued') return 'queued';
  if (status === 'running') return 'running';
  if (status === 'success') return 'success';
  if (status === 'error') return 'error';
  if (status === 'cancelled') return 'cancelled';
  return 'info';
}

function formatWorkflowEventTitle(
  eventName: string,
  data: Record<string, unknown>,
  locale: Locale,
): string {
  if (eventName === 'workflow_update') return translate(locale, 'chat.timeline.workflowUpdated');
  if (eventName === 'workflow_completed') {
    if (readString(data.status) === 'cancelled')
      return translate(locale, 'chat.timeline.taskStopped');
    return translate(locale, 'chat.timeline.workflowCompleted');
  }
  if (eventName === 'inspiration_results') {
    return locale === 'zh' ? '已找到灵感' : 'Inspiration found';
  }
  if (eventName === 'ad_video_results') {
    const count = Array.isArray(data.results) ? data.results.length : 0;
    if (count === 0) return locale === 'zh' ? '未找到广告参考' : 'No ad references found';
    return locale === 'zh' ? '已找到广告参考' : 'Ad references found';
  }
  if (eventName === 'material_results') {
    const count = Array.isArray(data.results) ? data.results.length : 0;
    if (count === 0) return locale === 'zh' ? '未找到素材' : 'No materials found';
    return locale === 'zh' ? '已找到素材' : 'Materials found';
  }
  if (eventName === 'workflow_node_status') {
    const status = readString(data.status);
    const nodeTitle = readString(data.node_title);
    const title = nodeTitle ?? 'Node';
    if (status === 'queued') return translate(locale, 'chat.timeline.nodeQueued', { title });
    if (status === 'running') return translate(locale, 'chat.timeline.nodeRunning', { title });
    if (status === 'success') return translate(locale, 'chat.timeline.nodeDone', { title });
    if (status === 'error') return translate(locale, 'chat.timeline.nodeError', { title });
    if (status === 'cancelled') {
      return translate(locale, 'chat.timeline.nodeCancelled', { title });
    }
    return translate(locale, 'chat.timeline.nodeStatus');
  }
  return formatEventName(eventName);
}

function summarizeWorkflowEventDetail(
  eventName: string,
  data: Record<string, unknown>,
  locale: Locale,
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
    const publicError = formatPublicWorkflowError(data, (key) => translate(locale, key), error);
    if (publicError) return compactText(publicError, 90);
    const parts = [
      nodeKind,
      nodeId ? `node ${nodeId}` : null,
      progress !== null ? `${Math.round(progress * 100)}%` : null,
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(' · ') : undefined;
  }
  if (eventName === 'inspiration_results') {
    const query = readString(data.query);
    const count = Array.isArray(data.results) ? data.results.length : null;
    const parts = [query, count !== null ? `${count} images` : null].filter(Boolean);
    return parts.length > 0 ? parts.join(' · ') : undefined;
  }
  if (eventName === 'ad_video_results') {
    const query = readString(data.query);
    const count = Array.isArray(data.results) ? data.results.length : null;
    const totalCandidates = readNumber(data.total_candidates);
    const countLabel =
      count !== null ? (locale === 'zh' ? `${count} 条广告` : `${count} videos`) : null;
    const candidateLabel =
      totalCandidates !== null && totalCandidates !== count
        ? locale === 'zh'
          ? `${totalCandidates} 条候选`
          : `${totalCandidates} candidates`
        : null;
    const parts = [query, countLabel, candidateLabel].filter(Boolean);
    return parts.length > 0 ? parts.join(' · ') : undefined;
  }
  if (eventName === 'material_results') {
    const query = readString(data.query);
    const count = Array.isArray(data.results) ? data.results.length : null;
    const parts = [
      query,
      count !== null ? (locale === 'zh' ? `${count} 个素材` : `${count} materials`) : null,
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
  if (eventName === 'inspiration_results') return `tool.event.${toolCallId}.${eventName}`;
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

function formatToolName(name: string, locale: Locale = 'en'): string {
  const label = translate(locale, `chat.timeline.tools.${name}`);
  if (label !== `chat.timeline.tools.${name}`) return label;
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
