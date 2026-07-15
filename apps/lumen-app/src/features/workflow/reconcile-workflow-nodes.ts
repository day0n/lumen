import type { NodeStatus, PublicErrorFields } from '@lumen/shared/domain';

export interface WorkflowNodeResultPayload extends PublicErrorFields {
  nodeId: string;
  runId: string;
  status: string;
  output: string | null;
  error: string | null;
  progress: number;
  updatedAt: string;
}

export interface ReconcileNodeState extends PublicErrorFields {
  status: NodeStatus;
  output: string | null;
  error: string | null;
  activeRunId?: string | null;
  progress: number;
}

export function readWorkflowStatusResults(payload: unknown): WorkflowNodeResultPayload[] {
  if (!isRecord(payload) || payload.ok !== true || !isRecord(payload.data)) return [];
  const { results } = payload.data;
  if (!Array.isArray(results)) return [];
  return results
    .map(parseWorkflowNodeResultPayload)
    .filter((result): result is WorkflowNodeResultPayload => result !== null);
}

const TERMINAL_CANVAS_STATUSES = new Set<NodeStatus>(['success', 'error', 'cancelled']);
const BUSY_CANVAS_STATUSES = new Set<NodeStatus>(['queued', 'running']);

export function shouldReconcileWorkflowNode(
  nodeId: string,
  canvasStatus: NodeStatus | undefined,
  canvasOutput: string | null | undefined,
): boolean {
  if (!nodeId) return false;
  if (BUSY_CANVAS_STATUSES.has(canvasStatus ?? 'idle')) return true;
  if (canvasStatus === 'success' && !canvasOutput?.trim()) return true;
  return false;
}

export function mapWorkflowResultToNodeState(
  result: WorkflowNodeResultPayload,
): ReconcileNodeState | null {
  const status = normalizeWorkflowResultStatus(result.status);
  if (!status) return null;

  return {
    status,
    output: status === 'success' ? result.output : null,
    error: status === 'error' || status === 'cancelled' ? result.error : null,
    activeRunId: status === 'queued' || status === 'running' ? result.runId : null,
    errorCode: result.errorCode,
    errorName: result.errorName,
    errorI18nKey: result.errorI18nKey,
    retryable: result.retryable,
    attempts: result.attempts,
    progress: status === 'success' ? 1 : status === 'running' ? result.progress || 0.45 : 0,
  };
}

export function shouldApplyWorkflowReconcile(
  current: ReconcileNodeState,
  incoming: ReconcileNodeState,
): boolean {
  if (
    TERMINAL_CANVAS_STATUSES.has(current.status) &&
    current.status === 'success' &&
    current.output
  ) {
    return false;
  }
  if (TERMINAL_CANVAS_STATUSES.has(current.status) && incoming.status === 'running') {
    return false;
  }
  if (
    current.status === incoming.status &&
    current.output === incoming.output &&
    current.error === incoming.error
  ) {
    return false;
  }
  if (TERMINAL_CANVAS_STATUSES.has(incoming.status)) return true;
  if (BUSY_CANVAS_STATUSES.has(current.status) && incoming.status !== current.status) return true;
  if (incoming.status === 'running' && BUSY_CANVAS_STATUSES.has(current.status)) return true;
  return false;
}

function normalizeWorkflowResultStatus(status: string): NodeStatus | null {
  switch (status) {
    case 'queued':
      return 'queued';
    case 'running':
      return 'running';
    case 'success':
      return 'success';
    case 'error':
    case 'failed':
      return 'error';
    case 'cancelled':
      return 'cancelled';
    case 'skipped':
      return 'error';
    default:
      return null;
  }
}

function parseWorkflowNodeResultPayload(value: unknown): WorkflowNodeResultPayload | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.nodeId !== 'string' ||
    typeof value.runId !== 'string' ||
    typeof value.status !== 'string' ||
    (typeof value.output !== 'string' && value.output !== null) ||
    (typeof value.error !== 'string' && value.error !== null) ||
    typeof value.progress !== 'number' ||
    !Number.isFinite(value.progress) ||
    typeof value.updatedAt !== 'string'
  ) {
    return null;
  }

  return {
    nodeId: value.nodeId,
    runId: value.runId,
    status: value.status,
    output: value.output,
    error: value.error,
    progress: value.progress,
    updatedAt: value.updatedAt,
    ...(typeof value.errorCode === 'number' && Number.isInteger(value.errorCode)
      ? { errorCode: value.errorCode }
      : {}),
    ...(isPublicErrorName(value.errorName) ? { errorName: value.errorName } : {}),
    ...(typeof value.errorI18nKey === 'string' ? { errorI18nKey: value.errorI18nKey } : {}),
    ...(typeof value.retryable === 'boolean' ? { retryable: value.retryable } : {}),
    ...(typeof value.attempts === 'number' && Number.isInteger(value.attempts) && value.attempts > 0
      ? { attempts: value.attempts }
      : {}),
  };
}

function isPublicErrorName(value: unknown): value is NonNullable<PublicErrorFields['errorName']> {
  return (
    value === 'content_blocked' ||
    value === 'real_person_detected' ||
    value === 'model_execution_failed'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
