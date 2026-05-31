import Redis from 'ioredis';
import type { z } from 'zod';

export type RedisClient = Redis;

export interface RedisConnectionOptions {
  url?: string;
  keyPrefix?: string;
}

type RedisCache = Map<string, Redis>;

const globalRedis = globalThis as typeof globalThis & {
  __lumenRedisClients?: RedisCache;
};

function getCache() {
  globalRedis.__lumenRedisClients ??= new Map<string, Redis>();
  return globalRedis.__lumenRedisClients;
}

export function getRedisClient(options: RedisConnectionOptions): Redis | null {
  const url = options.url?.trim();
  if (!url) return null;

  const key = `${options.keyPrefix ?? 'lumen'}:${url}`;
  const cache = getCache();
  const cached = cache.get(key);
  if (cached) return cached;

  const client = new Redis(url, {
    keyPrefix: options.keyPrefix,
    lazyConnect: false,
    maxRetriesPerRequest: 3,
  });

  cache.set(key, client);
  client.on('end', () => cache.delete(key));
  return client;
}

export async function closeRedisClients(): Promise<void> {
  const cache = getCache();
  const clients = [...cache.values()];
  cache.clear();
  await Promise.all(clients.map((client) => client.quit()));
}

export class JsonCache {
  constructor(private readonly redis: Redis | null) {}

  async get<TSchema extends z.ZodTypeAny>(
    key: string,
    schema: TSchema,
  ): Promise<z.infer<TSchema> | null> {
    if (!this.redis) return null;

    let raw: string | null;
    try {
      raw = await this.redis.get(key);
      if (!raw) return null;
    } catch {
      return null;
    }

    try {
      const parsedJson: unknown = JSON.parse(raw);
      return schema.parse(parsedJson);
    } catch {
      return null;
    }
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    } catch {}
  }

  async delete(key: string): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.del(key);
    } catch {}
  }

  async deletePattern(pattern: string, keyPrefix?: string): Promise<number> {
    if (!this.redis) return 0;
    const fullPattern = keyPrefix ? `${keyPrefix}${pattern}` : pattern;
    try {
      const keys = await this.redis.keys(fullPattern);
      if (keys.length === 0) return 0;
      // ioredis with keyPrefix re-prefixes on .del, strip prefix back to bare keys.
      const bare = keyPrefix ? keys.map((k) => k.replace(keyPrefix, '')) : keys;
      return this.redis.del(...bare);
    } catch {
      return 0;
    }
  }
}
