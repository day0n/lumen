import assert from 'node:assert/strict';
import test from 'node:test';

import {
  type JsonCachePort,
  type ParseSchema,
  createProjectQueryService,
  parseProjectListSearchParams,
} from '../src/index.ts';

interface ProjectListItem {
  id: string;
  title: string;
}

interface CacheWrite {
  key: string;
  ttlSeconds: number;
  value: unknown;
}

function passthroughSchema<T>(): ParseSchema<T> {
  return { parse: (value) => value as T };
}

function createMemoryCache(): JsonCachePort & {
  deleted: string[];
  reads: string[];
  writes: CacheWrite[];
} {
  const values = new Map<string, unknown>();
  const deleted: string[] = [];
  const reads: string[] = [];
  const writes: CacheWrite[] = [];
  return {
    deleted,
    reads,
    writes,
    async get<T>(key: string, schema: ParseSchema<T>) {
      reads.push(key);
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

test('project lists preserve the existing owner-scoped cache keys, TTL and limits', async () => {
  const cache = createMemoryCache();
  const repositoryCalls: unknown[] = [];
  const service = createProjectQueryService<ProjectListItem>({
    cache,
    getRepository: async () => ({
      async list(input) {
        repositoryCalls.push(input);
        return [{ id: `project-${input.limit}`, title: 'Project' }];
      },
    }),
    projectListSchema: passthroughSchema<ProjectListItem[]>(),
    tracePrefix: 'test',
  });

  assert.deepEqual(await service.listProjects('user/one'), [
    { id: 'project-50', title: 'Project' },
  ]);
  assert.deepEqual(await service.listProjects('user/one'), [
    { id: 'project-50', title: 'Project' },
  ]);
  assert.deepEqual(await service.listProjects('user/one', { limit: 3 }), [
    { id: 'project-3', title: 'Project' },
  ]);

  assert.deepEqual(repositoryCalls, [
    { ownerId: 'user/one', query: undefined, limit: 50 },
    { ownerId: 'user/one', query: undefined, limit: 3 },
  ]);
  assert.deepEqual(cache.reads, [
    'projects:user/one:list:limit:50:f::q:',
    'projects:user/one:list:limit:50:f::q:',
    'projects:user/one:list:limit:3:f::q:',
  ]);
  assert.deepEqual(cache.writes, [
    {
      key: 'projects:user/one:list:limit:50:f::q:',
      ttlSeconds: 30,
      value: [{ id: 'project-50', title: 'Project' }],
    },
    {
      key: 'projects:user/one:list:limit:3:f::q:',
      ttlSeconds: 30,
      value: [{ id: 'project-3', title: 'Project' }],
    },
  ]);
});

test('project search and folder filters bypass cache while preserving repository inputs', async () => {
  const cache = createMemoryCache();
  const repositoryCalls: unknown[] = [];
  const service = createProjectQueryService<ProjectListItem>({
    cache,
    getRepository: async () => ({
      async list(input) {
        repositoryCalls.push(input);
        return [];
      },
    }),
    projectListSchema: passthroughSchema<ProjectListItem[]>(),
    tracePrefix: 'test',
  });

  await service.listProjects('user-1', { limit: 3, query: '  launch .*  ' });
  await service.listProjects('user-1', { folderId: 'folder/one', limit: 50 });
  await service.listProjects('user-1', { limit: 10 });

  assert.deepEqual(repositoryCalls, [
    { ownerId: 'user-1', query: 'launch .*', limit: 3 },
    { ownerId: 'user-1', query: undefined, limit: 50, folderId: 'folder/one' },
    { ownerId: 'user-1', query: undefined, limit: 10 },
  ]);
  assert.deepEqual(cache.reads, []);
  assert.deepEqual(cache.writes, []);
});

test('project list invalidation deletes the same cached all-project views', async () => {
  const cache = createMemoryCache();
  const service = createProjectQueryService<ProjectListItem>({
    cache,
    getRepository: async () => ({
      async list() {
        return [];
      },
    }),
    projectListSchema: passthroughSchema<ProjectListItem[]>(),
    tracePrefix: 'test',
  });

  await service.invalidateProjectLists('user/one');

  assert.deepEqual(cache.deleted.toSorted(), [
    'projects:user/one:list:limit:3:f::q:',
    'projects:user/one:list:limit:50:f::q:',
  ]);
});

test('project write invalidation clears details and cached all-project views', async () => {
  const cache = createMemoryCache();
  const service = createProjectQueryService<ProjectListItem>({
    cache,
    getRepository: async () => ({
      async list() {
        return [];
      },
    }),
    projectListSchema: passthroughSchema<ProjectListItem[]>(),
    tracePrefix: 'test',
  });

  await service.invalidateProjects('user/one', ['project/one', 'project/two', 'project/one']);

  assert.deepEqual(cache.deleted.toSorted(), [
    'project:user/one:project/one',
    'project:user/one:project/two',
    'projects:user/one:list:limit:3:f::q:',
    'projects:user/one:list:limit:50:f::q:',
  ]);
});

test('project list query parsing preserves permissive parseInt and empty parameter behavior', () => {
  assert.deepEqual(
    parseProjectListSearchParams(
      new URLSearchParams('q=%20launch%20&limit=3.9items&folderId=%20folder-one%20'),
    ),
    { folderId: ' folder-one ', limit: 3, query: ' launch ' },
  );
  assert.deepEqual(
    parseProjectListSearchParams(new URLSearchParams('q=&limit=&folderId=%20%20&folderId=ignored')),
    { folderId: undefined, limit: undefined, query: '' },
  );
  assert.deepEqual(parseProjectListSearchParams(new URLSearchParams('folderId=uncategorized')), {
    folderId: 'uncategorized',
    limit: undefined,
    query: undefined,
  });
});

test('project query service rejects a blank actor before cache or repository access', async () => {
  const cache = createMemoryCache();
  let repositoryCalls = 0;
  const service = createProjectQueryService<ProjectListItem>({
    cache,
    getRepository: async () => {
      repositoryCalls += 1;
      return {
        async list() {
          return [];
        },
      };
    },
    projectListSchema: passthroughSchema<ProjectListItem[]>(),
    tracePrefix: 'test',
  });

  await assert.rejects(service.listProjects('  '), /actorUserId is required/);
  assert.equal(repositoryCalls, 0);
  assert.deepEqual(cache.reads, []);
});
