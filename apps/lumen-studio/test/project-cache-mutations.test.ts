import assert from 'node:assert/strict';
import test from 'node:test';

import type { ProjectCacheInvalidator } from '@lumen/shared/project-cache';

import {
  clearRetiredProjectFoldersWithCacheInvalidation,
  deleteFolderWithProjectCacheInvalidation,
  ensureProjectShareWithCacheInvalidation,
} from '../src/server/project-cache-mutations.ts';

function createRecordingCache() {
  const projectCalls: Array<{ actorUserId: string; projectId: string }> = [];
  const projectsCalls: Array<{ actorUserId: string; projectIds: readonly string[] }> = [];
  const cache: ProjectCacheInvalidator = {
    async invalidateProject(actorUserId, projectId) {
      projectCalls.push({ actorUserId, projectId });
    },
    async invalidateProjects(actorUserId, projectIds) {
      projectsCalls.push({ actorUserId, projectIds });
    },
    async invalidateProjectLists() {},
  };
  return { cache, projectCalls, projectsCalls };
}

test('first share creation invalidates detail and lists while an existing share does not', async () => {
  const createdCache = createRecordingCache();
  const project = { id: 'project-1' };
  const created = await ensureProjectShareWithCacheInvalidation({
    actorUserId: 'user-1',
    cache: createdCache.cache,
    projectId: 'project-1',
    repository: {
      async ensureShareId() {
        return { created: true, shareId: 'share-new' };
      },
      async get() {
        return project;
      },
    },
  });

  assert.deepEqual(created, { project, shareId: 'share-new' });
  assert.deepEqual(createdCache.projectCalls, [{ actorUserId: 'user-1', projectId: 'project-1' }]);

  const existingCache = createRecordingCache();
  const existing = await ensureProjectShareWithCacheInvalidation({
    actorUserId: 'user-1',
    cache: existingCache.cache,
    projectId: 'project-1',
    repository: {
      async ensureShareId() {
        return { created: false, shareId: 'share-existing' };
      },
      async get() {
        return project;
      },
    },
  });

  assert.deepEqual(existing, { project, shareId: 'share-existing' });
  assert.deepEqual(existingCache.projectCalls, []);
});

test('new shares are invalidated before a failed follow-up project read escapes', async () => {
  const { cache, projectCalls } = createRecordingCache();
  const readFailure = new Error('project read failed');

  await assert.rejects(
    ensureProjectShareWithCacheInvalidation({
      actorUserId: 'user-1',
      cache,
      projectId: 'project-1',
      repository: {
        async ensureShareId() {
          return { created: true, shareId: 'share-new' };
        },
        async get() {
          throw readFailure;
        },
      },
    }),
    (error) => error === readFailure,
  );

  assert.deepEqual(projectCalls, [{ actorUserId: 'user-1', projectId: 'project-1' }]);
});

test('missing share projects do not trigger cache invalidation or a follow-up read', async () => {
  const { cache, projectCalls } = createRecordingCache();
  let getCalls = 0;

  const result = await ensureProjectShareWithCacheInvalidation({
    actorUserId: 'user-1',
    cache,
    projectId: 'missing-project',
    repository: {
      async ensureShareId() {
        return null;
      },
      async get() {
        getCalls += 1;
        return null;
      },
    },
  });

  assert.equal(result, null);
  assert.equal(getCalls, 0);
  assert.deepEqual(projectCalls, []);
});

test('legacy folder retirement invalidates only projects from successful writes', async () => {
  const { cache, projectsCalls } = createRecordingCache();
  const idsByFolder: Record<string, string[]> = {
    'folder-changed': ['project-1', 'project-2'],
    'folder-unchanged': ['project-3'],
  };

  const modifiedCount = await clearRetiredProjectFoldersWithCacheInvalidation({
    actorUserId: 'user-1',
    cache,
    folderIds: ['folder-changed', 'folder-unchanged'],
    repository: {
      async clearFolderForOwner(_actorUserId, folderId) {
        const projectIds = idsByFolder[folderId] ?? [];
        return {
          matchedCount: folderId === 'folder-changed' ? 2 : 0,
          projectIds,
        };
      },
      async deleteAllInFolder() {
        throw new Error('unexpected delete');
      },
    },
  });

  assert.equal(modifiedCount, 2);
  assert.deepEqual(projectsCalls, [
    { actorUserId: 'user-1', projectIds: ['project-1', 'project-2'] },
  ]);
});

