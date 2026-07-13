import type { Db } from 'mongodb';

export const WORKFLOW_NODE_RESULTS_COLLECTION = 'workflow_node_results';

export interface WorkflowNodeResultSnapshot {
  nodeId: string;
  runId: string;
  status: string;
  output: string | null;
  error: string | null;
  errorCode?: number;
  errorName?: string;
  errorI18nKey?: string;
  retryable?: boolean;
  attempts?: number;
  progress: number;
  updatedAt: string;
}

export interface WorkflowNodeResultDocument {
  _id: string;
  run_id: string;
  project_id?: string | null;
  workflow_id?: string | null;
  user_id?: string | null;
  node_id: string;
  node_type?: string;
  status: string;
  input?: Record<string, unknown>;
  output_type?: string;
  output_value?: string;
  error?: string;
  error_code?: number;
  error_name?: string;
  error_i18n_key?: string;
  retryable?: boolean;
  attempts?: number;
  asset?: {
    key?: string;
    url?: string;
    content_type?: string;
    size?: number;
    uploaded_at?: Date;
  };
  created_at?: Date;
  updated_at?: Date;
  completed_at?: Date;
}

export class WorkflowNodeResultRepository {
  constructor(private readonly db: Db) {}

  async ensureIndexes(): Promise<void> {
    const collection = this.collection();
    await collection.createIndex({
      project_id: 1,
      status: 1,
      output_type: 1,
      completed_at: -1,
    });
    await collection.createIndex({
      workflow_id: 1,
      status: 1,
      output_type: 1,
      completed_at: -1,
    });
    await collection.createIndex({
      user_id: 1,
      project_id: 1,
      status: 1,
      output_type: 1,
      completed_at: -1,
    });
    await collection.createIndex({
      user_id: 1,
      workflow_id: 1,
      status: 1,
      output_type: 1,
      completed_at: -1,
    });
  }

  async getLatestNodeResultsForProject(
    projectId: string,
    nodeIds: string[],
  ): Promise<WorkflowNodeResultSnapshot[]> {
    const ids = [...new Set(nodeIds.map((id) => id.trim()).filter(Boolean))];
    if (ids.length === 0) return [];

    const documents = await this.collection()
      .aggregate<{ doc: WorkflowNodeResultDocument }>([
        {
          $match: {
            node_id: { $in: ids },
            $or: [{ project_id: projectId }, { workflow_id: projectId }],
          },
        },
        {
          $project: {
            node_id: 1,
            run_id: 1,
            status: 1,
            output_value: 1,
            asset: 1,
            error: 1,
            error_code: 1,
            error_name: 1,
            error_i18n_key: 1,
            retryable: 1,
            attempts: 1,
            created_at: 1,
            updated_at: 1,
            completed_at: 1,
          },
        },
        { $sort: { updated_at: -1, completed_at: -1, created_at: -1 } },
        {
          $group: {
            _id: '$node_id',
            doc: { $first: '$$ROOT' },
          },
        },
      ])
      .toArray();

    return documents
      .map((entry) => toWorkflowNodeResultSnapshot(entry.doc))
      .filter((entry): entry is WorkflowNodeResultSnapshot => Boolean(entry));
  }

  private collection() {
    return this.db.collection<WorkflowNodeResultDocument>(WORKFLOW_NODE_RESULTS_COLLECTION);
  }
}

function toWorkflowNodeResultSnapshot(
  document: WorkflowNodeResultDocument,
): WorkflowNodeResultSnapshot | null {
  const nodeId = normalizedString(document.node_id);
  const runId = normalizedString(document.run_id);
  if (!nodeId || !runId) return null;

  const status = normalizedString(document.status) ?? 'idle';
  const output =
    normalizedString(document.asset?.url) ?? normalizedString(document.output_value) ?? null;
  const error = normalizedString(document.error) ?? null;
  const updatedAt = (
    document.updated_at ??
    document.completed_at ??
    document.created_at ??
    new Date()
  ).toISOString();

  return {
    nodeId,
    runId,
    status,
    output,
    error,
    ...(typeof document.error_code === 'number' ? { errorCode: document.error_code } : {}),
    ...(normalizedString(document.error_name) ? { errorName: document.error_name } : {}),
    ...(normalizedString(document.error_i18n_key) ? { errorI18nKey: document.error_i18n_key } : {}),
    ...(typeof document.retryable === 'boolean' ? { retryable: document.retryable } : {}),
    ...(typeof document.attempts === 'number' ? { attempts: document.attempts } : {}),
    progress: status === 'success' ? 1 : status === 'running' ? 0.45 : 0,
    updatedAt,
  };
}

function normalizedString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}
