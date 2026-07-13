import assert from 'node:assert/strict';
import test from 'node:test';

import {
  type JsonCachePort,
  type ParseSchema,
  type WorkflowNodeResultSnapshot,
  createProjectDetailQueryService,
  reconcileCanvasWithWorkflowResults,
} from '../src/index.ts';

interface TestCanvas {
  nodes: Array<{ id: string; data: Record<string, unknown> }>;
  edges: unknown[];
}

interface TestProject {
  id: string;
  ownerId: string;
  canvas: TestCanvas;
}

interface CacheWrite {
  key: string;
  value: unknown;
  ttlSeconds: number;
}

function passthroughSchema<T>(): ParseSchema<T> {
  return { parse: (value) => value as T };
}

function createMemoryCache(initial: Record<string, unknown> = {}): JsonCachePort & {
  deletes: string[];
  reads: string[];
  writes: CacheWrite[];
} {
  const values = new Map(Object.entries(initial));
  const deletes: string[] = [];
  const reads: string[] = [];
  const writes: CacheWrite[] = [];
  return {
    deletes,
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
      deletes.push(key);
      values.delete(key);
    },
  };
}

function project(id = 'project-one'): TestProject {
  return {
    id,
    ownerId: 'user-one',
    canvas: { nodes: [{ id: 'node-one', data: { status: 'idle' } }], edges: [] },
  };
}

function result(
  input: Partial<WorkflowNodeResultSnapshot> &
    Pick<WorkflowNodeResultSnapshot, 'nodeId' | 'status'>,
): WorkflowNodeResultSnapshot {
  return {
    runId: 'run-one',
    output: null,
    error: null,
    progress: 0,
    updatedAt: '2026-07-13T00:00:00.000Z',
    ...input,
  };
}

test('detail reads use owner-scoped cache keys and preserve the 30 second TTL', async () => {
  const cache = createMemoryCache();
  const repositoryCalls: unknown[] = [];
  const source = project();
  const service = createProjectDetailQueryService<TestCanvas, TestProject>({
    cache,
    getProjectRepository: async () => ({
      async get(ownerId, projectId) {
        repositoryCalls.push({ ownerId, projectId });
        return source;
      },
    }),
    getWorkflowNodeResultRepository: async () => ({
      async getLatestNodeResultsForProject() {
        throw new Error('idle canvases must not query workflow results');
      },
    }),
    projectDetailSchema: passthroughSchema<TestProject>(),
    tracePrefix: 'test',
  });

  assert.equal(await service.getProject('user-one', 'project-one'), source);
  assert.equal(await service.getProject('user-one', 'project-one'), source);
  assert.deepEqual(repositoryCalls, [{ ownerId: 'user-one', projectId: 'project-one' }]);
  assert.deepEqual(cache.reads, ['project:user-one:project-one', 'project:user-one:project-one']);
  assert.deepEqual(cache.writes, [
    { key: 'project:user-one:project-one', value: source, ttlSeconds: 30 },
  ]);
});

test('fresh detail reads bypass cache reads but still refresh successful values', async () => {
  const stale = project();
  stale.id = 'stale';
  const fresh = project();
  const cache = createMemoryCache({ 'project:user-one:project-one': stale });
  const service = createProjectDetailQueryService<TestCanvas, TestProject>({
    cache,
    getProjectRepository: async () => ({
      async get() {
        return fresh;
      },
    }),
    getWorkflowNodeResultRepository: async () => ({
      async getLatestNodeResultsForProject() {
        return [];
      },
    }),
    projectDetailSchema: passthroughSchema<TestProject>(),
    tracePrefix: 'test',
  });

  assert.equal(await service.getProject('user-one', 'project-one', { bypassCache: true }), fresh);
  assert.deepEqual(cache.reads, []);
  assert.deepEqual(cache.writes, [
    { key: 'project:user-one:project-one', value: fresh, ttlSeconds: 30 },
  ]);
});

test('missing projects are not cached', async () => {
  const cache = createMemoryCache();
  const service = createProjectDetailQueryService<TestCanvas, TestProject>({
    cache,
    getProjectRepository: async () => ({
      async get() {
        return null;
      },
    }),
    getWorkflowNodeResultRepository: async () => ({
      async getLatestNodeResultsForProject() {
        return [];
      },
    }),
    projectDetailSchema: passthroughSchema<TestProject>(),
    tracePrefix: 'test',
  });

  assert.equal(await service.getProject('user-one', 'missing'), null);
  assert.deepEqual(cache.writes, []);
});

test('fresh missing reads remove stale detail values before returning null', async () => {
  const cache = createMemoryCache({ 'project:user-one:missing': project('missing') });
  const service = createProjectDetailQueryService<TestCanvas, TestProject>({
    cache,
    getProjectRepository: async () => ({
      async get() {
        return null;
      },
    }),
    getWorkflowNodeResultRepository: async () => ({
      async getLatestNodeResultsForProject() {
        return [];
      },
    }),
    projectDetailSchema: passthroughSchema<TestProject>(),
    tracePrefix: 'test',
  });

  assert.equal(await service.getProject('user-one', 'missing', { bypassCache: true }), null);
  assert.deepEqual(cache.reads, []);
  assert.deepEqual(cache.deletes, ['project:user-one:missing']);
  assert.deepEqual(cache.writes, []);
});

