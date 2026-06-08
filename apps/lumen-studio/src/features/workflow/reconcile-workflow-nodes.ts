import type { NodeStatus } from '@lumen/shared/domain';

export interface WorkflowNodeResultPayload {
  nodeId: string;
  runId: string;
  status: string;
  output: string | null;
  error: string | null;
  progress: number;
  updatedAt: string;
}

export interface ReconcileNodeState {
  status: NodeStatus;
  output: string | null;
  error: string | null;
  progress: number;
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
    progress: status === 'success' ? 1 : status === 'running' ? result.progress || 0.45 : 0,
  };
}

export function shouldApplyWorkflowReconcile(
  current: ReconcileNodeState,
  incoming: ReconcileNodeState,
): boolean {
  if (TERMINAL_CANVAS_STATUSES.has(current.status) && current.status === 'success' && current.output) {
    return false;
  }
  if (TERMINAL_CANVAS_STATUSES.has(current.status) && incoming.status === 'running') {
    return false;
  }
  if (current.status === incoming.status && current.output === incoming.output && current.error === incoming.error) {
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
