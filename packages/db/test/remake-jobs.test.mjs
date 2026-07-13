import assert from 'node:assert/strict';
import test from 'node:test';

import {
  REMAKE_JOBS_COLLECTION,
  REMAKE_TASKS_COLLECTION,
  RemakeJobRepository,
} from '../dist/index.js';

test('remake job indexes cover owner lists and ordered task detail reads', async () => {
  const indexes = [];
  const repository = new RemakeJobRepository({
    collection(name) {
      return {
        async createIndex(index, options) {
          indexes.push({ index, name, options });
        },
      };
    },
  });

  await repository.ensureIndexes();

  assert.deepEqual(indexes, [
    {
      index: { owner_id: 1, updated_at: -1 },
      name: REMAKE_JOBS_COLLECTION,
      options: undefined,
    },
    {
      index: { owner_id: 1, status: 1, updated_at: -1 },
      name: REMAKE_JOBS_COLLECTION,
      options: undefined,
    },
    {
      index: { video_id: 1 },
      name: REMAKE_JOBS_COLLECTION,
      options: undefined,
    },
    {
      index: { job_id: 1, stage: 1 },
      name: REMAKE_TASKS_COLLECTION,
      options: undefined,
    },
    {
      index: { job_id: 1, created_at: 1 },
      name: REMAKE_TASKS_COLLECTION,
      options: undefined,
    },
    {
      index: { job_id: 1, slice_key: 1 },
      name: REMAKE_TASKS_COLLECTION,
      options: { unique: true },
    },
    {
      index: { status: 1, updated_at: -1 },
      name: REMAKE_TASKS_COLLECTION,
      options: undefined,
    },
  ]);
});

test('remake task detail reads use the compound index filter and sort shape', async () => {
  let filter;
  let sort;
  const repository = new RemakeJobRepository({
    collection(name) {
      assert.equal(name, REMAKE_TASKS_COLLECTION);
      return {
        find(value) {
          filter = value;
          return {
            sort(value) {
              sort = value;
              return {
                async toArray() {
                  return [];
                },
              };
            },
          };
        },
      };
    },
  });

  assert.deepEqual(await repository.listTasksByJob('job-1'), []);
  assert.deepEqual(filter, { job_id: 'job-1' });
  assert.deepEqual(sort, { created_at: 1 });
});
