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

export function useAgentChat({ sessionId, profile = 'main' }: UseAgentChatOptions = {}) {
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
            handleEvent(env, assistantMessage.id, updateMessage);

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
    [profile, sid, updateMessage, getToken],
  );

  return { messages, status, errorText, send, stop, sessionId: sid };
}

async function createRun(params: {
  sessionId: string;
  profile: string;
  message: string;
  signal: AbortSignal;
  token: string | null;
}): Promise<string> {
  let attempt = 0;
  let lastError: unknown;

  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (params.token) headers.authorization = `Bearer ${params.token}`;

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

function handleEvent(
  env: SseEnvelope,
  assistantId: string,
  updateMessage: (
    id: string,
    patch: Partial<ChatMessage> | ((prev: ChatMessage) => Partial<ChatMessage>),
  ) => void,
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
      const data = asRecord(env.data.data);
      updateMessage(assistantId, (prev) => ({
        events: appendTimeline(prev.events, {
          id: `tool.event.${nanoid(8)}`,
          kind: 'tool_event',
          status: 'info',
          title: formatEventName(eventName),
          detail: summarizeArguments(data) || formatToolName(toolName),
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

function readApiError(payload: CreateRunPayload | null): string | null {
  if (!payload) return null;
  if ('message' in payload && typeof payload.message === 'string') return payload.message;
  if (!('error' in payload)) return null;
  if (typeof payload.error === 'string') return payload.error;
  if (payload.error && typeof payload.error.message === 'string') return payload.error.message;
  return null;
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
