import Redis from 'ioredis';

export type RedisClient = Redis;

export interface ValueSchema<T> {
  parse(value: unknown): T;
}

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

  // ioredis 要求必须监听 'error'，否则连接出错时 EventEmitter 会抛
  // uncaughtException 直接杀进程。这里吞掉并记录，让 ioredis 自行重连。
  client.on('error', (err) => {
    console.error('[redis] client error', err);
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

  async get<T>(key: string, schema: ValueSchema<T>): Promise<T | null> {
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

  async deleteMany(keys: readonly string[]): Promise<void> {
    if (!this.redis || keys.length === 0) return;
    try {
      await this.redis.del(...keys);
    } catch {}
  }

  async deletePattern(pattern: string, keyPrefix?: string): Promise<number> {
    if (!this.redis) return 0;
    const fullPattern = keyPrefix ? `${keyPrefix}${pattern}` : pattern;
    // Use SCAN, not KEYS. KEYS is O(N) over the full keyspace and blocks
    // the Redis server until it returns. With patterns like
    // `hot-videos:list:*` or `materials:${ownerId}:list:v1:*` we cannot
    // bound N — every concurrent request waits behind it. Many managed
    // Redis providers also disable KEYS by policy. SCAN is incremental
    // and non-blocking: small bounded batches per RTT, server stays
    // responsive to other clients.
    let total = 0;
    let cursor = '0';
    try {
      do {
        const [next, batch] = await this.redis.scan(cursor, 'MATCH', fullPattern, 'COUNT', 200);
        cursor = next;
        if (batch.length > 0) {
          // ioredis with keyPrefix re-prefixes on .del; strip back to bare keys.
          const bare = keyPrefix ? batch.map((k) => k.replace(keyPrefix, '')) : batch;
          total += await this.redis.del(...bare);
        }
      } while (cursor !== '0');
      return total;
    } catch {
      return total;
    }
  }
}
