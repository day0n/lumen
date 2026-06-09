import type Redis from 'ioredis';
import { nanoid } from 'nanoid';

import {
  type LumenCanvas,
  type LumenCanvasNode,
  type LumenCanvasNodeData,
  type NodeInput,
  type PublicErrorFields,
  type WorkflowEdge,
  type WorkflowNode,
  canvasEdgesToWorkflowEdges,
  canvasNodeToWorkflowNodeWithContext,
  computeSingleNodeInput,
  updateCanvasNodeData,
} from '@lumen/shared/domain';
import type { ClientRunMessage, ServerEvent } from '@lumen/shared/protocols';

import { getConfig } from '../../../bootstrap/config.js';
import { logger } from '../../../platform/logger.js';
import { emitToolEvent } from '../tools/runtime.js';
import type { ProjectWorkflowStore, WorkflowProject } from './projectStore.js';

export interface RunWorkflowNodeResult {
  runId: string;
  project: WorkflowProject;
  node: LumenCanvasNode;
  output: string;
}

class WorkflowNodeCancelledError extends Error {
  constructor(message = 'cancelled by user') {
    super(message);
    this.name = 'WorkflowNodeCancelledError';
  }
}

class WorkflowNodeExecutionError extends Error implements PublicErrorFields {
  readonly displayMessage: string;
  readonly errorCode?: number;
  readonly errorName?: PublicErrorFields['errorName'];
  readonly errorI18nKey?: string;
  readonly retryable?: boolean;
  readonly attempts?: number;

  constructor(event: Extract<ServerEvent, { event: 'node:error' }>) {
    super(formatAgentWorkflowError(event));
    this.name = 'WorkflowNodeExecutionError';
    this.displayMessage = event.error;
    this.errorCode = event.errorCode;
    this.errorName = event.errorName;
    this.errorI18nKey = event.errorI18nKey;
    this.retryable = event.retryable;
    this.attempts = event.attempts;
  }
}

export class WorkflowEngineClient {
  constructor(
    private readonly redis: Redis | null,
    private readonly store: ProjectWorkflowStore,
  ) {}

  async runSingleNode(input: {
    project: WorkflowProject;
    userId: string;
    nodeId: string;
  }): Promise<RunWorkflowNodeResult> {
    if (!this.redis) {
      throw new Error('REDIS_URL is required to run workflow nodes.');
    }

    const target = input.project.canvas.nodes.find((node) => node.id === input.nodeId);
    if (!target) throw new Error(`node not found: ${input.nodeId}`);

    const { input: resolvedInput, missingInputs } = computeSingleNodeInput(
      input.project.canvas,
      input.nodeId,
    );
    if (missingInputs.length > 0) {
      throw new Error(
        `Cannot run node '${input.nodeId}' because upstream outputs are missing: ${missingInputs.join(
          ', ',
        )}`,
      );
    }

    const { nodes: workflowNodes, edges: workflowEdges } = buildSingleNodeRunPayload(
      input.project.canvas,
      target,
      resolvedInput,
    );
    const runId = nanoid(16);
    const channelId = `flow:events:agent:${runId}:${nanoid(8)}`;

    await this.updateNodeState(input.project, target.id, {
      status: 'queued',
      error: null,
      errorCode: undefined,
      errorName: undefined,
      errorI18nKey: undefined,
      retryable: undefined,
      attempts: undefined,
      progress: 0,
    });
    await emitToolEvent('workflow_node_status', {
      project_id: input.project.id,
      node_id: target.id,
      node_title: target.data.title,
      node_kind: target.data.kind,
      run_id: runId,
      status: 'queued',
      progress: 0,
    });

    let output: string;
    try {
      output = await this.publishAndWait({
        channelId,
        runId,
        userId: input.userId,
        projectId: input.project.id,
        nodeId: target.id,
        nodeTitle: target.data.title,
        nodeKind: target.data.kind,
        nodes: workflowNodes,
        edges: workflowEdges,
      });
    } catch (err) {
      const message = workflowErrorDisplayMessage(err);
      const cancelled = err instanceof WorkflowNodeCancelledError;
      const errorCanvas = updateCanvasNodeData(input.project.canvas, target.id, {
        status: cancelled ? 'cancelled' : 'error',
        error: message,
        ...workflowErrorFields(err),
        progress: 1,
      });
      await this.store.updateCanvas({
        userId: input.userId,
        projectId: input.project.id,
        canvas: errorCanvas,
      });
      await emitToolEvent('workflow_update', {
        project_id: input.project.id,
        reason: cancelled ? 'run_canvas_node_cancelled' : 'run_canvas_node_error',
        node_id: target.id,
        node_title: target.data.title,
        node_kind: target.data.kind,
        run_id: runId,
        node_count: errorCanvas.nodes.length,
        edge_count: errorCanvas.edges.length,
        ...workflowErrorEventFields(err),
      });
      throw err;
    }

    const nextCanvas = updateCanvasNodeData(input.project.canvas, target.id, {
      status: 'success',
      output,
      error: null,
      errorCode: undefined,
      errorName: undefined,
      errorI18nKey: undefined,
      retryable: undefined,
      attempts: undefined,
      progress: 1,
    });
    const update = await this.store.updateCanvas({
      userId: input.userId,
      projectId: input.project.id,
      canvas: nextCanvas,
    });
    if (!update) throw new Error('project disappeared while saving workflow result');

    await emitToolEvent('workflow_update', {
      project_id: input.project.id,
      reason: 'run_canvas_node',
      node_id: target.id,
      node_title: target.data.title,
      node_kind: target.data.kind,
      run_id: runId,
      node_count: nextCanvas.nodes.length,
      edge_count: nextCanvas.edges.length,
    });

    const savedNode = update.project.canvas.nodes.find((node) => node.id === target.id) ?? target;
    return {
      runId,
      project: update.project,
      node: savedNode,
      output,
    };
  }

