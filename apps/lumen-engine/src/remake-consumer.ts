import type { NodeType } from '@lumen/shared/domain';
import * as Sentry from '@sentry/node';
import type Redis from 'ioredis';

import { CANCEL_KEY_PREFIX } from './engine/cancellation.js';
import type { ResolvedInput } from './engine/resolver.js';
import { executeNode } from './handlers/base.js';
import { persistNodeOutput } from './storage/r2.js';
import { logger } from './utils/logger.js';

/**
 * Lumen 爆款复刻 —— 独立 task 消费者。
 *
 * 与现有 StreamConsumer（workflow 模型）完全独立：
 * - Stream:  `lumen:remake:tasks`        消费组 `remake-engine-group`
 * - Results: PUBLISH `lumen:remake:task-results` 单一 channel（studio eventMirror 单点订阅）
 * - Cancel:  `lumen:remake:cancel:<jobId>` Key（per-job 维度，跟 workflow run 维度区分开）
 *
 * 一个 task = 一次 handler 调用。
 * Engine 本身不关心 stage / scene index / 上下游依赖 —— 那是 studio 编排层的事。
 * Engine 只看 handler 名 + input + settings，跑完发结果。
 */

const TASKS_STREAM = 'lumen:remake:tasks';
const GROUP_NAME = 'remake-engine-group';
const CONSUMER_NAME = `remake-${process.pid}`;
const TASK_RESULTS_CHANNEL = 'lumen:remake:task-results';

// handler 名 → NodeType（用于路由到对应的 image/video/audio handler）
const HANDLER_TYPE_MAP: Record<string, NodeType> = {
  'nano-banana2': 'image',
  'veo-3.1': 'video',
  'fish-tts': 'audio',
  'suno-music': 'audio',
  'lumen-video-edit': 'video',
};

interface TaskFields {
  taskId: string;
  jobId: string;
  ownerId: string;
  stage: string;
  sliceKey: string;
  handler: string;
  inputJson: string;
  settingsJson: string;
}

// 每个 task = 一次独立的模型调用，节点之间互不依赖（studio 编排层处理依赖）。
// 因此 engine 侧并发处理多个 task：一个节点在生成时，用户重跑另一个节点能立即开跑，
// 不必排队等当前节点结束。受控并发上限避免对上游模型 API 打太满。
const MAX_CONCURRENCY = 6;

export class RemakeStreamConsumer {
  private running = false;
  private activeTasks = new Map<string, AbortController>();
  private inFlight = 0;
  // 阻塞读用独立连接：XREADGROUP BLOCK 会占住整条连接，若和并发任务的
  // publish/xack/get 共用一条连接会互相卡住。读用 reader，副作用用 this.redis。
  private reader: Redis | null = null;

  constructor(private redis: Redis) {}

  async start(): Promise<void> {
    await this.ensureGroup();
    this.running = true;
    this.reader = this.redis.duplicate();
    logger.info('remake stream consumer started, waiting for tasks...');

    while (this.running) {
      try {
        if (this.inFlight >= MAX_CONCURRENCY) {
          await sleep(100);
          continue;
        }
        const capacity = MAX_CONCURRENCY - this.inFlight;
        const results = (await this.reader.xreadgroup(
          'GROUP',
          GROUP_NAME,
          CONSUMER_NAME,
          'COUNT',
          String(capacity),
          'BLOCK',
          '5000',
          'STREAMS',
          TASKS_STREAM,
          '>',
        )) as [string, [string, string[]][]][] | null;

        if (!results) continue;
        for (const [, messages] of results) {
          for (const [messageId, fields] of messages) {
            // 并发派发：不 await，让多个节点同时跑；inFlight 控制并发上限。
            this.inFlight += 1;
            void this.processMessage(messageId, fields as string[])
              .catch((err) => {
                logger.error({ err, messageId }, 'remake task processing crashed');
              })
              .finally(() => {
                this.inFlight -= 1;
              });
          }
        }
      } catch (err) {
        if (this.running) {
          logger.error({ err }, 'remake consumer error, retrying in 1s...');
          await sleep(1000);
        }
      }
    }
  }

  stop(): void {
    this.running = false;
    for (const controller of this.activeTasks.values()) {
      if (!controller.signal.aborted) controller.abort('engine shutting down');
    }
    if (this.reader) {
      this.reader.disconnect();
      this.reader = null;
    }
  }

