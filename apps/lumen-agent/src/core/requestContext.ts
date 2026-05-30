import { AsyncLocalStorage } from 'node:async_hooks';

export interface AgentRequestContext {
  sessionId: string;
  userId: string;
  runId: string;
  projectId?: string;
  workflowId?: string;
  metadata?: Record<string, unknown>;
  context?: Record<string, unknown>;
}

const storage = new AsyncLocalStorage<AgentRequestContext>();

export function withAgentRequestContext<T>(
  context: AgentRequestContext,
  fn: () => Promise<T>,
): Promise<T> {
  return storage.run(context, fn);
}

export function getAgentRequestContext(): AgentRequestContext | null {
  return storage.getStore() ?? null;
}

export function resolveActiveProjectId(explicit?: unknown): string | null {
  if (typeof explicit === 'string' && explicit.trim()) return explicit.trim();
  const ctx = getAgentRequestContext();
  return ctx?.projectId?.trim() || ctx?.workflowId?.trim() || ctx?.sessionId?.trim() || null;
}
