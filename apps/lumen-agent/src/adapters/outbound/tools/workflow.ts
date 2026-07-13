import {
  type LumenCanvas,
  WorkflowEditInputSchema,
  WorkflowNodeRunInputSchema,
  normalizeWorkflowCanvas,
  validateWorkflowCanvas,
} from '@lumen/shared/domain';

import {
  getAgentRequestContext,
  resolveActiveProjectId,
} from '../../../application/requestContext.js';
import { WorkflowEngineClient } from '../canvas/engineClient.js';
import {
  ProjectWorkflowStore,
  type WorkflowProject,
  createAgentProjectCacheInvalidator,
} from '../canvas/projectStore.js';
import { getStudioMongo } from '../persistence/mongo.js';
import { getRedis } from '../persistence/redis.js';
import { type JsonSchema, Tool } from './base.js';
import { emitToolEvent } from './runtime.js';

async function getWorkflowStore(): Promise<ProjectWorkflowStore> {
  const redis = getRedis();
  const projectCache = redis ? createAgentProjectCacheInvalidator(redis) : undefined;
  return new ProjectWorkflowStore(await getStudioMongo(), projectCache);
}

async function loadProject(args: Record<string, unknown>): Promise<{
  store: ProjectWorkflowStore;
  project: WorkflowProject;
  projectId: string;
  userId: string;
}> {
  const ctx = getAgentRequestContext();
  const userId = ctx?.userId;
  if (!userId) throw new Error('Agent request context is missing user_id.');

  const projectId = resolveActiveProjectId(args.project_id);
  if (!projectId) {
    throw new Error('project_id is required. Open a canvas project before using workflow tools.');
  }

  const store = await getWorkflowStore();
  const project = await store.getProject(userId, projectId);
  if (!project) throw new Error(`project not found or not accessible: ${projectId}`);

  return { store, project, projectId, userId };
}

function formatEditSummary(summary: {
  nodeCount: number;
  edgeCount: number;
  addedNodes: number;
  removedNodes: number;
  changedNodes: number;
  addedEdges: number;
  removedEdges: number;
}): string {
  return [
    `${summary.nodeCount} nodes`,
    `${summary.edgeCount} edges`,
    `+${summary.addedNodes}/-${summary.removedNodes} nodes`,
    `${summary.changedNodes} changed nodes`,
    `+${summary.addedEdges}/-${summary.removedEdges} edges`,
  ].join(', ');
}

function destructiveEditReason(before: LumenCanvas, after: LumenCanvas): string | null {
  if (before.nodes.length < 5) return null;
  const beforeIds = new Set(before.nodes.map((node) => node.id));
  const afterIds = new Set(after.nodes.map((node) => node.id));
  const removed = [...beforeIds].filter((id) => !afterIds.has(id)).length;
  const retained = [...beforeIds].filter((id) => afterIds.has(id)).length;
  const removedRatio = removed / Math.max(1, before.nodes.length);

  if (removed >= 3 && removedRatio >= 0.35) {
    return `this edit removes ${removed}/${before.nodes.length} existing nodes`;
  }
  if (before.nodes.length >= 8 && retained / before.nodes.length < 0.5) {
    return `this edit replaces most existing node ids (${retained}/${before.nodes.length} retained)`;
  }
  return null;
}

function workflowEventSummary(project: WorkflowProject, reason: string) {
  return {
    project_id: project.id,
    reason,
    node_count: project.canvas.nodes.length,
    edge_count: project.canvas.edges.length,
  };
}

const RUNNABLE_MODEL_OVERRIDES = {
  text: {
    'doubao-seed-2.0-pro': 'gemini-3.5-flash',
  },
  image: {
    'doubao-seedream-3.0': 'nano-banana2',
  },
  video: {},
  audio: {
    'doubao-tts': 'fish-tts',
  },
  composition: {},
} as const;

// TODO(temp-force-veo): 临时规则——agent 写画布时，任何 video 节点都强制改成 veo-3.1。
// 与 apps/lumen-agent/src/agents/main/prompt.md 中同名 TODO 配对。
// 删除条件：产品决定放开 agent 视频选型时，把本常量、下方 enforceRunnableModels 里
// 引用它的 video 分支，以及 prompt.md 里的临时规则一起删掉。
const TEMP_FORCE_VIDEO_MODEL = 'veo-3.1';

function enforceRunnableModels(canvas: LumenCanvas): {
  canvas: LumenCanvas;
  overrides: Array<{ node_id: string; from: string; to: string }>;
} {
  const overrides: Array<{ node_id: string; from: string; to: string }> = [];
  const nodes = canvas.nodes.map((node) => {
    const modelId = node.data.modelId?.trim();

    // TODO(temp-force-veo): video 节点统一锁到 veo-3.1，无视 agent 传入的 modelId（含空值）。
    if (node.data.kind === 'video' && modelId !== TEMP_FORCE_VIDEO_MODEL) {
      overrides.push({
        node_id: node.id,
        from: modelId || '(unset)',
        to: TEMP_FORCE_VIDEO_MODEL,
      });
      return {
        ...node,
        data: {
          ...node.data,
          modelId: TEMP_FORCE_VIDEO_MODEL,
        },
      };
    }

    const replacement =
      modelId &&
      RUNNABLE_MODEL_OVERRIDES[node.data.kind][
        modelId as keyof (typeof RUNNABLE_MODEL_OVERRIDES)[typeof node.data.kind]
      ];
    if (!replacement) return node;
    overrides.push({ node_id: node.id, from: modelId, to: replacement });
    return {
      ...node,
      data: {
        ...node.data,
        modelId: replacement,
      },
    };
  });

  return {
    canvas: overrides.length > 0 ? { ...canvas, nodes } : canvas,
    overrides,
  };
}

