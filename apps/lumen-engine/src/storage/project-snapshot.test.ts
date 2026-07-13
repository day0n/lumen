import assert from 'node:assert/strict';
import test from 'node:test';

import type { Db } from 'mongodb';

import { writeProjectThumbnail } from './project-snapshot.js';

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