test('folder deletion finishes its database work before the final folder-list invalidation', async () => {
  for (const deleted of [true, false]) {
    const events: string[] = [];
    const cache: ProjectCacheInvalidator = {
      async invalidateProject() {},
      async invalidateProjectLists() {},
      async invalidateProjects(actorUserId, projectIds) {
        assert.equal(actorUserId, 'user-1');
        assert.deepEqual(projectIds, ['project-1', 'project-2']);
        events.push('project-cache');
      },
    };

    assert.equal(
      await deleteFolderWithProjectCacheInvalidation({
        actorUserId: 'user-1',
        cache,
        deleteFolder: async () => {
          events.push(`folder-delete:${deleted}`);
          return deleted;
        },
        folderId: 'folder-1',
        invalidateFolderList: async () => {
          events.push('folder-cache');
        },
        repository: {
          async clearFolderForOwner() {
            throw new Error('unexpected clear');
          },
          async deleteAllInFolder() {
            events.push('project-write');
            return { matchedCount: 2, projectIds: ['project-1', 'project-2'] };
          },
        },
      }),
      deleted,
    );
    assert.deepEqual(events, [
      'project-write',
      'project-cache',
      `folder-delete:${deleted}`,
      'folder-cache',
    ]);
  }

  const unchangedCache = createRecordingCache();
  let unchangedFolderListInvalidations = 0;
  assert.equal(
    await deleteFolderWithProjectCacheInvalidation({
      actorUserId: 'user-1',
      cache: unchangedCache.cache,
      deleteFolder: async () => false,
      folderId: 'folder-1',
      invalidateFolderList: async () => {
        unchangedFolderListInvalidations += 1;
      },
      repository: {
        async clearFolderForOwner() {
          throw new Error('unexpected clear');
        },
        async deleteAllInFolder() {
          return { matchedCount: 0, projectIds: [] };
        },
      },
    }),
    false,
  );
  assert.deepEqual(unchangedCache.projectsCalls, []);
  assert.equal(unchangedFolderListInvalidations, 1);
});

test('legacy folder cleanup drains successful branches before a sibling failure escapes', async () => {
  const invalidated: string[][] = [];
  let releaseInvalidation: (() => void) | undefined;
  const invalidationGate = new Promise<void>((resolve) => {
    releaseInvalidation = resolve;
  });
  const writeFailure = new Error('sibling project write failed');
  const cache: ProjectCacheInvalidator = {
    async invalidateProject() {},
    async invalidateProjectLists() {},
    async invalidateProjects(_actorUserId, projectIds) {
      await invalidationGate;
      invalidated.push([...projectIds]);
    },
  };

  const cleanup = clearRetiredProjectFoldersWithCacheInvalidation({
    actorUserId: 'user-1',
    cache,
    folderIds: ['folder-success', 'folder-failure'],
    repository: {
      async clearFolderForOwner(_actorUserId, folderId) {
        if (folderId === 'folder-success') {
          return { matchedCount: 1, projectIds: ['project-1'] };
        }
        throw writeFailure;
      },
      async deleteAllInFolder() {
        throw new Error('unexpected delete');
      },
    },
  });
  let settled = false;
  void cleanup.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );

  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  assert.deepEqual(invalidated, []);

  releaseInvalidation?.();
  await assert.rejects(cleanup, (error) => error === writeFailure);

  assert.deepEqual(invalidated, [['project-1']]);
});

test('folder project write failures do not delete the folder or invalidate caches', async () => {
  const { cache, projectsCalls } = createRecordingCache();
  let folderDeleteCalls = 0;
  let folderListInvalidations = 0;

  await assert.rejects(
    deleteFolderWithProjectCacheInvalidation({
      actorUserId: 'user-1',
      cache,
      deleteFolder: async () => {
        folderDeleteCalls += 1;
        return true;
      },
      folderId: 'folder-1',
      invalidateFolderList: async () => {
        folderListInvalidations += 1;
      },
      repository: {
        async clearFolderForOwner() {
          throw new Error('unexpected clear');
        },
        async deleteAllInFolder() {
          throw new Error('project write failed');
        },
      },
    }),
    /project write failed/,
  );

  assert.equal(folderDeleteCalls, 0);
  assert.equal(folderListInvalidations, 0);
  assert.deepEqual(projectsCalls, []);
});

test('folder delete failures preserve invalidation from an already committed project write', async () => {
  const events: string[] = [];
  const deleteFailure = new Error('folder delete failed');
  const cache: ProjectCacheInvalidator = {
    async invalidateProject() {},
    async invalidateProjectLists() {},
    async invalidateProjects(actorUserId, projectIds) {
      assert.equal(actorUserId, 'user-1');
      assert.deepEqual(projectIds, ['project-1']);
      events.push('project-cache');
    },
  };

  await assert.rejects(
    deleteFolderWithProjectCacheInvalidation({
      actorUserId: 'user-1',
      cache,
      deleteFolder: async () => {
        events.push('folder-delete');
        throw deleteFailure;
      },
      folderId: 'folder-1',
      invalidateFolderList: async () => {
        events.push('folder-cache');
        throw new Error('folder cache failed');
      },
      repository: {
        async clearFolderForOwner() {
          throw new Error('unexpected clear');
        },
        async deleteAllInFolder() {
          events.push('project-write');
          return { matchedCount: 1, projectIds: ['project-1'] };
        },
      },
    }),
    (error) => error === deleteFailure,
  );

  assert.deepEqual(events, ['project-write', 'project-cache', 'folder-delete', 'folder-cache']);
});
