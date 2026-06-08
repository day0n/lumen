import type { WorkflowNode } from '@lumen/shared/domain';
import type { ClientRunMessage } from '@lumen/shared/protocols';
import * as Sentry from '@sentry/node';
import { nanoid } from 'nanoid';
import type { WorkflowRunSummary, WorkflowStore } from '../database/workflow-store.js';
import { executeNode } from '../handlers/base.js';
import type { EventPublisher } from '../publisher.js';
import {
  type SnapshotCandidate,
  isSnapshotOutputType,
  updateProjectSnapshotFromRun,
} from '../storage/project-snapshot.js';
import { persistNodeOutput } from '../storage/r2.js';
import { logger } from '../utils/logger.js';
import {
  cancellationReason,
  isWorkflowCancelledError,
  throwIfCancelled,
  withCancellation,
} from './cancellation.js';
import { buildGraph, topologicalSort } from './graph.js';
import { PublicWorkflowError, publicErrorFields, publicErrorRawMessage } from './model-errors.js';
import { resolveInput } from './resolver.js';

export class WorkflowExecutor {
  constructor(
    private publisher: EventPublisher,
    private workflowStore: WorkflowStore,
  ) {}

  async execute(message: ClientRunMessage, channelId: string, signal?: AbortSignal): Promise<void> {
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
        const terminalIds = new Set<string>();
        let cancelled = false;
        let cancelReason = cancellationReason(signal);
        const summary: WorkflowRunSummary = {
          queued: sorted.length,
          succeeded: 0,
          failed: 0,
          skipped: 0,
          cancelled: 0,
        };
        let latestSnapshot: SnapshotCandidate | null = null;

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

        const cancelNodes = async (
          nodeIdsToCancel: string[],
          reason = cancellationReason(signal),
          startedAtByNode = new Map<string, Date>(),
        ) => {
          for (const nodeId of nodeIdsToCancel) {
            if (terminalIds.has(nodeId)) continue;
            const node = graph.getNodeAttributes(nodeId) as WorkflowNode;
            await this.workflowStore.markNodeCancelled({
              runId,
              projectId,
              workflowId,
              userId,
              node,
              input: resolveInput(graph, nodeId),
              error: reason,
              startedAt: startedAtByNode.get(nodeId),
            });
            terminalIds.add(nodeId);
            summary.cancelled += 1;
            await this.publisher.publish(channelId, {
              event: 'node:cancel',
              nodeId,
              reason,
            });
          }
        };

        // Mark all target nodes as queued.
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

        if (signal?.aborted) {
          cancelled = true;
          cancelReason = cancellationReason(signal);
          await cancelNodes(sorted, cancelReason);
        }

        // Execute in topological order.
        for (const nodeId of sorted) {
          if (cancelled) break;
          const node = graph.getNodeAttributes(nodeId) as WorkflowNode;

          try {
            throwIfCancelled(signal);
          } catch (err) {
            cancelled = true;
            cancelReason = err instanceof Error ? err.message : cancellationReason(signal);
            await cancelNodes(sorted.slice(sorted.indexOf(nodeId)), cancelReason);
            break;
          }

          // Skip if any upstream node failed.
          const upstreamFailed = graph.inNeighbors(nodeId).some((id) => failedIds.has(id));
          if (upstreamFailed) {
            failedIds.add(nodeId);
            terminalIds.add(nodeId);
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
            const execution = Sentry.startSpan(
              {
                name: `node.${node.type}`,
                op: 'node.execute',
                attributes: {
                  node_id: nodeId,
                  node_type: node.type,
                  model: node.model?.id,
                },
              },
              () => executeNode(node.type, input, node.model, { signal }),
            );
            const result = await withCancellation(execution, signal);
            throwIfCancelled(signal);

            const stored = await persistNodeOutput({
              output: result,
              runId,
              projectId,
              nodeId,
            });
            throwIfCancelled(signal);

            // Store output on graph for downstream nodes.
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
            terminalIds.add(nodeId);
            summary.succeeded += 1;

            if (isSnapshotOutputType(stored.type) && stored.value.trim()) {
              latestSnapshot = { type: stored.type, url: stored.value };
            }

            await this.publisher.publish(channelId, {
              event: 'node:done',
              nodeId,
              output: stored.value,
            });
          } catch (err) {
            if (isWorkflowCancelledError(err) || signal?.aborted) {
              cancelled = true;
              cancelReason = err instanceof Error ? err.message : cancellationReason(signal);
              await cancelNodes(
                sorted.slice(sorted.indexOf(nodeId)),
                cancelReason,
                new Map([[nodeId, startedAt]]),
              );
              break;
            }

            failedIds.add(nodeId);
            terminalIds.add(nodeId);
            summary.failed += 1;
            const errorMsg =
              err instanceof PublicWorkflowError
                ? err.message
                : err instanceof Error
                  ? err.message
                  : String(err);
            const structuredError = publicErrorFields(err);
            const rawError = publicErrorRawMessage(err);
            logger.error({ err, nodeId, structuredError }, 'node execution failed');
            await this.workflowStore.markNodeFailed({
              runId,
              projectId,
              workflowId,
              userId,
              node,
              input,
              error: errorMsg,
              rawError,
              ...structuredError,
              startedAt,
            });
            await this.publisher.publish(channelId, {
              event: 'node:error',
              nodeId,
              error: errorMsg,
              ...structuredError,
            });
          }
        }

        const status = cancelled ? 'cancelled' : summary.failed > 0 ? 'failed' : 'success';
        await this.workflowStore.finishRun({
          runId,
          status,
          summary,
          error: cancelled
            ? cancelReason
            : summary.failed > 0
              ? `${summary.failed} node(s) failed`
              : undefined,
        });

        if (!cancelled && projectId && latestSnapshot) {
          try {
            await updateProjectSnapshotFromRun({
              projectId,
              userId,
              candidate: latestSnapshot,
              signal,
            });
          } catch (err) {
            logger.warn({ err, projectId, runId }, 'failed to update project snapshot');
          }
        }

        await this.publisher.publish(
          channelId,
          cancelled
            ? { event: 'flow:cancel', runId, reason: cancelReason }
            : { event: 'flow:done' },
        );
      },
    );
  }
}