  private async processMessage(messageId: string, rawFields: string[]): Promise<void> {
    const fields = parseFields(rawFields);
    const task = parseTaskFields(fields);
    if (!task) {
      logger.warn({ messageId }, 'malformed remake task message, ack and skip');
      await this.redis.xack(TASKS_STREAM, GROUP_NAME, messageId);
      return;
    }

    const cancelKey = `${CANCEL_KEY_PREFIX}${task.jobId}`;
    const cancelReason = await this.redis.get(cancelKey);
    if (cancelReason) {
      // job 已被用户取消，直接报取消
      await publishResult(this.redis, {
        type: 'task:cancelled',
        ...task,
        reason: parseCancelReason(cancelReason),
      });
      await this.redis.xack(TASKS_STREAM, GROUP_NAME, messageId);
      return;
    }

    const controller = new AbortController();
    this.activeTasks.set(task.taskId, controller);

    await Sentry.startSpan(
      {
        name: `remake.task.${task.handler}`,
        op: 'remake.task',
        attributes: {
          job_id: task.jobId,
          task_id: task.taskId,
          stage: task.stage,
          slice_key: task.sliceKey,
          handler: task.handler,
        },
      },
      async () => {
        try {
          await publishResult(this.redis, { type: 'task:start', ...task });

          const nodeType = HANDLER_TYPE_MAP[task.handler];
          if (!nodeType) {
            throw new Error(`unsupported handler: ${task.handler}`);
          }

          const input = JSON.parse(task.inputJson) as ResolvedInput;
          const settings = JSON.parse(task.settingsJson) as Record<string, unknown>;

          const output = await executeNode(
            nodeType,
            { ...defaultResolvedInput(), ...input },
            { id: task.handler, settings },
            { signal: controller.signal },
          );

          // 落 R2 → 拿到稳定 https 链接（已经是 R2 链接 / 非媒体类型则原样返回）
          const stored = await persistNodeOutput({
            output,
            runId: task.jobId,
            projectId: null,
            nodeId: task.sliceKey,
          });

          await publishResult(this.redis, {
            type: 'task:done',
            ...task,
            outputUrl: stored.value,
            outputKind: output.type,
          });
        } catch (err) {
          if (controller.signal.aborted) {
            await publishResult(this.redis, {
              type: 'task:cancelled',
              ...task,
              reason: controller.signal.reason ? String(controller.signal.reason) : 'cancelled',
            });
          } else {
            const message = err instanceof Error ? err.message : String(err);
            logger.error({ err, taskId: task.taskId }, 'remake task failed');
            await publishResult(this.redis, {
              type: 'task:error',
              ...task,
              error: message.slice(0, 1800),
            });
          }
        } finally {
          this.activeTasks.delete(task.taskId);
          await this.redis.xack(TASKS_STREAM, GROUP_NAME, messageId);
        }
      },
    );
  }

  private async ensureGroup(): Promise<void> {
    try {
      await this.redis.xgroup('CREATE', TASKS_STREAM, GROUP_NAME, '0', 'MKSTREAM');
      logger.info('created remake consumer group');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!message.includes('BUSYGROUP')) throw err;
    }
  }
}

// ============================================================
// 辅助
// ============================================================

interface BaseResultEvent {
  jobId: string;
  ownerId: string;
  taskId: string;
  stage: string;
  sliceKey: string;
}

type TaskResultEvent =
  | ({ type: 'task:start' } & BaseResultEvent)
  | ({ type: 'task:progress'; progress: number } & BaseResultEvent)
  | ({ type: 'task:done'; outputUrl: string; outputKind: NodeType } & BaseResultEvent)
  | ({ type: 'task:error'; error: string } & BaseResultEvent)
  | ({ type: 'task:cancelled'; reason: string } & BaseResultEvent);

async function publishResult(redis: Redis, event: TaskResultEvent): Promise<void> {
  try {
    await redis.publish(TASK_RESULTS_CHANNEL, JSON.stringify(event));
  } catch (err) {
    logger.warn({ err, taskId: event.taskId }, 'failed to publish remake task result');
  }
}

function parseFields(rawFields: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < rawFields.length; i += 2) {
    const key = rawFields[i];
    const value = rawFields[i + 1];
    if (key && value !== undefined) out[key] = value;
  }
  return out;
}

function parseTaskFields(fields: Record<string, string>): TaskFields | null {
  const required = [
    'taskId',
    'jobId',
    'ownerId',
    'stage',
    'sliceKey',
    'handler',
    'inputJson',
    'settingsJson',
  ] as const;
  for (const key of required) {
    if (!fields[key]) return null;
  }
  return {
    taskId: fields.taskId!,
    jobId: fields.jobId!,
    ownerId: fields.ownerId!,
    stage: fields.stage!,
    sliceKey: fields.sliceKey!,
    handler: fields.handler!,
    inputJson: fields.inputJson!,
    settingsJson: fields.settingsJson!,
  };
}

function parseCancelReason(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as { reason?: string };
    return parsed.reason?.trim() || 'cancelled by user';
  } catch {
    return 'cancelled by user';
  }
}

function defaultResolvedInput(): ResolvedInput {
  return {
    prompt: '',
    image: null,
    lastFrameImage: null,
    images: [],
    video: null,
    videos: [],
    audio: null,
    audios: [],
    clips: [],
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
