import {
  type ProjectCacheInvalidator,
  STUDIO_REDIS_KEY_PREFIX,
  createProjectCacheInvalidator,
} from '@lumen/shared/project-cache';

export function createEngineProjectCacheInvalidator(redis: {
  del(...keys: string[]): Promise<unknown>;
}): ProjectCacheInvalidator {
  return createProjectCacheInvalidator({
    cache: {
      async delete(key) {
        await redis.del(key);
      },
      async deleteMany(keys) {
        if (keys.length > 0) await redis.del(...keys);
      },
    },
    keyPrefix: STUDIO_REDIS_KEY_PREFIX,
  });
}
