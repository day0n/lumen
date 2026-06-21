import 'server-only';

import type { ProjectCanvas, WorkflowNodeResultSnapshot } from '@lumen/db';
import type { PublicErrorFields } from '@lumen/shared/domain';

import { getMaterialAssetRepository } from './db';

type CanvasNodeData = Record<string, unknown>;

const BUSY_STATUSES = new Set(['queued', 'running']);
const PUBLIC_ERROR_FIELD_KEYS = [
  'errorCode',
  'errorName',
  'errorI18nKey',
  'retryable',
  'attempts',
] as const;

export async function reconcileCanvasWithWorkflowResults(
  projectId: string,
  canvas: ProjectCanvas,
): Promise<ProjectCanvas> {
  const nodeIds = canvas.nodes
    .filter((node) => shouldReconcileNode(readStatus(node.data), readOutput(node.data)))
    .map((node) => node.id);

  if (nodeIds.length === 0) return canvas;

  const repository = await getMaterialAssetRepository();
  const results = await repository.getLatestNodeResultsForProject(projectId, nodeIds);
  if (results.length === 0) return canvas;

  const resultByNodeId = new Map(results.map((result) => [result.nodeId, result]));
  let changed = false;

  const nodes = canvas.nodes.map((node) => {
    const result = resultByNodeId.get(node.id);
    if (!result) return node;

    const data = applyTerminalWorkflowResult(node.data, result);
    if (data === node.data) return node;

    changed = true;
    return { ...node, data };
  });

  return changed ? { ...canvas, nodes } : canvas;
}

function shouldReconcileNode(status: string | undefined, output: string | null) {
  if (BUSY_STATUSES.has(status ?? 'idle')) return true;
  if (status === 'success' && !output?.trim()) return true;
  return false;
}

function applyTerminalWorkflowResult(
  current: CanvasNodeData,
  result: WorkflowNodeResultSnapshot,
): CanvasNodeData {
  switch (result.status) {
    case 'success': {
      if (!result.output?.trim()) return current;
      const next = {
        ...withoutPublicErrorFields(current),
        status: 'success' as const,
        output: result.output,
        error: null,
        activeRunId: null,
        progress: 1,
      };
      return next;
    }
    case 'error':
    case 'failed':
    case 'skipped':
      return {
        ...current,
        status: 'error',
        output: null,
        error: result.error ?? 'Workflow node failed',
        activeRunId: null,
        ...publicErrorFields(result),
        progress: 1,
      };
    case 'cancelled':
      return {
        ...current,
        status: 'cancelled',
        error: result.error ?? 'cancelled',
        activeRunId: null,
        ...publicErrorFields(result),
        progress: 0,
      };
    default:
      return current;
  }
}

function readStatus(data: CanvasNodeData): string | undefined {
  return typeof data.status === 'string' ? data.status : undefined;
}

function readOutput(data: CanvasNodeData): string | null {
  return typeof data.output === 'string' ? data.output : null;
}

function withoutPublicErrorFields(data: CanvasNodeData): CanvasNodeData {
  const omitted = new Set<string>(PUBLIC_ERROR_FIELD_KEYS);
  return Object.fromEntries(Object.entries(data).filter(([key]) => !omitted.has(key)));
}

function publicErrorFields(result: WorkflowNodeResultSnapshot): PublicErrorFields {
  return {
    ...(result.errorCode !== undefined ? { errorCode: result.errorCode } : {}),
    ...(result.errorName ? { errorName: result.errorName as PublicErrorFields['errorName'] } : {}),
    ...(result.errorI18nKey ? { errorI18nKey: result.errorI18nKey } : {}),
    ...(result.retryable !== undefined ? { retryable: result.retryable } : {}),
    ...(result.attempts !== undefined ? { attempts: result.attempts } : {}),
  };
}
