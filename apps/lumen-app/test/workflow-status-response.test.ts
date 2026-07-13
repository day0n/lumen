import assert from 'node:assert/strict';
import test from 'node:test';

import { readWorkflowStatusResults } from '../../lumen-studio/src/features/workflow/reconcile-workflow-nodes.ts';

const result = {
  error: null,
  nodeId: 'node-1',
  output: null,
  progress: 0.45,
  runId: 'run-1',
  status: 'running',
  updatedAt: '2026-07-14T00:00:00.000Z',
};

test('workflow status reads the shared API response envelope', () => {
  assert.deepEqual(
    readWorkflowStatusResults({
      data: { results: [result] },
      ok: true,
    }),
    [result],
  );
});

test('workflow status rejects malformed and obsolete response shapes', () => {
  assert.deepEqual(readWorkflowStatusResults({ results: [result] }), []);
  assert.deepEqual(readWorkflowStatusResults({ data: { results: [null, {}] }, ok: true }), []);
  assert.deepEqual(readWorkflowStatusResults({ data: { results: [result] }, ok: false }), []);
  assert.deepEqual(readWorkflowStatusResults(null), []);
});

test('workflow status strips invalid optional error metadata without losing valid results', () => {
  assert.deepEqual(
    readWorkflowStatusResults({
      data: {
        results: [
          {
            ...result,
            attempts: 0,
            errorCode: 'invalid',
            errorI18nKey: 42,
            errorName: 'private_error',
            retryable: 'yes',
          },
        ],
      },
      ok: true,
    }),
    [result],
  );
});

test('workflow status preserves valid public error metadata', () => {
  const failed = {
    ...result,
    attempts: 2,
    error: 'blocked',
    errorCode: 3005,
    errorI18nKey: 'canvas.errorCodes.contentBlocked',
    errorName: 'content_blocked',
    retryable: false,
    status: 'failed',
  };
  assert.deepEqual(readWorkflowStatusResults({ data: { results: [failed] }, ok: true }), [failed]);
});
