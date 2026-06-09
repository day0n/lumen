import type Redis from 'ioredis';

const FLOW_CANCEL_CHANNEL = 'lumen:flow:cancels';
const FLOW_CANCEL_KEY_PREFIX = 'lumen:flow:cancel:';
const AGENT_WORKFLOW_RUN_KEY_PREFIX = 'lumen:agent:workflow-runs:';
const CANCEL_TTL_SECONDS = 60 * 60;

export async function registerWorkflowRunForAgentRun(
  redis: Redis | null,
  agentRunId: string | null | undefined,
  workflowRunId: string,
): Promise<void> {
  if (!redis || !agentRunId) return;
  const key = agentWorkflowRunKey(agentRunId);
  await redis.multi().sadd(key, workflowRunId).expire(key, CANCEL_TTL_SECONDS).exec();
}

export async function unregisterWorkflowRunForAgentRun(
  redis: Redis | null,
  agentRunId: string | null | undefined,
  workflowRunId: string,
): Promise<void> {
  if (!redis || !agentRunId) return;
  await redis.srem(agentWorkflowRunKey(agentRunId), workflowRunId);
}

export async function cancelWorkflowRunsForAgentRun(
  redis: Redis | null,
  agentRunId: string,
  reason = 'cancelled by user',
): Promise<string[]> {
  if (!redis) return [];
  const key = agentWorkflowRunKey(agentRunId);
  const workflowRunIds = await redis.smembers(key);
  if (workflowRunIds.length === 0) return [];

  const normalizedReason = reason.trim() || 'cancelled by user';
  const multi = redis.multi();
  for (const runId of workflowRunIds) {
    const payload = JSON.stringify({ runId, reason: normalizedReason });
    multi.set(`${FLOW_CANCEL_KEY_PREFIX}${runId}`, payload, 'EX', CANCEL_TTL_SECONDS);
    multi.publish(FLOW_CANCEL_CHANNEL, payload);
  }
  await multi.exec();
  return workflowRunIds;
}

function agentWorkflowRunKey(agentRunId: string): string {
  return `${AGENT_WORKFLOW_RUN_KEY_PREFIX}${agentRunId}`;
}
