import assert from 'node:assert/strict';
import test from 'node:test';
import type { Db } from 'mongodb';

import type { ProjectCacheInvalidator } from '@lumen/shared/project-cache';

import { logger } from '../../../platform/logger.js';
import { ProjectWorkflowStore, createAgentProjectCacheInvalidator } from './projectStore.js';

const currentDocument = {
  _id: 'project-1',
  owner_id: 'user-1',
  title: 'Before',
  canvas: { edges: [], nodes: [] },
  updated_at: new Date('2026-01-01T00:00:00.000Z'),
};

const updatedDocument = {
  ...currentDocument,
  title: 'After',
  updated_at: new Date('2026-01-02T00:00:00.000Z'),
};

function createStore(
  updateResults: Array<Error | typeof updatedDocument | null>,
  projectCacheOverride?: ProjectCacheInvalidator,
  historyOverride?: Record<string, unknown>,
) {
  const deleted: string[] = [];
  const deleteBatches: string[][] = [];
  const projects = {
    async findOne() {
      return currentDocument;
    },
    async findOneAndUpdate() {
      const result = updateResults.shift() ?? null;
      if (result instanceof Error) throw result;
      return result;
    },
  };
  const history = historyOverride ?? {};
  const db = {
    collection(name: string) {
      if (name === 'studio_projects') return projects;
      if (name === 'studio_project_history') return history;
      throw new Error(`unexpected collection: ${name}`);
    },
  } as unknown as Db;
  const projectCache = createAgentProjectCacheInvalidator({
    async del(...keys) {
      deleteBatches.push(keys);
      deleted.push(...keys);
      return keys.length;
    },
  });
  return {
    deleteBatches,
    deleted,
    store: new ProjectWorkflowStore(db, projectCacheOverride ?? projectCache),
  };
}

test('canvas and node writes invalidate project detail and both list caches', async () => {
  const { deleteBatches, deleted, store } = createStore([updatedDocument, updatedDocument]);

  const canvasResult = await store.updateCanvas({
    canvas: { edges: [], nodes: [] },
    projectId: 'project-1',
    recordHistory: false,
    userId: 'user-1',
  });
  const nodeResult = await store.patchNodeData({
    nodeId: 'node-1',
    patch: { output: 'done' },
    projectId: 'project-1',
    userId: 'user-1',
  });

  assert.ok(canvasResult);
  assert.ok(nodeResult);
  assert.deepEqual(deleted, [
    'lumen:studio:project:user-1:project-1',
    'lumen:studio:projects:user-1:list:limit:3:f::q:',
    'lumen:studio:projects:user-1:list:limit:50:f::q:',
    'lumen:studio:project:user-1:project-1',
    'lumen:studio:projects:user-1:list:limit:3:f::q:',
    'lumen:studio:projects:user-1:list:limit:50:f::q:',
  ]);
  assert.deepEqual(
    deleteBatches.map((batch) => batch.length),
    [3, 3],
  );
});

test('unmatched canvas and node writes do not invalidate project caches', async () => {
  const { deleted, store } = createStore([null, null]);

  assert.equal(
    await store.updateCanvas({
      canvas: { edges: [], nodes: [] },
      projectId: 'project-1',
      recordHistory: false,
      userId: 'user-1',
    }),
    null,
  );
  assert.equal(
    await store.patchNodeData({
      nodeId: 'node-1',
      patch: { output: 'done' },
      projectId: 'project-1',
      userId: 'user-1',
    }),
    null,
  );

  assert.deepEqual(deleted, []);
});

test('cache invalidation failures warn without disguising a successful Mongo write', async (context) => {
  const warnings: unknown[][] = [];
  context.mock.method(
    logger as unknown as { warn: (...args: unknown[]) => void },
    'warn',
    (...args: unknown[]) => {
      warnings.push(args);
    },
  );
  const { store } = createStore([updatedDocument], {
    async invalidateProject() {
      throw new Error('redis unavailable');
    },
    async invalidateProjectLists() {},
    async invalidateProjects() {},
  });

  const result = await store.updateCanvas({
    canvas: { edges: [], nodes: [] },
    projectId: 'project-1',
    recordHistory: false,
    userId: 'user-1',
  });

  assert.ok(result);
  assert.equal(result.project.title, 'After');
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0]?.[1], 'failed to invalidate project caches');
});

test('Mongo canvas and node write failures do not invalidate project caches', async () => {
  const canvasFailure = createStore([new Error('canvas write failed')]);
  await assert.rejects(
    canvasFailure.store.updateCanvas({
      canvas: { edges: [], nodes: [] },
      projectId: 'project-1',
      recordHistory: false,
      userId: 'user-1',
    }),
    /canvas write failed/,
  );
  assert.deepEqual(canvasFailure.deleted, []);

  const nodeFailure = createStore([new Error('node write failed')]);
  await assert.rejects(
    nodeFailure.store.patchNodeData({
      nodeId: 'node-1',
      patch: { output: 'done' },
      projectId: 'project-1',
      userId: 'user-1',
    }),
    /node write failed/,
  );
  assert.deepEqual(nodeFailure.deleted, []);
});

test('history insert failures escape only after the committed canvas write is invalidated', async () => {
  const historyFailure = new Error('history insert failed');
  const { deleted, store } = createStore([updatedDocument], undefined, {
    async insertOne() {
      throw historyFailure;
    },
  });

  await assert.rejects(
    store.updateCanvas({
      canvas: { edges: [], nodes: [] },
      projectId: 'project-1',
      userId: 'user-1',
    }),
    (error) => error === historyFailure,
  );

  assert.deepEqual(deleted, [
    'lumen:studio:project:user-1:project-1',
    'lumen:studio:projects:user-1:list:limit:3:f::q:',
    'lumen:studio:projects:user-1:list:limit:50:f::q:',
  ]);
});

test('history prune failures escape only after the committed canvas write is invalidated', async () => {
  const pruneFailure = new Error('history prune failed');
  const { deleted, store } = createStore([updatedDocument], undefined, {
    find() {
      throw pruneFailure;
    },
    async insertOne() {},
  });

  await assert.rejects(
    store.updateCanvas({
      canvas: { edges: [], nodes: [] },
      projectId: 'project-1',
      userId: 'user-1',
    }),
    (error) => error === pruneFailure,
  );

  assert.deepEqual(deleted, [
    'lumen:studio:project:user-1:project-1',
    'lumen:studio:projects:user-1:list:limit:3:f::q:',
    'lumen:studio:projects:user-1:list:limit:50:f::q:',
  ]);
});
