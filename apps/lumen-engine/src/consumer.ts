import { ClientMessageSchema } from '@lumen/shared/protocols';
import * as Sentry from '@sentry/node';
import type Redis from 'ioredis';
import type { WorkflowStore } from './database/workflow-store.js';
import { WorkflowExecutor } from './engine/executor.js';
import { EventPublisher } from './publisher.js';
import { logger } from './utils/logger.js';

const STREAM_KEY = 'lumen:flow:tasks';
const GROUP_NAME = 'engine-group';
const CONSUMER_NAME = `engine-${process.pid}`;

export class StreamConsumer {
  private running = false;
  private executor: WorkflowExecutor;

  constructor(
    private redis: Redis,
    workflowStore: WorkflowStore,
  ) {
    const publisher = new EventPublisher(redis);
    this.executor = new WorkflowExecutor(publisher, workflowStore);
  }

  async start(): Promise<void> {
    await this.ensureGroup();
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
          try {
            const payload = JSON.parse(data.payload ?? '{}');
            const message = ClientMessageSchema.parse(payload);

            logger.info({ messageId, nodeIds: message.nodeIds }, 'processing task');
            await this.executor.execute(message, channelId);
          } catch (err) {
            logger.error({ err, messageId }, 'task execution failed');
          } finally {
            await this.redis.xack(STREAM_KEY, GROUP_NAME, messageId);
          }
        },
      );

    await runProcessing();
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