  private async updateNodeState(
    project: WorkflowProject,
    nodeId: string,
    patch: Partial<LumenCanvasNodeData>,
  ): Promise<void> {
    const canvas = updateCanvasNodeData(project.canvas, nodeId, patch);
    await this.store.updateCanvas({
      userId: project.ownerId,
      projectId: project.id,
      canvas,
      recordHistory: false,
    });
  }

  private async publishAndWait(input: {
    channelId: string;
    runId: string;
    userId: string;
    projectId: string;
    nodeId: string;
    nodeTitle: string;
    nodeKind: string;
    nodes: WorkflowNode[];
    edges: WorkflowEdge[];
  }): Promise<string> {
    const subscriber = this.redis!.duplicate({ maxRetriesPerRequest: null });
    const cfg = getConfig();
    let settled = false;

    try {
      await subscriber.subscribe(input.channelId);
      const waitForResult = new Promise<string>((resolve, reject) => {
        const timer = setTimeout(
          () => {
            if (settled) return;
            settled = true;
            reject(new Error(`workflow node timed out: ${input.nodeId}`));
          },
          10 * 60 * 1000,
        );

        subscriber.on('message', (_channel, raw) => {
          if (settled) return;
          try {
            const event = JSON.parse(raw) as ServerEvent;
            void this.handleEngineEvent(input.projectId, input.runId, event, {
              nodeTitle: input.nodeTitle,
              nodeKind: input.nodeKind,
            });
            if (event.event === 'node:done' && event.nodeId === input.nodeId) {
              settled = true;
              clearTimeout(timer);
              resolve(event.output);
            }
            if (event.event === 'node:error' && event.nodeId === input.nodeId) {
              settled = true;
              clearTimeout(timer);
              reject(new WorkflowNodeExecutionError(event));
            }
            if (event.event === 'node:cancel' && event.nodeId === input.nodeId) {
              settled = true;
              clearTimeout(timer);
              reject(new WorkflowNodeCancelledError(event.reason));
            }
            if (event.event === 'flow:cancel') {
              settled = true;
              clearTimeout(timer);
              reject(new WorkflowNodeCancelledError(event.reason));
            }
          } catch (err) {
            settled = true;
            clearTimeout(timer);
            reject(err instanceof Error ? err : new Error(String(err)));
          }
        });
      });

      const message: ClientRunMessage = {
        action: 'run',
        runId: input.runId,
        projectId: input.projectId,
        workflowId: input.projectId,
        userId: input.userId,
        nodeIds: [input.nodeId],
        nodes: input.nodes,
        edges: input.edges,
      };

      await emitToolEvent('workflow_node_status', {
        project_id: input.projectId,
        node_id: input.nodeId,
        node_title: input.nodeTitle,
        node_kind: input.nodeKind,
        run_id: input.runId,
        status: 'queued',
        progress: 0,
      });

      await this.redis!.xadd(
        cfg.WORKFLOW_STREAM_KEY,
        '*',
        'channelId',
        input.channelId,
        'payload',
        JSON.stringify(message),
        'sentryTrace',
        '',
        'baggage',
        '',
      );

      return await waitForResult;
    } finally {
      try {
        await subscriber.unsubscribe(input.channelId);
        await subscriber.quit();
      } catch (err) {
        logger.warn({ err }, 'failed to close workflow event subscriber');
      }
    }
  }

