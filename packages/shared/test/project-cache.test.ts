import assert from 'node:assert/strict';
import test from 'node:test';

import {
  STUDIO_REDIS_KEY_PREFIX,
  createProjectCacheInvalidator,
  projectDetailCacheKey,
  projectListCacheKey,
} from '../src/project-cache.ts';

function createRecordingInvalidator(keyPrefix = '') {
  const deleted: string[] = [];
  return {
    deleted,
    invalidator: createProjectCacheInvalidator({
      cache: {
        async delete(key) {
          deleted.push(key);
        },
      },
      keyPrefix,
    }),
  };
}

test('project cache keys retain actor scope, list limits and escaped filters', () => {
  assert.equal(projectDetailCacheKey('user/one', 'project/one'), 'project:user/one:project/one');
  assert.equal(
    projectListCacheKey('user/one', {
      folderId: 'folder/one',
      limit: 3,
      query: 'launch now',
    }),
    'projects:user/one:list:limit:3:f:folder%2Fone:q:launch%20now',
  );
});

test('project invalidation deletes detail and both cached all-project lists with one prefix', async () => {
  const { deleted, invalidator } = createRecordingInvalidator(STUDIO_REDIS_KEY_PREFIX);

  await invalidator.invalidateProject('user/one', 'project/one');

  assert.deepEqual(deleted.toSorted(), [
    'lumen:studio:project:user/one:project/one',
    'lumen:studio:projects:user/one:list:limit:3:f::q:',
    'lumen:studio:projects:user/one:list:limit:50:f::q:',
  ]);
});

test('bulk project invalidation de-duplicates details and invalidates lists once', async () => {
  const { deleted, invalidator } = createRecordingInvalidator();

  await invalidator.invalidateProjects('user-1', ['project-1', 'project-2', 'project-1']);

  assert.deepEqual(deleted.toSorted(), [
    'project:user-1:project-1',
    'project:user-1:project-2',
    'projects:user-1:list:limit:3:f::q:',
    'projects:user-1:list:limit:50:f::q:',
  ]);
});

test('large project invalidation uses bounded batch deletes when the port supports them', async () => {
  const batches: string[][] = [];
  const invalidator = createProjectCacheInvalidator({
    cache: {
      async delete() {
        throw new Error('unexpected single-key delete');
      },
      async deleteMany(keys) {
        batches.push([...keys]);
      },
    },
    keyPrefix: STUDIO_REDIS_KEY_PREFIX,
  });
  const projectIds = Array.from({ length: 405 }, (_, index) => `project-${index}`);

  await invalidator.invalidateProjects('user-1', projectIds);

  assert.deepEqual(
    batches.map((batch) => batch.length),
    [200, 200, 7],
  );
  assert.equal(batches[0]?.[0], 'lumen:studio:project:user-1:project-0');
  assert.deepEqual(batches.at(-1)?.slice(-2), [
    'lumen:studio:projects:user-1:list:limit:3:f::q:',
    'lumen:studio:projects:user-1:list:limit:50:f::q:',
  ]);
});

test('invalid identifiers fail before any cache deletion', async () => {
  const { deleted, invalidator } = createRecordingInvalidator();

  await assert.rejects(invalidator.invalidateProject(' ', 'project-1'), /actorUserId is required/);
  await assert.rejects(
    invalidator.invalidateProjects('user-1', ['project-1', ' ']),
    /projectId is required/,
  );

  assert.deepEqual(deleted, []);
});