export class GetWorkflowTool extends Tool {
  override readonly name = 'read_canvas';
  override readonly timeoutSeconds = 20;
  override readonly description =
    'Read the current Lumen Studio workflow canvas JSON for the active project.';

  override readonly parameters: JsonSchema = {
    type: 'object',
    properties: {
      project_id: {
        type: 'string',
        description: 'Canvas project id. Optional when the Agent request context has project_id.',
      },
    },
  };

  override async execute(args: Record<string, unknown>): Promise<string> {
    const { project } = await loadProject(args);
    return JSON.stringify({
      project_id: project.id,
      title: project.title,
      updated_at: project.updatedAt.toISOString(),
      node_count: project.canvas.nodes.length,
      edge_count: project.canvas.edges.length,
      canvas: project.canvas,
    });
  }
}

export class EditWorkflowTool extends Tool {
  override readonly name = 'write_canvas';
  override readonly timeoutSeconds = 45;
  override readonly description =
    'Replace the active project workflow with a complete validated canvas JSON, then notify Studio to refresh the canvas.';

  override readonly parameters: JsonSchema = {
    type: 'object',
    properties: {
      project_id: {
        type: 'string',
        description: 'Canvas project id. Optional when the Agent request context has project_id.',
      },
      title: {
        type: 'string',
        description: 'Optional project title update.',
      },
      canvas: {
        type: 'object',
        description:
          'Complete Lumen canvas JSON: { nodes: [...], edges: [...], viewport?: {...} }.',
      },
      allow_destructive_replace: {
        type: 'boolean',
        description: 'Set true only when the user explicitly asked to replace/delete most nodes.',
        default: false,
      },
      intent: {
        type: 'string',
        description: 'Short reason for this workflow edit.',
      },
    },
    required: ['canvas'],
  };

  override async execute(args: Record<string, unknown>): Promise<string> {
    const parsed = WorkflowEditInputSchema.parse(args);
    const { store, project, projectId, userId } = await loadProject(parsed);
    const normalizedCanvas = normalizeWorkflowCanvas(parsed.canvas);
    const { canvas, overrides } = enforceRunnableModels(normalizedCanvas);
    const validationErrors = validateWorkflowCanvas(canvas);
    if (validationErrors.length > 0) {
      return `Error: workflow canvas is invalid: ${validationErrors.join('; ')}`;
    }

    const destructiveReason = destructiveEditReason(project.canvas, canvas);
    if (destructiveReason && !parsed.allow_destructive_replace) {
      return `Error: refusing destructive workflow edit because ${destructiveReason}. Preserve existing nodes or set allow_destructive_replace=true only if the user explicitly requested replacement.`;
    }

    const update = await store.updateCanvas({
      userId,
      projectId,
      canvas,
      title: parsed.title,
    });
    if (!update) throw new Error(`project not found or not accessible: ${projectId}`);

    await emitToolEvent('workflow_update', {
      ...workflowEventSummary(update.project, 'write_canvas'),
      intent: parsed.intent ?? null,
      summary: update.summary,
      model_overrides: overrides,
    });

    return JSON.stringify({
      ok: true,
      project_id: update.project.id,
      title: update.project.title,
      summary: update.summary,
      model_overrides: overrides,
      refetch_required: true,
      message: `Workflow saved: ${formatEditSummary(update.summary)}.`,
    });
  }
}

export class RunWorkflowNodeTool extends Tool {
  override readonly name = 'run_canvas_node';
  override readonly timeoutSeconds = 10 * 60 + 30;
  override readonly description =
    'Run exactly one workflow node per call through the Lumen engine and save its output back to the canvas. UPSTREAM PRECONDITION: a node can only be run after EVERY upstream node connected to it has status=success with a non-null output — running a node whose upstream is still idle/queued/running/error will fail with an `upstream outputs are missing` error. This applies to ALL kinds (text/image/video/audio/composition), not just composition. Plan execution in topological order: only the nodes whose upstream chain is fully resolved are runnable right now. Independent sibling nodes (no edge between them, and both have their own upstream resolved) CAN be launched in parallel by emitting multiple parallel calls to this tool in the same turn — but never schedule a downstream node concurrently with its upstream. For composition nodes, additionally settings.timeline must be valid.';

  override readonly parameters: JsonSchema = {
    type: 'object',
    properties: {
      project_id: {
        type: 'string',
        description: 'Canvas project id. Optional when the Agent request context has project_id.',
      },
      node_id: {
        type: 'string',
        description: 'Single node id to execute. The tool never runs more than one node per call.',
      },
    },
    required: ['node_id'],
  };

  override async execute(args: Record<string, unknown>): Promise<string> {
    const parsed = WorkflowNodeRunInputSchema.parse(args);
    const { store, project, userId } = await loadProject(parsed);
    const engine = new WorkflowEngineClient(getRedis(), store);
    const result = await engine.runSingleNode({
      project,
      userId,
      nodeId: parsed.node_id,
    });

    return JSON.stringify({
      ok: true,
      project_id: result.project.id,
      run_id: result.runId,
      node_id: result.node.id,
      node_title: result.node.data.title,
      node_kind: result.node.data.kind,
      output: result.output,
      refetch_required: true,
    });
  }
}
