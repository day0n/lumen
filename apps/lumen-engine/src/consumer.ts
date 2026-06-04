import { ClientRunMessageSchema } from '@lumen/shared/protocols';
import * as Sentry from '@sentry/node';
import type Redis from 'ioredis';
import type { WorkflowStore } from './database/workflow-store.js';
import { CANCEL_CHANNEL, CANCEL_KEY_PREFIX } from './engine/cancellation.js';
import { WorkflowExecutor } from './engine/executor.js';
import { EventPublisher } from './publisher.js';
import { logger } from './utils/logger.js';

const STREAM_KEY = 'lumen:flow:tasks';
const GROUP_NAME = 'engine-group';
const CONSUMER_NAME = `engine-${process.pid}`;
const DEFAULT_CANCEL_REASON = 'cancelled by user';

interface CancelPayload {
  runId: string;
  reason: string;
}

export class StreamConsumer {
  private running = false;
  private executor: WorkflowExecutor;
  private cancelSubscriber: Redis | null = null;
  private activeRuns = new Map<string, AbortController>();
  private cancelledRuns = new Map<string, string>();

  constructor(
    private redis: Redis,
    workflowStore: WorkflowStore,
  ) {
    const publisher = new EventPublisher(redis);
    this.executor = new WorkflowExecutor(publisher, workflowStore);
  }

  async start(): Promise<void> {
    await this.ensureGroup();
    await this.startCancelSubscriber();
    this.running = true;
    logger.info('stream consumer started, waiting for tasks...');

    while (this.running) {
      try {
        const results = (await this.redis.xreadgroup(
          'GROUP',
          GROUP_NAME,
          CONSUMER_NAME,
          'COUNT',
          '1',
          'BLOCK',
          '5000',
          'STREAMS',
          STREAM_KEY,
          '>',
        )) as [string, [string, string[]][]][] | null;

        if (!results) continue;

        for (const [, messages] of results) {
          for (const [messageId, fields] of messages) {
            await this.processMessage(messageId, fields as string[]);
          }
        }
      } catch (err) {
        if (this.running) {
          logger.error({ err }, 'consumer error, retrying in 1s...');
          await sleep(1000);
        }
      }
    }
  }

  stop(): void {
    this.running = false;
    for (const controller of this.activeRuns.values()) {
      if (!controller.signal.aborted) controller.abort('engine shutting down');
    }
    if (this.cancelSubscriber) {
      void this.cancelSubscriber.quit();
      this.cancelSubscriber = null;
    }
  }

  private async processMessage(messageId: string, fields: string[]): Promise<void> {
    const data = parseFields(fields);
    const channelId = data.channelId;

    if (!channelId) {
      logger.warn({ messageId }, 'message missing channelId, skipping');
      await this.redis.xack(STREAM_KEY, GROUP_NAME, messageId);
      return;
    }

    // studio XADD 时把浏览器发起的 trace 写进了 stream fields，这里续接同一条 trace。
    const runProcessing = () =>
      Sentry.continueTrace(
        { sentryTrace: data.sentryTrace ?? undefined, baggage: data.baggage ?? undefined },
        async () => {
          let runId: string | null = null;
          try {
            const payload = JSON.parse(data.payload ?? '{}');
            const message = ClientRunMessageSchema.parse(payload);
            runId = message.runId ?? null;
            const controller = new AbortController();

            if (runId) {
              this.activeRuns.set(runId, controller);
              const reason = await this.getCancelReason(runId);
              if (reason) controller.abort(reason);
            }

            logger.info({ messageId, runId, nodeIds: message.nodeIds }, 'processing task');
            await this.executor.execute(message, channelId, controller.signal);
          } catch (err) {
            logger.error({ err, messageId, runId }, 'task execution failed');
          } finally {
            if (runId) this.activeRuns.delete(runId);
            await this.redis.xack(STREAM_KEY, GROUP_NAME, messageId);
          }
        },
      );

    await runProcessing();
  }

  private async startCancelSubscriber(): Promise<void> {
    if (this.cancelSubscriber) return;
    const subscriber = this.redis.duplicate();
    subscriber.on('error', (err) => logger.error({ err }, 'cancel subscriber error'));
    subscriber.on('message', (_channel, raw) => {
      const payload = parseCancelPayload(raw);
      if (!payload) return;
      this.cancelledRuns.set(payload.runId, payload.reason);
      const controller = this.activeRuns.get(payload.runId);
      if (controller && !controller.signal.aborted) {
        controller.abort(payload.reason);
        logger.info({ runId: payload.runId }, 'workflow run aborted by cancel message');
      }
    });
    await subscriber.subscribe(CANCEL_CHANNEL);
    this.cancelSubscriber = subscriber;
  }

  private async getCancelReason(runId: string): Promise<string | null> {
    const localReason = this.cancelledRuns.get(runId);
    if (localReason) return localReason;

    const raw = await this.redis.get(`${CANCEL_KEY_PREFIX}${runId}`);
    const payload = parseCancelPayload(raw);
    if (!payload) return null;
    this.cancelledRuns.set(payload.runId, payload.reason);
    return payload.reason;
  }

  private async ensureGroup(): Promise<void> {
    try {
      await this.redis.xgroup('CREATE', STREAM_KEY, GROUP_NAME, '0', 'MKSTREAM');
      logger.info('created consumer group');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!message.includes('BUSYGROUP')) throw err;
    }
  }
}

function parseCancelPayload(raw: string | null | undefined): CancelPayload | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<CancelPayload>;
    const runId = typeof value.runId === 'string' ? value.runId.trim() : '';
    if (!runId) return null;
    const reason =
      typeof value.reason === 'string' && value.reason.trim()
        ? value.reason.trim()
        : DEFAULT_CANCEL_REASON;
    return { runId, reason };
  } catch {
    return null;
  }
}

function parseFields(fields: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < fields.length; i += 2) {
    result[fields[i]!] = fields[i + 1]!;
  }
  return result;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
