import assert from 'node:assert/strict';
import test from 'node:test';

import { JsonCache, ProjectHistoryRepository, ProjectRepository } from '../dist/index.js';

function createRepository(collection) {
  return new ProjectRepository({ collection: () => collection });
}

function projectDocument(overrides = {}) {
  return {
    _id: 'project-1',
    owner_id: 'owner-1',
    title: 'Shared project',
    status: 'draft',
    canvas: { nodes: [], edges: [] },
    created_at: new Date('2026-07-13T00:00:00.000Z'),
    updated_at: new Date('2026-07-13T00:00:00.000Z'),
    ...overrides,
  };
}

test('project indexes allow one active clone per owner and share', async () => {
  const indexes = [];
  const repository = createRepository({
    async createIndex(key, options) {
      indexes.push({ key, options });
    },
  });

  await repository.ensureIndexes();

  assert.deepEqual(indexes.at(-1), {
    key: { owner_id: 1, active_clone_key: 1 },
    options: {
      unique: true,
      partialFilterExpression: { active_clone_key: { $exists: true } },
    },
  });
});

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

test('cloneSharedProject returns the source project to its owner without inserting', async () => {
  let inserts = 0;
  const source = projectDocument({ share_id: 'share-1' });
  const repository = createRepository({
    async findOne(filter) {
      return filter.share_id ? source : null;
    },
    async insertOne() {
      inserts += 1;
    },
  });

  const result = await repository.cloneSharedProject('owner-1', 'share-1');

  assert.equal(result.created, false);
  assert.equal(result.historyPending, false);
  assert.equal(result.project.id, source._id);
  assert.equal(inserts, 0);
});

test('cloneSharedProject reuses an active clone for the same owner and share', async () => {
  let inserts = 0;
  const source = projectDocument({ share_id: 'share-1' });
  const clone = projectDocument({
    _id: 'clone-1',
    owner_id: 'viewer-1',
    source_share_id: 'share-1',
    active_clone_key: 'share-1',
    clone_history_recorded_at: new Date('2026-07-13T00:01:00.000Z'),
  });
  const repository = createRepository({
    async findOne(filter) {
      if (filter.share_id) return source;
      if (filter.active_clone_key) return clone;
      return null;
    },
    async insertOne() {
      inserts += 1;
    },
  });

  const result = await repository.cloneSharedProject('viewer-1', 'share-1');

  assert.equal(result.created, false);
  assert.equal(result.historyPending, false);
  assert.equal(result.project.id, clone._id);
  assert.equal(inserts, 0);
});

test('cloneSharedProject creates a draft copy with the idempotency marker', async () => {
  let inserted;
  const source = projectDocument({
    share_id: 'share-1',
    description: 'Description',
    thumbnail: 'https://cdn.example.com/thumbnail.webp',
    status: 'done',
    canvas: {
      nodes: [{ id: 'node-1', position: { x: 1, y: 2 }, data: { prompt: 'hello' } }],
      edges: [],
    },
  });
  const repository = createRepository({
    async findOne(filter) {
      return filter.share_id ? source : null;
    },
    async insertOne(document) {
      inserted = document;
    },
  });

  const result = await repository.cloneSharedProject('viewer-1', 'share-1');

  assert.equal(result.created, true);
  assert.equal(result.historyPending, true);
  assert.equal(result.project.ownerId, 'viewer-1');
  assert.equal(result.project.status, 'draft');
  assert.deepEqual(result.project.canvas, source.canvas);
  assert.equal(inserted.source_share_id, 'share-1');
  assert.equal(inserted.active_clone_key, 'share-1');
  assert.equal(inserted.share_id, undefined);
  assert.equal(inserted.folder_id, undefined);
});

test('cloneSharedProject returns the winning clone after a duplicate-key race', async () => {
  const source = projectDocument({ share_id: 'share-1' });
  const winner = projectDocument({
    _id: 'clone-winner',
    owner_id: 'viewer-1',
    source_share_id: 'share-1',
    active_clone_key: 'share-1',
  });
  let cloneReads = 0;
  const repository = createRepository({
    async findOne(filter) {
      if (filter.share_id) return source;
      cloneReads += 1;
      return cloneReads === 1 ? null : winner;
    },
    async insertOne() {
      throw Object.assign(new Error('duplicate key'), { code: 11000 });
    },
  });

  const result = await repository.cloneSharedProject('viewer-1', 'share-1');

  assert.equal(result.created, false);
  assert.equal(result.historyPending, true);
  assert.equal(result.project.id, 'clone-winner');
});

