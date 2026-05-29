import type {
  ModelConfig,
  NodeInput,
  NodeType,
  WorkflowEdge,
  WorkflowNode,
} from '@lumen/shared/domain';
import type { Collection, Db } from 'mongodb';

export const WORKFLOW_RUNS_COLLECTION = 'workflow_runs';
export const WORKFLOW_NODE_RESULTS_COLLECTION = 'workflow_node_results';

export type WorkflowRunStatus = 'running' | 'success' | 'failed';
export type WorkflowNodeRunStatus = 'queued' | 'running' | 'success' | 'error' | 'skipped';

export interface WorkflowRunSummary {
  queued: number;
  succeeded: number;
  failed: number;
  skipped: number;
}

export interface WorkflowGraphSnapshot {
  nodes: Array<{
    id: string;
    type: NodeType;
    position: { x: number; y: number };
    model: ModelConfig;
  }>;
  edges: WorkflowEdge[];
}

export interface WorkflowRunDocument {
  _id: string;
  project_id: string | null;
  status: WorkflowRunStatus;
  requested_node_ids: string[];
  node_ids: string[];
  node_count: number;
  edge_count: number;
  graph: WorkflowGraphSnapshot;
  summary: WorkflowRunSummary;
  error?: string;
  started_at: Date;
  completed_at?: Date;
  created_at: Date;
  updated_at: Date;
}

export interface WorkflowOutputAsset {
  storage: 'r2';
  key: string;
  url: string;
  content_type: string;
  size: number;
  original_url?: string;
  uploaded_at: Date;
}

export interface WorkflowNodeResultDocument {
  _id: string;
  run_id: string;
  project_id: string | null;
  node_id: string;
  node_type: NodeType;
  status: WorkflowNodeRunStatus;
  model: ModelConfig;
  input: NodeInput;
  output_type?: NodeType;
  output_value?: string;
  asset?: WorkflowOutputAsset;
  error?: string;
  started_at?: Date;
  completed_at?: Date;
  duration_ms?: number;
  created_at: Date;
  updated_at: Date;
}

export interface CreateRunInput {
  runId: string;
  projectId?: string | null;
  requestedNodeIds: string[];
  nodeIds: string[];
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export interface NodePersistenceInput {
  runId: string;
  projectId?: string | null;
  node: WorkflowNode;
  input: NodeInput;
}

export interface CompleteNodeInput extends NodePersistenceInput {
  outputType: NodeType;
  outputValue: string;
  asset?: WorkflowOutputAsset;
  startedAt?: Date;
}

export interface FailNodeInput extends NodePersistenceInput {
  error: string;
  startedAt?: Date;
}

export interface SkipNodeInput extends FailNodeInput {
  outputType?: NodeType;
  outputValue?: string;
  asset?: WorkflowOutputAsset;
}

export interface FinishRunInput {
  runId: string;
  status: WorkflowRunStatus;
  summary: WorkflowRunSummary;
  error?: string;
}

export class WorkflowStore {
  private readonly runs: Collection<WorkflowRunDocument>;
  private readonly nodeResults: Collection<WorkflowNodeResultDocument>;

  constructor(db: Db) {
    this.runs = db.collection<WorkflowRunDocument>(WORKFLOW_RUNS_COLLECTION);
    this.nodeResults = db.collection<WorkflowNodeResultDocument>(WORKFLOW_NODE_RESULTS_COLLECTION);
  }

  async ensureIndexes(): Promise<void> {
    await this.runs.createIndex({ project_id: 1, updated_at: -1 });
    await this.runs.createIndex({ status: 1, updated_at: -1 });
    await this.runs.createIndex({ created_at: -1 });

    await this.nodeResults.createIndex({ run_id: 1, node_id: 1 }, { unique: true });
    await this.nodeResults.createIndex({ project_id: 1, updated_at: -1 });
    await this.nodeResults.createIndex({ node_id: 1, updated_at: -1 });
    await this.nodeResults.createIndex({ status: 1, updated_at: -1 });
  }

  async createRun(input: CreateRunInput): Promise<void> {
    const now = new Date();
    const graph: WorkflowGraphSnapshot = {
      nodes: input.nodes.map((node) => ({
        id: node.id,
        type: node.type,
        position: node.position,
        model: node.model,
      })),
      edges: input.edges,
    };

    await this.runs.updateOne(
      { _id: input.runId },
      {
        $set: {
          project_id: input.projectId ?? null,
          status: 'running',
          requested_node_ids: input.requestedNodeIds,
          node_ids: input.nodeIds,
          node_count: input.nodes.length,
          edge_count: input.edges.length,
          graph,
          summary: { queued: input.nodeIds.length, succeeded: 0, failed: 0, skipped: 0 },
          started_at: now,
          updated_at: now,
        },
        $setOnInsert: {
          _id: input.runId,
          created_at: now,
        },
        $unset: {
          completed_at: '',
          error: '',
        },
      },
      { upsert: true },
    );
  }

