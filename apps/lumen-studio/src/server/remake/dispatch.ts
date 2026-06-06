// 勿加 server-only：server.ts 经 eventMirror 在进程启动时加载本模块。
import { getRedisClient } from '@lumen/db';

import { getStudioServerConfig } from '../config';
import { logger } from '../logger';

/**
 * 爆款复刻 —— Redis 传输层。
 *
 * Key 约定：
 * - `lumen:remake:tasks`          Stream — task 队列（engine remake-consumer XREADGROUP）
 * - `lumen:remake:cancel:<jobId>` Key    — 取消标志（值为 reason，TTL 1h）
 *
 * 与老 `lumen:flow:tasks` 完全独立 —— 爆款复刻退出 workflow 模型，普通画布工作流不受影响。
 */

export {
  REMAKE_CANCEL_CHANNEL,
  REMAKE_CANCEL_KEY_PREFIX,
  REMAKE_CANCEL_TTL_SECONDS,
  REMAKE_TASK_RESULTS_CHANNEL,
  REMAKE_TASKS_GROUP,
  REMAKE_TASKS_STREAM,
} from './channels';

import {
  REMAKE_CANCEL_CHANNEL,
  REMAKE_CANCEL_KEY_PREFIX,
  REMAKE_CANCEL_TTL_SECONDS,
  REMAKE_TASKS_STREAM,
} from './channels';

function getRedis() {
  const cfg = getStudioServerConfig();
  const redis = getRedisClient({ url: cfg.REDIS_URL });
  if (!redis) {
    throw new Error('REDIS_URL is not configured');
  }
  return redis;
}

// ============================================================
// Task 派发
// ============================================================

export interface DispatchTaskPayload {
  taskId: string;
  jobId: string;
  ownerId: string;
  stage: string;
  sliceKey: string;
  handler: string;
  /** 已经序列化好的 RemakeTaskInput。 */
  inputJson: string;
  /** 已经序列化好的 settings 对象。 */
  settingsJson: string;
}

/**
 * XADD 一批 task 到 lumen:remake:tasks。
 * 返回每条消息的 Stream message id（便于审计 / debug）。
 */
export async function dispatchTasks(payloads: DispatchTaskPayload[]): Promise<string[]> {
  if (payloads.length === 0) return [];
  const redis = getRedis();
  const pipeline = redis.pipeline();
  for (const payload of payloads) {
    pipeline.xadd(
      REMAKE_TASKS_STREAM,
      '*',
      'taskId',
      payload.taskId,
      'jobId',
      payload.jobId,
      'ownerId',
      payload.ownerId,
      'stage',
      payload.stage,
      'sliceKey',
      payload.sliceKey,
      'handler',
      payload.handler,
      'inputJson',
      payload.inputJson,
      'settingsJson',
      payload.settingsJson,
    );
  }
  const results = await pipeline.exec();
  if (!results) return [];

  const messageIds: string[] = [];
  for (const [error, id] of results) {
    if (error) throw error;
    if (typeof id === 'string') messageIds.push(id);
  }
  return messageIds;
}

// ============================================================
// 取消
// ============================================================

export async function setJobCancelled(jobId: string, reason: string): Promise<void> {
  const redis = getRedis();
  const payload = JSON.stringify({ jobId, reason });
  await redis
    .multi()
    .set(`${REMAKE_CANCEL_KEY_PREFIX}${jobId}`, payload, 'EX', REMAKE_CANCEL_TTL_SECONDS)
    .publish(REMAKE_CANCEL_CHANNEL, payload)
    .exec();
}

export async function getJobCancelReason(jobId: string): Promise<string | null> {
  const redis = getRedis();
  const raw = await redis.get(`${REMAKE_CANCEL_KEY_PREFIX}${jobId}`);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { reason?: string };
    return parsed.reason ?? null;
  } catch {
    return null;
  }
}

export async function clearJobCancelled(jobId: string): Promise<void> {
  const redis = getRedis();
  await redis.del(`${REMAKE_CANCEL_KEY_PREFIX}${jobId}`);
}
