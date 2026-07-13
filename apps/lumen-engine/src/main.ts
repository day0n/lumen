// ⚠ 必须第一行：Sentry.init 要早于任何 SDK / HTTP 库被 import 才能自动埋点。
import './instrument.js';

import Redis from 'ioredis';
import { config } from './config.js';
import { StreamConsumer } from './consumer.js';
import { closeMongo, getWorkflowStore } from './database/mongo.js';
import { RemakeStreamConsumer } from './remake-consumer.js';
import { logger } from './utils/logger.js';

async function main() {
  logger.info({ port: config.PORT }, 'lumen-engine starting...');

  const commandRedis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
  const remakeRedis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });

  commandRedis.on('connect', () => logger.info('command redis connected'));
  commandRedis.on('error', (err) => logger.error({ err }, 'command redis error'));
  remakeRedis.on('connect', () => logger.info('remake command redis connected'));
  remakeRedis.on('error', (err) => logger.error({ err }, 'remake command redis error'));

  const workflowStore = await getWorkflowStore();
  const consumer = new StreamConsumer(commandRedis, workflowStore);
  const remakeConsumer = new RemakeStreamConsumer(remakeRedis);

  const shutdown = async () => {
    logger.info('shutting down...');
    consumer.stop();
    remakeConsumer.stop();
    await commandRedis.quit();
    await remakeRedis.quit();
    await closeMongo();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // 两个 consumer 并行跑，互不阻塞。
  await Promise.all([consumer.start(), remakeConsumer.start()]);
}

main().catch((err) => {
  logger.fatal({ err }, 'engine crashed');
  process.exit(1);
});