  private async handleEngineEvent(
    projectId: string,
    runId: string,
    event: ServerEvent,
    nodeMeta: { nodeTitle: string; nodeKind: string },
  ): Promise<void> {
    switch (event.event) {
      case 'node:queued':
        await emitToolEvent('workflow_node_status', {
          project_id: projectId,
          run_id: runId,
          node_id: event.nodeId,
          node_title: nodeMeta.nodeTitle,
          node_kind: nodeMeta.nodeKind,
          status: 'queued',
          progress: 0,
        });
        break;
      case 'node:start':
        await emitToolEvent('workflow_node_status', {
          project_id: projectId,
          run_id: runId,
          node_id: event.nodeId,
          node_title: nodeMeta.nodeTitle,
          node_kind: nodeMeta.nodeKind,
          status: 'running',
          progress: 0.35,
        });
        break;
      case 'node:progress':
        await emitToolEvent('workflow_node_status', {
          project_id: projectId,
          run_id: runId,
          node_id: event.nodeId,
          node_title: nodeMeta.nodeTitle,
          node_kind: nodeMeta.nodeKind,
          status: 'running',
          progress: event.progress,
        });
        break;
      case 'node:done':
        await emitToolEvent('workflow_node_status', {
          project_id: projectId,
          run_id: runId,
          node_id: event.nodeId,
          node_title: nodeMeta.nodeTitle,
          node_kind: nodeMeta.nodeKind,
          status: 'success',
          progress: 1,
          output: event.output,
        });
        break;
      case 'node:error':
        await emitToolEvent('workflow_node_status', {
          project_id: projectId,
          run_id: runId,
          node_id: event.nodeId,
          node_title: nodeMeta.nodeTitle,
          node_kind: nodeMeta.nodeKind,
          status: 'error',
          error: event.error,
          ...toSnakePublicErrorFields(event),
        });
        break;
      case 'node:cancel':
        await emitToolEvent('workflow_node_status', {
          project_id: projectId,
          run_id: runId,
          node_id: event.nodeId,
          node_title: nodeMeta.nodeTitle,
          node_kind: nodeMeta.nodeKind,
          status: 'cancelled',
          error: event.reason,
        });
        break;
      case 'flow:done':
        await emitToolEvent('workflow_completed', {
          project_id: projectId,
          run_id: runId,
        });
        break;
      case 'flow:cancel':
        await emitToolEvent('workflow_completed', {
          project_id: projectId,
          run_id: runId,
          status: 'cancelled',
          error: event.reason,
        });
        break;
    }
  }
}

function buildSingleNodeRunPayload(
  canvas: LumenCanvas,
  target: LumenCanvasNode,
  resolvedInput: NodeInput,
): { nodes: WorkflowNode[]; edges: WorkflowEdge[] } {
  const incomingEdges = canvas.edges.filter((edge) => edge.target === target.id);
  const upstreamIds = new Set(incomingEdges.map((edge) => edge.source));
  const upstreamNodes = canvas.nodes.filter((node) => upstreamIds.has(node.id));

  const nodes: WorkflowNode[] = [
    ...upstreamNodes.map((node) => canvasNodeToWorkflowNodeWithContext(canvas, node)),
    {
      ...canvasNodeToWorkflowNodeWithContext(canvas, target),
      input: resolvedInput,
      output: null,
    },
  ];
  const edges = canvasEdgesToWorkflowEdges(incomingEdges);

  return { nodes, edges };
}

function workflowErrorDisplayMessage(error: unknown): string {
  if (error instanceof WorkflowNodeExecutionError) return error.displayMessage;
  return error instanceof Error ? error.message : String(error);
}

function workflowErrorFields(error: unknown): PublicErrorFields {
  if (error instanceof WorkflowNodeExecutionError) {
    return compactPublicErrorFields({
      errorCode: error.errorCode,
      errorName: error.errorName,
      errorI18nKey: error.errorI18nKey,
      retryable: error.retryable,
      attempts: error.attempts,
    });
  }
  return {};
}

function workflowErrorEventFields(error: unknown): Record<string, unknown> {
  if (!(error instanceof WorkflowNodeExecutionError)) return {};
  return toSnakePublicErrorFields(error);
}

function toSnakePublicErrorFields(fields: PublicErrorFields): Record<string, unknown> {
  return {
    ...(fields.errorCode !== undefined ? { error_code: fields.errorCode } : {}),
    ...(fields.errorName ? { error_name: fields.errorName } : {}),
    ...(fields.errorI18nKey ? { error_i18n_key: fields.errorI18nKey } : {}),
    ...(fields.retryable !== undefined ? { retryable: fields.retryable } : {}),
    ...(fields.attempts !== undefined ? { attempts: fields.attempts } : {}),
  };
}

function compactPublicErrorFields(fields: PublicErrorFields): PublicErrorFields {
  return {
    ...(fields.errorCode !== undefined ? { errorCode: fields.errorCode } : {}),
    ...(fields.errorName ? { errorName: fields.errorName } : {}),
    ...(fields.errorI18nKey ? { errorI18nKey: fields.errorI18nKey } : {}),
    ...(fields.retryable !== undefined ? { retryable: fields.retryable } : {}),
    ...(fields.attempts !== undefined ? { attempts: fields.attempts } : {}),
  };
}

function formatAgentWorkflowError(event: Extract<ServerEvent, { event: 'node:error' }>): string {
  const details = ['workflow node failed'];
  if (event.errorCode !== undefined) details.push(`error_code=${event.errorCode}`);
  if (event.errorName) details.push(`error_name=${event.errorName}`);
  if (event.errorI18nKey) details.push(`error_i18n_key=${event.errorI18nKey}`);
  if (event.attempts !== undefined) details.push(`attempts=${event.attempts}`);
  details.push(`message=${event.error}`);
  return details.join(' ');
}