test('cloneSharedProject returns an existing clone after the source is removed', async () => {
  const clone = projectDocument({
    _id: 'clone-1',
    owner_id: 'viewer-1',
    source_share_id: 'share-1',
    active_clone_key: 'share-1',
  });
  const repository = createRepository({
    async findOne(filter) {
      return filter.active_clone_key ? clone : null;
    },
  });

  const result = await repository.cloneSharedProject('viewer-1', 'share-1');

  assert.equal(result.project.id, 'clone-1');
  assert.equal(result.created, false);
  assert.equal(result.historyPending, true);
});

test('deleting a cloned project releases its active clone key', async () => {
  let update;
  const repository = createRepository({
    async updateOne(_filter, receivedUpdate) {
      update = receivedUpdate;
      return { modifiedCount: 1 };
    },
  });

  assert.equal(await repository.delete('viewer-1', 'clone-1'), true);
  assert.deepEqual(update.$unset, { active_clone_key: '' });
  assert.ok(update.$set.deleted_at instanceof Date);
});

test('created project history snapshots are ensured with a stable id', async () => {
  const writes = [];
  const collection = {
    async findOneAndUpdate(filter, update, options) {
      writes.push({ filter, update, options });
      return update.$setOnInsert;
    },
  };
  const repository = new ProjectHistoryRepository({ collection: () => collection });
  const input = {
    ownerId: 'viewer-1',
    projectId: 'clone-1',
    title: 'Shared project',
    canvas: { nodes: [], edges: [] },
  };

  const first = await repository.ensureCreatedSnapshot(input);
  const second = await repository.ensureCreatedSnapshot(input);

  assert.equal(first.id, second.id);
  assert.match(first.id, /^created-[0-9a-f]{64}$/);
  assert.equal(first.action, 'created');
  assert.deepEqual(writes[0].filter, {
    owner_id: 'viewer-1',
    project_id: 'clone-1',
    action: 'created',
  });
  assert.deepEqual(writes[0].options, { upsert: true, returnDocument: 'after' });
});

test('created project history duplicate races return the winning snapshot', async () => {
  const winner = {
    _id: 'existing-created-history',
    owner_id: 'viewer-1',
    project_id: 'clone-1',
    title: 'Shared project',
    action: 'created',
    canvas: { nodes: [], edges: [] },
    node_count: 0,
    edge_count: 0,
    created_at: new Date('2026-07-13T00:00:00.000Z'),
  };
  const repository = new ProjectHistoryRepository({
    collection: () => ({
      async findOneAndUpdate() {
        throw Object.assign(new Error('duplicate key'), { code: 11000 });
      },
      async findOne() {
        return winner;
      },
    }),
  });

  const result = await repository.ensureCreatedSnapshot({
    ownerId: 'viewer-1',
    projectId: 'clone-1',
    title: 'Shared project',
    canvas: { nodes: [], edges: [] },
  });

  assert.equal(result.id, winner._id);
});

test('clone history completion is marked only on the owned source clone', async () => {
  let receivedFilter;
  let receivedUpdate;
  const repository = createRepository({
    async updateOne(filter, update) {
      receivedFilter = filter;
      receivedUpdate = update;
      return { matchedCount: 1 };
    },
  });

  assert.equal(
    await repository.markSharedProjectHistoryRecorded('viewer-1', 'clone-1', 'share-1'),
    true,
  );
  assert.deepEqual(receivedFilter, {
    _id: 'clone-1',
    owner_id: 'viewer-1',
    source_share_id: 'share-1',
  });
  assert.ok(receivedUpdate.$set.clone_history_recorded_at instanceof Date);
});

test('folder project mutations update only the enumerated active project ids', async () => {
  let updateFilter;
  let updateDocument;
  const collection = {
    find() {
      return {
        async toArray() {
          return [{ _id: 'project-1' }, { _id: 'project-2' }];
        },
      };
    },
    async updateMany(filter, update) {
      updateFilter = filter;
      updateDocument = update;
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
  assert.deepEqual(updateDocument.$unset, { active_clone_key: '' });
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
