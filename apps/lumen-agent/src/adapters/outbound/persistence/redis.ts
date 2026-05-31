/**
 * Redis 连接（单例，可选）。
 *
 * 没配 REDIS_URL 时返回 null，session 直接走 Mongo（启动慢一点但能跑）。
 */

import Redis from 'ioredis';

import { getConfig } from '../../../bootstrap/config.js';
import { logger } from '../../../platform/logger.js';

let client: Redis | null = null;
let initialized = false;

export function getRedis(): Redis | null {
  if (initialized) return client;
  initialized = true;
  const cfg = getConfig();
  if (!cfg.REDIS_URL) {
    logger.warn('REDIS_URL 未配置，Session 将不使用 Redis 缓存（每次走 Mongo）');
    return null;
  }
  client = new Redis(cfg.REDIS_URL, {
    lazyConnect: false,
    maxRetriesPerRequest: 3,
  });
  client.on('error', (err) => {
    logger.error({ err }, 'Redis 错误');
  });
  client.on('connect', () => {
    logger.info({ url: cfg.REDIS_URL.replace(/\/\/[^@]+@/, '//***@') }, 'Redis 已连接');
  });
  return client;
}

export async function closeRedis(): Promise<void> {
  if (client) {
    await client.quit();
    client = null;
  }
}
