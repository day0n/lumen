import Redis from 'ioredis';
import { config } from './config.js';
import { StreamConsumer } from './consumer.js';
import { closeMongo, getWorkflowStore } from './database/mongo.js';
import { logger } from './utils/logger.js';

async function main() {
  logger.info({ port: config.PORT }, 'lumen-engine starting...');

  const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });

  redis.on('connect', () => logger.info('redis connected'));
  redis.on('error', (err) => logger.error({ err }, 'redis error'));

  const workflowStore = await getWorkflowStore();
  const consumer = new StreamConsumer(redis, workflowStore);

  const shutdown = async () => {
    logger.info('shutting down...');
    consumer.stop();
    await redis.quit();
    await closeMongo();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await consumer.start();
}

main().catch((err) => {
  logger.fatal({ err }, 'engine crashed');
  process.exit(1);
});