test('mismatched cache identities are discarded and repository identities are enforced', async () => {
  const wrongCachedOwner = project('project-one');
  wrongCachedOwner.ownerId = 'user-two';
  const cache = createMemoryCache({ 'project:user-one:project-one': wrongCachedOwner });
  const correct = project('project-one');
  const service = createProjectDetailQueryService<TestCanvas, TestProject>({
    cache,
    getProjectRepository: async () => ({
      async get() {
        return correct;
      },
    }),
    getWorkflowNodeResultRepository: async () => ({
      async getLatestNodeResultsForProject() {
        return [];
      },
    }),
    projectDetailSchema: passthroughSchema<TestProject>(),
    tracePrefix: 'test',
  });

  assert.equal(await service.getProject('user-one', 'project-one'), correct);
  assert.deepEqual(cache.deletes, ['project:user-one:project-one']);

  const wrongCachedId = project('project-two');
  const idCache = createMemoryCache({ 'project:user-one:project-one': wrongCachedId });
  const idService = createProjectDetailQueryService<TestCanvas, TestProject>({
    cache: idCache,
    getProjectRepository: async () => ({
      async get() {
        return correct;
      },
    }),
    getWorkflowNodeResultRepository: async () => ({
      async getLatestNodeResultsForProject() {
        return [];
      },
    }),
    projectDetailSchema: passthroughSchema<TestProject>(),
    tracePrefix: 'test',
  });
  assert.equal(await idService.getProject('user-one', 'project-one'), correct);
  assert.deepEqual(idCache.deletes, ['project:user-one:project-one']);

  const crossedBoundary = project('project-two');
  crossedBoundary.ownerId = 'user-two';
  const unsafeService = createProjectDetailQueryService<TestCanvas, TestProject>({
    cache: createMemoryCache(),
    getProjectRepository: async () => ({
      async get() {
        return crossedBoundary;
      },
    }),
    getWorkflowNodeResultRepository: async () => ({
      async getLatestNodeResultsForProject() {
        return [];
      },
    }),
    projectDetailSchema: passthroughSchema<TestProject>(),
    tracePrefix: 'test',
  });

  await assert.rejects(unsafeService.getProject('user-one', 'project-one'), /identity boundary/);
});

test('reconciliation skips workflow storage when no node can change', async () => {
  const canvas: TestCanvas = {
    nodes: [
      { id: 'idle', data: { status: 'idle' } },
      { id: 'complete', data: { status: 'success', output: 'ready' } },
    ],
    edges: [],
  };
  let calls = 0;

  const reconciled = await reconcileCanvasWithWorkflowResults('project-one', canvas, async () => {
    calls += 1;
    return [];
  });

  assert.equal(reconciled, canvas);
  assert.equal(calls, 0);
});

test('reconciliation deduplicates candidate ids and keeps unchanged canvas references', async () => {
  const canvas: TestCanvas = {
    nodes: [
      { id: 'duplicate', data: { status: 'queued' } },
      { id: 'duplicate', data: { status: 'running' } },
    ],
    edges: [],
  };
  const calls: unknown[] = [];

  const reconciled = await reconcileCanvasWithWorkflowResults(
    'project-one',
    canvas,
    async (projectId, nodeIds) => {
      calls.push({ projectId, nodeIds });
      return [];
    },
  );

  assert.equal(reconciled, canvas);
  assert.deepEqual(calls, [{ projectId: 'project-one', nodeIds: ['duplicate'] }]);
});

test('terminal workflow states preserve the existing public canvas contract', async () => {
  const canvas: TestCanvas = {
    nodes: [
      {
        id: 'success',
        data: {
          status: 'running',
          errorCode: 500,
          errorName: 'old',
          errorI18nKey: 'old.key',
          retryable: true,
          attempts: 2,
        },
      },
      { id: 'failed', data: { status: 'running', output: 'old' } },
      { id: 'cancelled', data: { status: 'queued', output: 'keep' } },
      { id: 'unknown', data: { status: 'running' } },
    ],
    edges: [],
  };

  const reconciled = await reconcileCanvasWithWorkflowResults('project-one', canvas, async () => [
    result({ nodeId: 'success', status: 'success', output: 'https://asset/success' }),
    result({
      nodeId: 'failed',
      status: 'failed',
      error: 'failed publicly',
      errorCode: 429,
      errorName: 'RATE_LIMITED',
      errorI18nKey: 'errors.rateLimited',
      retryable: true,
      attempts: 3,
    }),
    result({ nodeId: 'cancelled', status: 'cancelled' }),
    result({ nodeId: 'unknown', status: 'running', output: 'ignored' }),
  ]);

  assert.notEqual(reconciled, canvas);
  assert.deepEqual(reconciled.nodes[0]?.data, {
    status: 'success',
    output: 'https://asset/success',
    error: null,
    activeRunId: null,
    progress: 1,
  });
  assert.deepEqual(reconciled.nodes[1]?.data, {
    status: 'error',
    output: null,
    error: 'failed publicly',
    activeRunId: null,
    errorCode: 429,
    errorName: 'RATE_LIMITED',
    errorI18nKey: 'errors.rateLimited',
    retryable: true,
    attempts: 3,
    progress: 1,
  });
  assert.deepEqual(reconciled.nodes[2]?.data, {
    status: 'cancelled',
    output: 'keep',
    error: 'cancelled',
    activeRunId: null,
    progress: 0,
  });
  assert.equal(reconciled.nodes[3], canvas.nodes[3]);
});

