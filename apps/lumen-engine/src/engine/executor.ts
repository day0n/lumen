import type { WorkflowNode } from '@lumen/shared/domain';
import type { ClientMessage } from '@lumen/shared/protocols';
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
    const { nodes, edges, nodeIds } = message;
    const graph = buildGraph(nodes, edges);

    const targetIds = nodeIds && nodeIds.length > 0 ? nodeIds : nodes.map((n) => n.id);
    const sorted = topologicalSort(graph, targetIds);
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
      requestedNodeIds: targetIds,
      nodeIds: sorted,
      nodes,
      edges,
    });

    // Mark all target nodes as queued
    for (const nodeId of sorted) {
      const node = graph.getNodeAttributes(nodeId) as WorkflowNode;
      const input = resolveInput(graph, nodeId);
      await this.workflowStore.markNodeQueued({ runId, projectId, node, input });
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
      await this.workflowStore.markNodeStarted({ runId, projectId, node, input }, startedAt);
      await this.publisher.publish(channelId, { event: 'node:start', nodeId });

      try {
        const result = await executeNode(node.type, input, node.model);
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
  }
}
