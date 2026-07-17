import assert from 'node:assert/strict';
import test from 'node:test';

import { isPublicEntryPath } from '../src/features/auth/public-entry-path.ts';

test('home and hot videos are public app entries', () => {
  assert.equal(isPublicEntryPath('/app/home'), true);
  assert.equal(isPublicEntryPath('/home'), true);
  assert.equal(isPublicEntryPath('/app/hot-videos'), true);
  assert.equal(isPublicEntryPath('/hot-videos'), true);
});

test('workspace routes remain protected', () => {
  assert.equal(isPublicEntryPath('/app/unknown'), false);
  assert.equal(isPublicEntryPath('/app/projects'), false);
  assert.equal(isPublicEntryPath('/app/materials'), false);
  assert.equal(isPublicEntryPath('/app/canvas/new'), false);
});
