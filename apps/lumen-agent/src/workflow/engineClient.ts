import type Redis from 'ioredis';
import { nanoid } from 'nanoid';

import {
  type LumenCanvas,
  type LumenCanvasNode,
  type LumenCanvasNodeData,
  canvasNodeToWorkflowNode,
  computeSingleNodeInput,
  updateCanvasNodeData,
} from '@lumen/shared/domain';
import type { ClientMessage, ServerEvent } from '@lumen/shared/protocols';

import { getConfig } from '../config/index.js';
import { emitToolEvent } from '../core/tools/runtime.js';
import { logger } from '../observability/logger.js';
import type { ProjectWorkflowStore, WorkflowProject } from './projectStore.js';

export interface RunWorkflowNodeResult {
  runId: string;
  project: WorkflowProject;
  node: LumenCanvasNode;
  output: string;
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

    const workflowNode = {
      ...canvasNodeToWorkflowNode(target),
      input: resolvedInput,
      output: null,
    };
    const runId = nanoid(16);
    const channelId = `flow:events:agent:${runId}:${nanoid(8)}`;

    await this.updateNodeState(input.project, target.id, {
      status: 'queued',
      error: null,
      progress: 0,
    });
    await emitToolEvent('workflow_node_status', {
      project_id: input.project.id,
      node_id: target.id,
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
        node: workflowNode,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const errorCanvas = updateCanvasNodeData(input.project.canvas, target.id, {
        status: 'error',
        error: message,
        progress: 1,
      });
      await this.store.updateCanvas({
        userId: input.userId,
        projectId: input.project.id,
        canvas: errorCanvas,
      });
      await emitToolEvent('workflow_update', {
        project_id: input.project.id,
        reason: 'run_workflow_node_error',
        node_id: target.id,
        run_id: runId,
        node_count: errorCanvas.nodes.length,
        edge_count: errorCanvas.edges.length,
      });
      throw err;
    }

    const nextCanvas = updateCanvasNodeData(input.project.canvas, target.id, {
      status: 'success',
      output,
      error: null,
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
      reason: 'run_workflow_node',
      node_id: target.id,
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
    node: ReturnType<typeof canvasNodeToWorkflowNode>;
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
            void this.handleEngineEvent(input.projectId, input.runId, event);
            if (event.event === 'node:done' && event.nodeId === input.nodeId) {
              settled = true;
              clearTimeout(timer);
              resolve(event.output);
            }
            if (event.event === 'node:error' && event.nodeId === input.nodeId) {
              settled = true;
              clearTimeout(timer);
              reject(new Error(event.error));
            }
          } catch (err) {
            settled = true;
            clearTimeout(timer);
            reject(err instanceof Error ? err : new Error(String(err)));
          }
        });
      });

      const message: ClientMessage = {
        runId: input.runId,
        projectId: input.projectId,
        workflowId: input.projectId,
        userId: input.userId,
        nodeIds: [input.nodeId],
        nodes: [input.node],
        edges: [],
      };

      await emitToolEvent('workflow_node_status', {
        project_id: input.projectId,
        node_id: input.nodeId,
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
  ): Promise<void> {
    switch (event.event) {
      case 'node:queued':
        await emitToolEvent('workflow_node_status', {
          project_id: projectId,
          run_id: runId,
          node_id: event.nodeId,
          status: 'queued',
          progress: 0,
        });
        break;
      case 'node:start':
        await emitToolEvent('workflow_node_status', {
          project_id: projectId,
          run_id: runId,
          node_id: event.nodeId,
          status: 'running',
          progress: 0.35,
        });
        break;
      case 'node:progress':
        await emitToolEvent('workflow_node_status', {
          project_id: projectId,
          run_id: runId,
          node_id: event.nodeId,
          status: 'running',
          progress: event.progress,
        });
        break;
      case 'node:done':
        await emitToolEvent('workflow_node_status', {
          project_id: projectId,
          run_id: runId,
          node_id: event.nodeId,
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
          status: 'error',
          error: event.error,
        });
        break;
      case 'flow:done':
        await emitToolEvent('workflow_completed', {
          project_id: projectId,
          run_id: runId,
        });
        break;
    }
  }
}
