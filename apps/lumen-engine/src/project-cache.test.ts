import assert from 'node:assert/strict';
import test from 'node:test';

import { createEngineProjectCacheInvalidator } from './project-cache.js';

test('engine project invalidation uses one physical Redis batch on the command connection', async () => {
  const batches: string[][] = [];
  const projectCache = createEngineProjectCacheInvalidator({
    async del(...keys: string[]) {
      batches.push(keys);
      return keys.length;
    },
  });

  await projectCache.invalidateProject('user-1', 'project-1');

  assert.deepEqual(batches, [
    [
      'lumen:studio:project:user-1:project-1',
      'lumen:studio:projects:user-1:list:limit:3:f::q:',
      'lumen:studio:projects:user-1:list:limit:50:f::q:',
    ],
  ]);
});
