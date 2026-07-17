import assert from 'node:assert/strict';
import test from 'node:test';

import { isLoginRequiredPath } from '../src/lib/protected-paths.ts';

test('workspace paths require authentication', () => {
  assert.equal(isLoginRequiredPath('/app/projects'), true);
  assert.equal(isLoginRequiredPath('/app/canvas/new'), true);
  assert.equal(isLoginRequiredPath('/app/materials'), true);
  assert.equal(isLoginRequiredPath('/zh/canvas/projects'), true);
});

test('public and external paths do not require app authentication', () => {
  assert.equal(isLoginRequiredPath('/app/home'), false);
  assert.equal(isLoginRequiredPath('/app/hot-videos'), false);
  assert.equal(isLoginRequiredPath('/sign-in'), false);
  assert.equal(isLoginRequiredPath('https://example.com/app/projects'), false);
});