test('detail queries reconcile both cached and database projects but only cache database reads', async () => {
  const cached = project('cached');
  cached.canvas.nodes[0] = { id: 'cached-node', data: { status: 'running' } };
  const cache = createMemoryCache({ 'project:user-one:cached': cached });
  const workflowCalls: unknown[] = [];
  const service = createProjectDetailQueryService<TestCanvas, TestProject>({
    cache,
    getProjectRepository: async () => ({
      async get() {
        return project('database');
      },
    }),
    getWorkflowNodeResultRepository: async () => ({
      async getLatestNodeResultsForProject(projectId, nodeIds) {
        workflowCalls.push({ projectId, nodeIds });
        return [result({ nodeId: nodeIds[0] ?? '', status: 'success', output: 'done' })];
      },
    }),
    projectDetailSchema: passthroughSchema<TestProject>(),
    tracePrefix: 'test',
  });

  const reconciledCached = await service.getProject('user-one', 'cached');
  assert.equal(reconciledCached?.canvas.nodes[0]?.data.output, 'done');
  assert.deepEqual(cache.writes, []);

  const database = project('database');
  database.canvas.nodes[0] = { id: 'database-node', data: { status: 'queued' } };
  const databaseService = createProjectDetailQueryService<TestCanvas, TestProject>({
    cache,
    getProjectRepository: async () => ({
      async get() {
        return database;
      },
    }),
    getWorkflowNodeResultRepository: async () => ({
      async getLatestNodeResultsForProject(projectId, nodeIds) {
        workflowCalls.push({ projectId, nodeIds });
        return [result({ nodeId: 'database-node', status: 'success', output: 'stored' })];
      },
    }),
    projectDetailSchema: passthroughSchema<TestProject>(),
    tracePrefix: 'test',
  });
  const reconciledDatabase = await databaseService.getProject('user-one', 'database');

  assert.equal(reconciledDatabase?.canvas.nodes[0]?.data.output, 'stored');
  assert.equal(cache.writes.length, 1);
  assert.equal(cache.writes[0]?.key, 'project:user-one:database');
  assert.equal((cache.writes[0]?.value as TestProject).canvas.nodes[0]?.data.output, 'stored');
  assert.deepEqual(workflowCalls, [
    { projectId: 'cached', nodeIds: ['cached-node'] },
    { projectId: 'database', nodeIds: ['database-node'] },
  ]);
});

test('workflow reconciliation failures propagate without caching partial project details', async () => {
  const cache = createMemoryCache();
  const running = project();
  running.canvas.nodes[0] = { id: 'running-node', data: { status: 'running' } };
  const failure = new Error('workflow query unavailable');
  const service = createProjectDetailQueryService<TestCanvas, TestProject>({
    cache,
    getProjectRepository: async () => ({
      async get() {
        return running;
      },
    }),
    getWorkflowNodeResultRepository: async () => ({
      async getLatestNodeResultsForProject() {
        throw failure;
      },
    }),
    projectDetailSchema: passthroughSchema<TestProject>(),
    tracePrefix: 'test',
  });

  await assert.rejects(service.getProject('user-one', 'project-one'), (error) => error === failure);
  assert.deepEqual(cache.writes, []);
});

test('detail queries reject blank actor and project ids before touching dependencies', async () => {
  const cache = createMemoryCache();
  let repositoryCalls = 0;
  const service = createProjectDetailQueryService<TestCanvas, TestProject>({
    cache,
    getProjectRepository: async () => {
      repositoryCalls += 1;
      return {
        async get() {
          return null;
        },
      };
    },
    getWorkflowNodeResultRepository: async () => ({
      async getLatestNodeResultsForProject() {
        return [];
      },
    }),
    projectDetailSchema: passthroughSchema<TestProject>(),
    tracePrefix: 'test',
  });

  await assert.rejects(service.getProject('  ', 'project-one'), /actorUserId is required/);
  await assert.rejects(service.getProject('user-one', '  '), /projectId is required/);
  assert.equal(repositoryCalls, 0);
  assert.deepEqual(cache.reads, []);
});
