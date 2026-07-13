import assert from 'node:assert/strict';
import test from 'node:test';

import { apiFailure, apiSuccess } from '../src/index.ts';

test('apiSuccess preserves the current response envelope', () => {
  assert.deepEqual(apiSuccess({ id: 'project-1' }), {
    ok: true,
    data: { id: 'project-1' },
  });
});

test('apiFailure keeps detail and code optional', () => {
  assert.deepEqual(apiFailure('Invalid request'), {
    ok: false,
    error: { message: 'Invalid request' },
  });

  assert.deepEqual(apiFailure('Invalid request', { field: 'title' }, 'INVALID_REQUEST'), {
    ok: false,
    error: {
      message: 'Invalid request',
      detail: { field: 'title' },
      code: 'INVALID_REQUEST',
    },
  });
});
