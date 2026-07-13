import assert from 'node:assert/strict';
import test from 'node:test';

import type { ProjectCacheInvalidator } from '@lumen/shared/project-cache';
import type { Db } from 'mongodb';

import { logger } from '../utils/logger.js';
import { updateProjectSnapshotFromRun, writeProjectThumbnail } from './project-snapshot.js';

function createProjectCache(
  invalidateProject: ProjectCacheInvalidator['invalidateProject'],
): ProjectCacheInvalidator {
  return {
    invalidateProject,
    async invalidateProjectLists() {
      throw new Error('unexpected list-only invalidation');
    },
    async invalidateProjects() {
      throw new Error('unexpected bulk invalidation');
    },
  };
}

test('project thumbnail writes are owner scoped and use the active-project filter', async () => {
  const calls: Array<{ filter: unknown; update: unknown }> = [];
  const db = {
    collection(name: string) {
      assert.equal(name, 'studio_projects');
      return {
        async updateOne(filter: unknown, update: unknown) {
          calls.push({ filter, update });
          return { matchedCount: 1, modifiedCount: 0 };
        },
      };
    },
  } as unknown as Pick<Db, 'collection'>;

  assert.equal(
    await writeProjectThumbnail({
      db,
      projectId: 'project-1',
      snapshotUrl: 'https://cdn.example/snapshot.jpg',
      userId: 'user-1',
    }),
    true,
  );
  assert.deepEqual(calls, [
    {
      filter: {
        _id: 'project-1',
        owner_id: 'user-1',
        deleted_at: { $exists: false },
      },
      update: { $set: { thumbnail: 'https://cdn.example/snapshot.jpg' } },
    },
  ]);
});

test('project thumbnail writes report an owner mismatch without hiding database failures', async () => {
  const missingDb = {
    collection() {
      return {
        async updateOne() {
          return { matchedCount: 0, modifiedCount: 0 };
        },
      };
    },
  } as unknown as Pick<Db, 'collection'>;
  assert.equal(
    await writeProjectThumbnail({
      db: missingDb,
      projectId: 'project-1',
      snapshotUrl: 'https://cdn.example/snapshot.jpg',
      userId: 'user-1',
    }),
    false,
  );

  const failure = new Error('write failed');
  const failingDb = {
    collection() {
      return {
        async updateOne() {
          throw failure;
        },
      };
    },
  } as unknown as Pick<Db, 'collection'>;
  await assert.rejects(
    writeProjectThumbnail({
      db: failingDb,
      projectId: 'project-1',
      snapshotUrl: 'https://cdn.example/snapshot.jpg',
      userId: 'user-1',
    }),
    (error: unknown) => {
      assert.equal(error, failure);
      return true;
    },
  );
});

test('successful snapshot writes invalidate the owner project', async () => {
  const invalidations: Array<{ actorUserId: string; projectId: string }> = [];
  const db = {
    collection() {
      return {
        async updateOne() {
          return { matchedCount: 1, modifiedCount: 0 };
        },
      };
    },
  } as unknown as Pick<Db, 'collection'>;

  await updateProjectSnapshotFromRun(
    {
      candidate: { type: 'image', url: 'https://cdn.example/snapshot.jpg' },
      projectId: 'project-1',
      userId: 'user-1',
    },
    {
      async getStudioDatabase() {
        return db;
      },
      projectCache: createProjectCache(async (actorUserId, projectId) => {
        invalidations.push({ actorUserId, projectId });
      }),
    },
  );

  assert.deepEqual(invalidations, [{ actorUserId: 'user-1', projectId: 'project-1' }]);
});

test('unmatched snapshot writes do not invalidate project caches', async () => {
  let invalidations = 0;
  const db = {
    collection() {
      return {
        async updateOne() {
          return { matchedCount: 0, modifiedCount: 0 };
        },
      };
    },
  } as unknown as Pick<Db, 'collection'>;

  await updateProjectSnapshotFromRun(
    {
      candidate: { type: 'image', url: 'https://cdn.example/snapshot.jpg' },
      projectId: 'project-1',
      userId: 'user-1',
    },
    {
      async getStudioDatabase() {
        return db;
      },
      projectCache: createProjectCache(async () => {
        invalidations += 1;
      }),
    },
  );

  assert.equal(invalidations, 0);
});

test('snapshot database failures preserve the original error without invalidating caches', async () => {
  const writeFailure = new Error('snapshot write failed');
  let invalidations = 0;
  const db = {
    collection() {
      return {
        async updateOne() {
          throw writeFailure;
        },
      };
    },
  } as unknown as Pick<Db, 'collection'>;

  await assert.rejects(
    updateProjectSnapshotFromRun(
      {
        candidate: { type: 'image', url: 'https://cdn.example/snapshot.jpg' },
        projectId: 'project-1',
        userId: 'user-1',
      },
      {
        async getStudioDatabase() {
          return db;
        },
        projectCache: createProjectCache(async () => {
          invalidations += 1;
        }),
      },
    ),
    (error) => error === writeFailure,
  );

  assert.equal(invalidations, 0);
});

test('missing owners and empty snapshots skip database writes and cache invalidation', async () => {
  let databaseReads = 0;
  let invalidations = 0;
  const dependencies = {
    async getStudioDatabase(): Promise<Pick<Db, 'collection'>> {
      databaseReads += 1;
      throw new Error('unexpected database read');
    },
    projectCache: createProjectCache(async () => {
      invalidations += 1;
    }),
  };

  await updateProjectSnapshotFromRun(
    {
      candidate: { type: 'image', url: 'https://cdn.example/snapshot.jpg' },
      projectId: 'project-1',
      userId: null,
    },
    dependencies,
  );
  await updateProjectSnapshotFromRun(
    {
      candidate: { type: 'image', url: '   ' },
      projectId: 'project-1',
      userId: 'user-1',
    },
    dependencies,
  );

  assert.equal(databaseReads, 0);
  assert.equal(invalidations, 0);
});

test('cache failures warn without disguising a successful snapshot write', async (context) => {
  const cacheFailure = new Error('redis unavailable');
  const warnings: unknown[][] = [];
  context.mock.method(
    logger as unknown as { warn: (...args: unknown[]) => void },
    'warn',
    (...args: unknown[]) => {
      warnings.push(args);
    },
  );
  const db = {
    collection() {
      return {
        async updateOne() {
          return { matchedCount: 1, modifiedCount: 1 };
        },
      };
    },
  } as unknown as Pick<Db, 'collection'>;

  await updateProjectSnapshotFromRun(
    {
      candidate: { type: 'image', url: 'https://cdn.example/snapshot.jpg' },
      projectId: 'project-1',
      userId: 'user-1',
    },
    {
      async getStudioDatabase() {
        return db;
      },
      projectCache: createProjectCache(async () => {
        throw cacheFailure;
      }),
    },
  );

  assert.equal(warnings.length, 1);
  assert.equal((warnings[0]?.[0] as { err?: unknown }).err, cacheFailure);
  assert.equal(warnings[0]?.[1], 'failed to invalidate project caches after snapshot update');
});
