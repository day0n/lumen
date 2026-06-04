import Redis from 'ioredis';

import { getStudioServerConfig } from '../config';
import { logger } from '../logger';
import { REMAKE_TASK_RESULTS_CHANNEL } from './dispatch';
import { recordTaskOutcome } from './jobs';

/**
 * 爆款复刻 —— 事件镜像 worker。
 *
 * 职责：常驻订阅 Redis PubSub `lumen:remake:events:*`，把 engine remake-consumer
 * 发出来的 task 完成/失败/进度事件镜像到 Mongo（更新 task 文档 + job.outputs + stage 状态机）。
 *
 * 跟前端 SSE 同时订阅同一组 channel，但两者职责不重叠：
 * - 本 worker：写 Mongo（持久化、跨设备一致）
 * - SSE 端点：转发给浏览器（实时推送）
 *
 * Engine 端发的事件本身就是 task 完成的"事实"，本 worker 只负责把事实落进数据库。
 */

let subscriber: Redis | null = null;
let initialized = false;

interface EngineTaskEvent {
  type: 'task:start' | 'task:progress' | 'task:done' | 'task:error' | 'task:cancelled';
  jobId: string;
  ownerId: string;
  taskId: string;
  stage: string;
  sliceKey: string;
  progress?: number;
  outputUrl?: string;
  outputKind?: 'image' | 'video' | 'audio' | 'text';
  error?: string;
}

export function initRemakeEventMirror(): void {
  if (initialized) return;
  initialized = true;
  const cfg = getStudioServerConfig();
  if (!cfg.REDIS_URL) {
    logger.warn('REDIS_URL 未配置，remake event mirror 不启动');
    return;
  }

  subscriber = new Redis(cfg.REDIS_URL, { maxRetriesPerRequest: null });
  subscriber.on('error', (err) => {
    logger.error({ err }, 'remake event mirror redis error');
  });

  // Engine 发的原始 task 结果走独立 channel `lumen:remake:task-results`，与 SSE 用的
  // `lumen:remake:events:<jobId>` 隔离，避免 mirror 自回环。
  subscriber.on('message', (channel, message) => {
    if (channel !== REMAKE_TASK_RESULTS_CHANNEL) return;
    handleEngineMessage(message).catch((err) => {
      logger.warn({ err }, 'remake event mirror failed to process message');
    });
  });

  subscriber.subscribe(REMAKE_TASK_RESULTS_CHANNEL).catch((err) => {
    logger.error({ err }, 'remake event mirror subscribe failed');
  });

  logger.info('remake event mirror started');
}

async function handleEngineMessage(raw: string): Promise<void> {
  let parsed: EngineTaskEvent;
  try {
    parsed = JSON.parse(raw) as EngineTaskEvent;
  } catch {
    return;
  }

  // engine 端的 task 事件带 ownerId（XADD 时 studio 写进去的）。本 worker 自己发
  // 的事件没有 ownerId，跳过。
  if (!parsed.ownerId || !parsed.taskId || !parsed.jobId) return;
  if (
    parsed.type !== 'task:start' &&
    parsed.type !== 'task:progress' &&
    parsed.type !== 'task:done' &&
    parsed.type !== 'task:error' &&
    parsed.type !== 'task:cancelled'
  ) {
    return;
  }

  const status =
    parsed.type === 'task:start'
      ? 'running'
      : parsed.type === 'task:progress'
        ? 'running'
        : parsed.type === 'task:done'
          ? 'success'
          : parsed.type === 'task:error'
            ? 'error'
            : 'cancelled';

  await recordTaskOutcome({
    jobId: parsed.jobId,
    ownerId: parsed.ownerId,
    taskId: parsed.taskId,
    status,
    progress: parsed.progress,
    outputUrl: parsed.outputUrl,
    outputKind: parsed.outputKind,
    error: parsed.error,
  });
}

export async function stopRemakeEventMirror(): Promise<void> {
  if (subscriber) {
    await subscriber.quit();
    subscriber = null;
  }
  initialized = false;
}
