// 勿加 server-only：server.ts 经 eventMirror 在进程启动时加载本模块。
import { getRedisClient } from '@lumen/db';

import { getStudioServerConfig } from '../config';
import { logger } from '../logger';

/**
 * 爆款复刻 —— Redis 传输层。
 *
 * Key 约定：
 * - `lumen:remake:tasks`             Stream — task 队列（engine remake-consumer XREADGROUP）
 * - `lumen:remake:events:<jobId>`    PubSub — 实时事件（前端 SSE 订阅）
 * - `lumen:remake:events:<jobId>:log` Stream — 事件回放（断线重连用 XRANGE 补流，TTL 1h）
 * - `lumen:remake:cancel:<jobId>`    Key    — 取消标志（值为 reason，TTL 1h）
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
  jobEventChannel,
  jobEventLogKey,
} from './channels';

import {
  REMAKE_CANCEL_KEY_PREFIX,
  REMAKE_CANCEL_TTL_SECONDS,
  REMAKE_TASKS_STREAM,
  jobEventChannel,
  jobEventLogKey,
} from './channels';

const EVENT_LOG_TTL_SECONDS = 60 * 60;
const EVENT_LOG_TRIM_MAXLEN = 500;

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
  const messageIds: string[] = [];
  for (const payload of payloads) {
    const id = await redis.xadd(
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
    if (id) messageIds.push(id);
  }
  return messageIds;
}

// ============================================================
// 事件发布 / 订阅 / 回放
// ============================================================

export type RemakeEvent =
  | {
      type: 'task:queued';
      jobId: string;
      taskId: string;
      stage: string;
      sliceKey: string;
    }
  | {
      type: 'task:start';
      jobId: string;
      taskId: string;
      stage: string;
      sliceKey: string;
    }
  | {
      type: 'task:progress';
      jobId: string;
      taskId: string;
      stage: string;
      sliceKey: string;
      progress: number;
    }
  | {
      type: 'task:done';
      jobId: string;
      taskId: string;
      stage: string;
      sliceKey: string;
      outputUrl: string;
      outputKind: 'image' | 'video' | 'audio' | 'text';
    }
  | {
      type: 'task:error';
      jobId: string;
      taskId: string;
      stage: string;
      sliceKey: string;
      error: string;
    }
  | {
      type: 'task:cancelled';
      jobId: string;
      taskId: string;
      stage: string;
      sliceKey: string;
      reason: string;
    }
  | {
      type: 'stage:status';
      jobId: string;
      stage: string;
      status: string;
    }
  | {
      type: 'job:updated';
      jobId: string;
    };

/**
 * 发布一个事件：
 * 1. PUBLISH 到 channel（活跃 SSE 消费者立即收到）
 * 2. XADD 到 log Stream（带 TTL，SSE 断线重连后用 last-event-id XRANGE 补流）
 */
export async function publishJobEvent(event: RemakeEvent): Promise<void> {
  const redis = getRedis();
  const payload = JSON.stringify(event);
  const channel = jobEventChannel(event.jobId);
  const logKey = jobEventLogKey(event.jobId);
  try {
    await Promise.all([
      redis.publish(channel, payload),
      redis
        .multi()
        .xadd(logKey, 'MAXLEN', '~', String(EVENT_LOG_TRIM_MAXLEN), '*', 'payload', payload)
        .expire(logKey, EVENT_LOG_TTL_SECONDS)
        .exec(),
    ]);
  } catch (error) {
    logger.warn({ err: error, jobId: event.jobId }, 'failed to publish remake event');
  }
}

/**
 * 从 event log Stream 回放 jobId 上所有 lastEventId 之后的事件 —— SSE 重连用。
 * lastEventId 为 '0' 表示从头开始。
 */
export async function fetchEventLog(
  jobId: string,
  lastEventId = '0',
): Promise<Array<{ id: string; event: RemakeEvent }>> {
  const redis = getRedis();
  const logKey = jobEventLogKey(jobId);
  const entries = (await redis.xrange(
    logKey,
    `(${lastEventId}`, // exclusive start
    '+',
  )) as [string, string[]][];
  const result: Array<{ id: string; event: RemakeEvent }> = [];
  for (const [id, fields] of entries) {
    const payload = readField(fields, 'payload');
    if (!payload) continue;
    try {
      result.push({ id, event: JSON.parse(payload) as RemakeEvent });
    } catch {
      // ignore corrupted entries
    }
  }
  return result;
}

function readField(fields: string[], key: string): string | undefined {
  for (let i = 0; i < fields.length; i += 2) {
    if (fields[i] === key) return fields[i + 1];
  }
  return undefined;
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
