import assert from 'node:assert/strict';
import test from 'node:test';

import {
  type JsonCachePort,
  type ParseSchema,
  createHomeQueryService,
} from '../src/home-query-service.ts';

function passthroughSchema<T>(): ParseSchema<T> {
  return { parse: (value) => value as T };
}

interface CacheWrite {
  key: string;
  ttlSeconds: number;
  value: unknown;
}

function createMemoryCache(): JsonCachePort & { deleted: string[]; writes: CacheWrite[] } {
  const values = new Map<string, unknown>();
  const deleted: string[] = [];
  const writes: CacheWrite[] = [];
  return {
    deleted,
    writes,
    async get<T>(key: string, schema: ParseSchema<T>) {
      return values.has(key) ? schema.parse(values.get(key)) : null;
    },
    async set(key, value, ttlSeconds) {
      writes.push({ key, value, ttlSeconds });
      values.set(key, value);
    },
    async delete(key) {
      deleted.push(key);
      values.delete(key);
    },
  };
}

test('featured queries preserve cache keys, limits and locale', async () => {
  const cache = createMemoryCache();
  const calls: Array<{ limit: number; locale: string }> = [];
  const service = createHomeQueryService({
    cache,
    featuredListSchema: passthroughSchema<Array<{ id: string }>>(),
    templateListSchema: passthroughSchema<{ items: unknown[] }>(),
    getFeaturedRepository: async () => ({
      async listActive(limit, locale) {
        calls.push({ limit, locale });
        return [{ id: 'featured-1' }];
      },
    }),
    getTemplateRepository: async () => ({
      async listActive() {
        return { items: [] };
      },
    }),
    tracePrefix: 'test',
  });

  assert.deepEqual(await service.listFeatured('zh'), [{ id: 'featured-1' }]);
  assert.deepEqual(await service.listFeatured('zh'), [{ id: 'featured-1' }]);
  assert.deepEqual(calls, [{ limit: 12, locale: 'zh' }]);
  assert.deepEqual(cache.writes, [
    {
      key: 'home:featured:v2:zh',
      value: [{ id: 'featured-1' }],
      ttlSeconds: 300,
    },
  ]);

  await service.invalidateFeatured();
  assert.deepEqual(cache.deleted, ['home:featured:v2:en', 'home:featured:v2:zh']);
});

test('template queries preserve the per-category limit', async () => {
  const cache = createMemoryCache();
  const calls: Array<{ locale: string; perCategory: number }> = [];
  const service = createHomeQueryService({
    cache,
    featuredListSchema: passthroughSchema<unknown[]>(),
    templateListSchema: passthroughSchema<{ items: Array<{ id: string }> }>(),
    getFeaturedRepository: async () => ({
      async listActive() {
        return [];
      },
    }),
    getTemplateRepository: async () => ({
      async listActive(options) {
        calls.push(options);
        return { items: [{ id: 'template-1' }] };
      },
    }),
    tracePrefix: 'test',
  });

  assert.deepEqual(await service.listTemplates('en'), { items: [{ id: 'template-1' }] });
  assert.deepEqual(await service.listTemplates('en'), { items: [{ id: 'template-1' }] });
  assert.deepEqual(calls, [{ locale: 'en', perCategory: 9 }]);
  assert.deepEqual(cache.writes, [
    {
      key: 'home:workflow-templates:v1:en',
      value: { items: [{ id: 'template-1' }] },
      ttlSeconds: 300,
    },
  ]);

  await service.invalidateTemplates();
  assert.deepEqual(cache.deleted, [
    'home:workflow-templates:v1:en',
    'home:workflow-templates:v1:zh',
  ]);
});
