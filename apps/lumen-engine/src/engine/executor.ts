import type { WorkflowNode } from '@lumen/shared/domain';
import type { ClientMessage } from '@lumen/shared/protocols';
import { executeNode } from '../handlers/base.js';
import type { EventPublisher } from '../publisher.js';
import { logger } from '../utils/logger.js';
import { buildGraph, topologicalSort } from './graph.js';
import { resolveInput } from './resolver.js';

export class WorkflowExecutor {
  constructor(private publisher: EventPublisher) {}

  async execute(message: ClientMessage, channelId: string): Promise<void> {
    const { nodes, edges, nodeIds } = message;
    const graph = buildGraph(nodes, edges);

    const targetIds = nodeIds && nodeIds.length > 0 ? nodeIds : nodes.map((n) => n.id);
    const sorted = topologicalSort(graph, targetIds);
    const failedIds = new Set<string>();

    // Mark all target nodes as queued
    for (const nodeId of sorted) {
      await this.publisher.publish(channelId, { event: 'node:queued', nodeId });
    }

    // Execute in topological order
    for (const nodeId of sorted) {
      const node = graph.getNodeAttributes(nodeId) as WorkflowNode;

      // Skip nodes that already have output
      if (node.output) {
        logger.debug({ nodeId }, 'node already has output, skipping');
        continue;
      }

      // Skip if any upstream node failed
      const upstreamFailed = graph.inNeighbors(nodeId).some((id) => failedIds.has(id));
      if (upstreamFailed) {
        failedIds.add(nodeId);
        await this.publisher.publish(channelId, {
          event: 'node:error',
          nodeId,
          error: 'skipped: upstream node failed',
        });
        continue;
      }

      await this.publisher.publish(channelId, { event: 'node:start', nodeId });

      try {
        const input = resolveInput(graph, nodeId);
        const result = await executeNode(node.type, input, node.model);

        // Store output on graph for downstream nodes
        graph.setNodeAttribute(nodeId, 'output', result.value);

        await this.publisher.publish(channelId, {
          event: 'node:done',
          nodeId,
          output: result.value,
        });
      } catch (err) {
        failedIds.add(nodeId);
        const errorMsg = err instanceof Error ? err.message : String(err);
        logger.error({ err, nodeId }, 'node execution failed');
        await this.publisher.publish(channelId, {
          event: 'node:error',
          nodeId,
          error: errorMsg,
        });
      }
    }

    await this.publisher.publish(channelId, { event: 'flow:done' });
  }
}
