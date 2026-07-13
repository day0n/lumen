import assert from 'node:assert/strict';
import test from 'node:test';

import { JsonCache, ProjectRepository } from '../dist/index.js';

function createRepository(collection) {
  return new ProjectRepository({ collection: () => collection });
}

test('ensureShareId returns an existing share without attempting a write', async () => {
  let updateCalls = 0;
  const repository = createRepository({
    async findOne() {
      return { _id: 'project-1', owner_id: 'user-1', share_id: 'share-existing' };
    },
    async findOneAndUpdate() {
      updateCalls += 1;
      return null;
    },
  });

  assert.deepEqual(await repository.ensureShareId('user-1', 'project-1'), {
    created: false,
    shareId: 'share-existing',
  });
  assert.equal(updateCalls, 0);
});

test('ensureShareId race losers re-read the winning value without claiming creation', async () => {
  const reads = [
    { _id: 'project-1', owner_id: 'user-1' },
    { _id: 'project-1', owner_id: 'user-1', share_id: 'share-winner' },
  ];
  let updateFilter;
  const repository = createRepository({
    async findOne() {
      return reads.shift() ?? null;
    },
    async findOneAndUpdate(filter) {
      updateFilter = filter;
      return null;
    },
  });

  assert.deepEqual(await repository.ensureShareId('user-1', 'project-1'), {
    created: false,
    shareId: 'share-winner',
  });
  assert.deepEqual(updateFilter.share_id, { $exists: false });
});

test('folder project mutations update only the enumerated active project ids', async () => {
  let updateFilter;
  const collection = {
    find() {
      return {
        async toArray() {
          return [{ _id: 'project-1' }, { _id: 'project-2' }];
        },
      };
    },
    async updateMany(filter) {
      updateFilter = filter;
      return { matchedCount: 2 };
    },
  };
  const repository = createRepository(collection);

  assert.deepEqual(await repository.deleteAllInFolder('user-1', 'folder-1'), {
    matchedCount: 2,
    projectIds: ['project-1', 'project-2'],
  });
  assert.deepEqual(updateFilter, {
    _id: { $in: ['project-1', 'project-2'] },
    deleted_at: { $exists: false },
    folder_id: 'folder-1',
    owner_id: 'user-1',
  });
});

test('clearing a project folder unsets folder_id for the enumerated active projects', async () => {
  let updateDocument;
  const repository = createRepository({
    find() {
      return {
        async toArray() {
          return [{ _id: 'project-1' }];
        },
      };
    },
    async updateMany(_filter, update) {
      updateDocument = update;
      return { matchedCount: 1 };
    },
  });

  assert.deepEqual(await repository.clearFolderForOwner('user-1', 'folder-1'), {
    matchedCount: 1,
    projectIds: ['project-1'],
  });
  assert.deepEqual(updateDocument.$unset, { folder_id: '' });
  assert.ok(updateDocument.$set.updated_at instanceof Date);
});

test('empty folder project mutations skip updateMany', async () => {
  let updateCalls = 0;
  const repository = createRepository({
    find() {
      return {
        async toArray() {
          return [];
        },
      };
    },
    async updateMany() {
      updateCalls += 1;
      return { matchedCount: 0 };
    },
  });

  assert.deepEqual(await repository.deleteAllInFolder('user-1', 'folder-1'), {
    matchedCount: 0,
    projectIds: [],
  });
  assert.equal(updateCalls, 0);
});

test('JsonCache deletes a project invalidation batch in one Redis call', async () => {
  const calls = [];
  const cache = new JsonCache({
    async del(...keys) {
      calls.push(keys);
      return keys.length;
    },
  });

  await cache.deleteMany(['project:user-1:project-1', 'projects:user-1:list:limit:3:f::q:']);

  assert.deepEqual(calls, [['project:user-1:project-1', 'projects:user-1:list:limit:3:f::q:']]);
});

test('JsonCache batch deletion remains best effort when Redis fails', async () => {
  const cache = new JsonCache({
    async del() {
      throw new Error('redis unavailable');
    },
  });

  await cache.deleteMany(['project:user-1:project-1']);
});
