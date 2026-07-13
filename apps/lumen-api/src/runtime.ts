import { createHomeQueryService } from '@lumen/backend';
import {
  HomeFeaturedItemRecordSchema,
  HomeFeaturedRepository,
  HomeWorkflowTemplateListRecordSchema,
  HomeWorkflowTemplateRepository,
  JsonCache,
  closeMongoDatabases,
  closeRedisClients,
  getMongoDatabase,
  getRedisClient,
} from '@lumen/db';

import type { ReadinessChecks } from './app.js';
import type { ApiConfig } from './config.js';

export function createApiRuntime(config: ApiConfig) {
  const getDatabase = memoizeAsync(() =>
    getMongoDatabase({
      uri: config.mongoUri,
      dbName: config.mongoDb,
      appName: 'lumen-api',
    }),
  );
  const getFeaturedRepository = memoizeAsync(async () => {
    const repository = new HomeFeaturedRepository(await getDatabase());
    await repository.ensureIndexes();
    return repository;
  });
  const getTemplateRepository = memoizeAsync(async () => {
    const repository = new HomeWorkflowTemplateRepository(await getDatabase());
    await repository.ensureIndexes();
    return repository;
  });
  const redis = getRedisClient({
    url: config.redisUrl,
    keyPrefix: 'lumen:studio:',
  });
  const cache = new JsonCache(redis);

  const homeQueries = createHomeQueryService({
    cache,
    featuredListSchema: HomeFeaturedItemRecordSchema.array(),
    templateListSchema: HomeWorkflowTemplateListRecordSchema,
    getFeaturedRepository,
    getTemplateRepository,
    tracePrefix: 'api',
  });

  return {
    homeQueries,
    async readiness(): Promise<ReadinessChecks> {
      const checks: ReadinessChecks = { mongo: false };
      try {
        const database = await getDatabase();
        await database.command({ ping: 1 });
        await Promise.all([getFeaturedRepository(), getTemplateRepository()]);
        checks.mongo = true;
      } catch {
        checks.mongo = false;
      }
      if (redis) {
        checks.redis = false;
        try {
          checks.redis = (await redis.ping()) === 'PONG';
        } catch {
          checks.redis = false;
        }
      }
      return checks;
    },
    async close() {
      const results = await Promise.allSettled([closeRedisClients(), closeMongoDatabases()]);
      const errors = results.flatMap((result) =>
        result.status === 'rejected' ? [result.reason] : [],
      );
      if (errors.length > 0) {
        throw new AggregateError(errors, 'Failed to close API persistence clients');
      }
    },
  };
}

function memoizeAsync<T>(factory: () => Promise<T>): () => Promise<T> {
  let promise: Promise<T> | null = null;
  return () => {
    promise ??= factory().catch((error) => {
      promise = null;
      throw error;
    });
    return promise;
  };
}