  async markNodeQueued(input: NodePersistenceInput): Promise<void> {
    const now = new Date();
    await this.nodeResults.updateOne(
      { _id: resultId(input.runId, input.node.id) },
      {
        $set: {
          run_id: input.runId,
          project_id: input.projectId ?? null,
          node_id: input.node.id,
          node_type: input.node.type,
          status: 'queued',
          model: input.node.model,
          input: compactNodeInput(input.input),
          updated_at: now,
        },
        $setOnInsert: {
          _id: resultId(input.runId, input.node.id),
          created_at: now,
        },
        $unset: {
          error: '',
          output_type: '',
          output_value: '',
          asset: '',
          started_at: '',
          completed_at: '',
          duration_ms: '',
        },
      },
      { upsert: true },
    );
  }

  async markNodeStarted(input: NodePersistenceInput, startedAt = new Date()): Promise<void> {
    await this.nodeResults.updateOne(
      { _id: resultId(input.runId, input.node.id) },
      {
        $set: {
          run_id: input.runId,
          project_id: input.projectId ?? null,
          node_id: input.node.id,
          node_type: input.node.type,
          status: 'running',
          model: input.node.model,
          input: compactNodeInput(input.input),
          started_at: startedAt,
          updated_at: startedAt,
        },
        $setOnInsert: {
          _id: resultId(input.runId, input.node.id),
          created_at: startedAt,
        },
        $unset: {
          error: '',
          output_type: '',
          output_value: '',
          asset: '',
          completed_at: '',
          duration_ms: '',
        },
      },
      { upsert: true },
    );
  }

  async markNodeSucceeded(input: CompleteNodeInput): Promise<void> {
    const completedAt = new Date();
    await this.nodeResults.updateOne(
      { _id: resultId(input.runId, input.node.id) },
      {
        $set: {
          run_id: input.runId,
          project_id: input.projectId ?? null,
          node_id: input.node.id,
          node_type: input.node.type,
          status: 'success',
          model: input.node.model,
          input: compactNodeInput(input.input),
          output_type: input.outputType,
          output_value: input.outputValue,
          ...(input.asset ? { asset: input.asset } : {}),
          completed_at: completedAt,
          ...(input.startedAt
            ? { duration_ms: completedAt.getTime() - input.startedAt.getTime() }
            : {}),
          updated_at: completedAt,
        },
        $setOnInsert: {
          _id: resultId(input.runId, input.node.id),
          created_at: completedAt,
        },
        $unset: {
          error: '',
          ...(input.asset ? {} : { asset: '' }),
        },
      },
      { upsert: true },
    );
  }

  async markNodeFailed(input: FailNodeInput): Promise<void> {
    const completedAt = new Date();
    await this.nodeResults.updateOne(
      { _id: resultId(input.runId, input.node.id) },
      {
        $set: {
          run_id: input.runId,
          project_id: input.projectId ?? null,
          node_id: input.node.id,
          node_type: input.node.type,
          status: 'error',
          model: input.node.model,
          input: compactNodeInput(input.input),
          error: input.error,
          completed_at: completedAt,
          ...(input.startedAt
            ? { duration_ms: completedAt.getTime() - input.startedAt.getTime() }
            : {}),
          updated_at: completedAt,
        },
        $setOnInsert: {
          _id: resultId(input.runId, input.node.id),
          created_at: completedAt,
        },
      },
      { upsert: true },
    );
  }

  async markNodeSkipped(input: SkipNodeInput): Promise<void> {
    const completedAt = new Date();
    await this.nodeResults.updateOne(
      { _id: resultId(input.runId, input.node.id) },
      {
        $set: {
          run_id: input.runId,
          project_id: input.projectId ?? null,
          node_id: input.node.id,
          node_type: input.node.type,
          status: 'skipped',
          model: input.node.model,
          input: compactNodeInput(input.input),
          error: input.error,
          ...(input.outputType ? { output_type: input.outputType } : {}),
          ...(input.outputValue ? { output_value: input.outputValue } : {}),
          ...(input.asset ? { asset: input.asset } : {}),
          completed_at: completedAt,
          updated_at: completedAt,
        },
        $setOnInsert: {
          _id: resultId(input.runId, input.node.id),
          created_at: completedAt,
        },
      },
      { upsert: true },
    );
  }

  async finishRun(input: FinishRunInput): Promise<void> {
    const now = new Date();
    const set = {
      status: input.status,
      summary: input.summary,
      completed_at: now,
      updated_at: now,
      ...(input.error ? { error: input.error } : {}),
    };
    const update = input.error ? { $set: set } : { $set: set, $unset: { error: '' as const } };

    await this.runs.updateOne({ _id: input.runId }, update);
  }
}

function resultId(runId: string, nodeId: string) {
  return `${runId}:${nodeId}`;
}

function compactNodeInput(input: NodeInput): NodeInput {
  return {
    prompt: input.prompt,
    image: compactMediaRef(input.image),
    video: compactMediaRef(input.video),
  };
}

function compactMediaRef(value: string | null): string | null {
  if (!value?.startsWith('data:')) return value;
  const header = value.slice(0, value.indexOf(','));
  const bytes = Buffer.byteLength(value);
  return `${header},[inline data omitted: ${bytes} bytes]`;
}
