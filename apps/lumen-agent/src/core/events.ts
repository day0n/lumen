/**
 * SSE 事件信封 + 构造器。
 *
 * 事件命名走 dot-notation（agent.started / tool.completed），
 * 每个事件被包成 `{ event: name, data: ... }` 后由 SSE writer 序列化。
 */

import { nanoid } from 'nanoid';

import type {
  AgentCompletedData,
  AgentFailedData,
  AgentStartedData,
  ToolCompletedData,
  ToolEventData,
  ToolFailedData,
  ToolStartedData,
} from '../schemas/events.js';

export interface AgentEvent {
  event: string;
  data: Record<string, unknown>;
}

const TERMINAL = new Set(['run.completed', 'run.failed', 'run.cancelled']);

export function isTerminal(e: AgentEvent): boolean {
  return TERMINAL.has(e.event);
}

// ── agent lifecycle ──────────────────────────────────────────────

export function agentStarted(sessionId: string, runId?: string): AgentEvent {
  const data: AgentStartedData = {
    session_id: sessionId,
    run_id: runId ?? nanoid(12),
  };
  return { event: 'agent.started', data };
}

export function agentCompleted(content: string, usage?: Record<string, number>): AgentEvent {
  const data: AgentCompletedData = { content, usage };
  return { event: 'agent.completed', data };
}

export function agentFailed(
  error: string,
  opts: { code?: string; category?: string; details?: Record<string, unknown> } = {},
): AgentEvent {
  const data: AgentFailedData = { error, ...opts };
  return { event: 'agent.failed', data };
}

export function agentStopped(): AgentEvent {
  return { event: 'agent.stopped', data: {} };
}

export function agentHeartbeat(): AgentEvent {
  return { event: 'agent.heartbeat', data: {} };
}

// ── streaming deltas ─────────────────────────────────────────────

export function messageDelta(content: string): AgentEvent {
  return { event: 'message.delta', data: { content } };
}

export function thinkingDelta(content: string): AgentEvent {
  return { event: 'thinking.delta', data: { content } };
}

// ── steps ────────────────────────────────────────────────────────

export function stepStarted(iteration: number): AgentEvent {
  return { event: 'step.started', data: { iteration } };
}

export function stepCompleted(iteration: number): AgentEvent {
  return { event: 'step.completed', data: { iteration } };
}

// ── tool events ──────────────────────────────────────────────────

export function toolStarted(d: ToolStartedData): AgentEvent {
  return { event: 'tool.started', data: d };
}

export function toolCompleted(d: ToolCompletedData): AgentEvent {
  return { event: 'tool.completed', data: d };
}

export function toolFailed(d: ToolFailedData): AgentEvent {
  return { event: 'tool.failed', data: d };
}

export function toolEvent(d: ToolEventData): AgentEvent {
  return { event: 'tool.event', data: d };
}

// ── run lifecycle ────────────────────────────────────────────────

export function runCompleted(runId: string): AgentEvent {
  return { event: 'run.completed', data: { run_id: runId } };
}

export function runFailed(runId: string, error: string): AgentEvent {
  return { event: 'run.failed', data: { run_id: runId, error } };
}

export function runCancelled(runId: string): AgentEvent {
  return { event: 'run.cancelled', data: { run_id: runId } };
}
