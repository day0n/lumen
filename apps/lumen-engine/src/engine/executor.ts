import type { WorkflowNode } from '@lumen/shared/domain';
import type { ClientMessage } from '@lumen/shared/protocols';
import * as Sentry from '@sentry/node';
import { nanoid } from 'nanoid';
import type { WorkflowRunSummary, WorkflowStore } from '../database/workflow-store.js';
import { executeNode } from '../handlers/base.js';
import type { EventPublisher } from '../publisher.js';
import { persistNodeOutput } from '../storage/r2.js';
import { logger } from '../utils/logger.js';
import { buildGraph, topologicalSort } from './graph.js';
import { resolveInput } from './resolver.js';

export class WorkflowExecutor {
  constructor(
    private publisher: EventPublisher,
    private workflowStore: WorkflowStore,
  ) {}

  async execute(message: ClientMessage, channelId: string): Promise<void> {
    const runId = message.runId ?? nanoid(16);
    const projectId = message.projectId ?? null;
    const workflowId = message.workflowId ?? projectId;
    const userId = message.userId ?? null;
    const { nodes, edges, nodeIds } = message;

    return Sentry.startSpan(
      {
        name: 'workflow.execute',
        op: 'workflow.execute',
        forceTransaction: true,
        attributes: {
          run_id: runId,
          project_id: projectId ?? undefined,
          workflow_id: workflowId ?? undefined,
          node_total: nodes.length,
          requested_node_count: nodeIds?.length ?? nodes.length,
        },
      },
      async () => {
        const graph = buildGraph(nodes, edges);

        const targetIds = nodeIds && nodeIds.length > 0 ? nodeIds : nodes.map((n) => n.id);
        const requestedSet = new Set(targetIds);
        // Keep dependency ordering, but do not re-run upstream nodes that were not explicitly requested.
        const sorted = topologicalSort(graph, targetIds).filter((id) => requestedSet.has(id));
        const failedIds = new Set<string>();
        const summary: WorkflowRunSummary = {
          queued: sorted.length,
          succeeded: 0,
          failed: 0,
          skipped: 0,
        };

        await this.workflowStore.createRun({
          runId,
          projectId,
          workflowId,
          userId,
          requestedNodeIds: targetIds,
          nodeIds: sorted,
          nodes,
          edges,
        });

        // Mark all target nodes as queued
        for (const nodeId of sorted) {
          const node = graph.getNodeAttributes(nodeId) as WorkflowNode;
          const input = resolveInput(graph, nodeId);
          await this.workflowStore.markNodeQueued({
            runId,
            projectId,
            workflowId,
            userId,
            node,
            input,
          });
          await this.publisher.publish(channelId, { event: 'node:queued', nodeId });
        }

        // Execute in topological order
        for (const nodeId of sorted) {
          const node = graph.getNodeAttributes(nodeId) as WorkflowNode;

          // Skip if any upstream node failed
          const upstreamFailed = graph.inNeighbors(nodeId).some((id) => failedIds.has(id));
          if (upstreamFailed) {
            failedIds.add(nodeId);
            summary.skipped += 1;
            await this.workflowStore.markNodeSkipped({
              runId,
              projectId,
              workflowId,
              userId,
              node,
              input: resolveInput(graph, nodeId),
              error: 'skipped: upstream node failed',
            });
            await this.publisher.publish(channelId, {
              event: 'node:error',
              nodeId,
              error: 'skipped: upstream node failed',
            });
            continue;
          }

          const startedAt = new Date();
          const input = resolveInput(graph, nodeId);
          await this.workflowStore.markNodeStarted(
            { runId, projectId, workflowId, userId, node, input },
            startedAt,
          );
          await this.publisher.publish(channelId, { event: 'node:start', nodeId });

          try {
            // node.execute span 覆盖的就是对外部模型 API（文/图/视频/音频）的调用，
            // 这段时长 = 用户关心的"接口速度"。R2 上传单独在 r2.ts 里量。
            const result = await Sentry.startSpan(
              {
                name: `node.${node.type}`,
                op: 'node.execute',
                attributes: {
                  node_id: nodeId,
                  node_type: node.type,
                  model: node.model?.id,
                },
              },
              () => executeNode(node.type, input, node.model),
            );
            const stored = await persistNodeOutput({
              output: result,
              runId,
              projectId,
              nodeId,
            });

            // Store output on graph for downstream nodes
            graph.setNodeAttribute(nodeId, 'output', stored.value);
            await this.workflowStore.markNodeSucceeded({
              runId,
              projectId,
              workflowId,
              userId,
              node,
              input,
              outputType: stored.type,
              outputValue: stored.value,
              asset: stored.asset,
              startedAt,
            });
            summary.succeeded += 1;

            await this.publisher.publish(channelId, {
              event: 'node:done',
              nodeId,
              output: stored.value,
            });
          } catch (err) {
            failedIds.add(nodeId);
            summary.failed += 1;
            const errorMsg = err instanceof Error ? err.message : String(err);
            logger.error({ err, nodeId }, 'node execution failed');
            await this.workflowStore.markNodeFailed({
              runId,
              projectId,
              workflowId,
              userId,
              node,
              input,
              error: errorMsg,
              startedAt,
            });
            await this.publisher.publish(channelId, {
              event: 'node:error',
              nodeId,
              error: errorMsg,
            });
          }
        }

        await this.workflowStore.finishRun({
          runId,
          status: summary.failed > 0 ? 'failed' : 'success',
          summary,
          error: summary.failed > 0 ? `${summary.failed} node(s) failed` : undefined,
        });

        await this.publisher.publish(channelId, { event: 'flow:done' });
      },
    );
  }
}
