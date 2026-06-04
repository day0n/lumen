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

  const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
  // remake consumer 用独立 Redis 客户端跑 XREADGROUP，避免和 workflow consumer
  // 阻塞读冲突（同一连接不能同时挂在两个 BLOCK 调用上）。
  const remakeRedis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });

  redis.on('connect', () => logger.info('redis connected'));
  redis.on('error', (err) => logger.error({ err }, 'redis error'));
  remakeRedis.on('error', (err) => logger.error({ err }, 'remake redis error'));

  const workflowStore = await getWorkflowStore();
  const consumer = new StreamConsumer(redis, workflowStore);
  const remakeConsumer = new RemakeStreamConsumer(remakeRedis);

  const shutdown = async () => {
    logger.info('shutting down...');
    consumer.stop();
    remakeConsumer.stop();
    await redis.quit();
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
