import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MaterialAssetRepository,
  WORKFLOW_NODE_RESULTS_COLLECTION,
  WorkflowNodeResultRepository,
} from '../dist/index.js';

function createDatabase(rows) {
  const collectionNames = [];
  const pipelines = [];
  return {
    collectionNames,
    database: {
      collection(name) {
        collectionNames.push(name);
        assert.equal(name, WORKFLOW_NODE_RESULTS_COLLECTION);
        return {
          aggregate(pipeline) {
            pipelines.push(pipeline);
            return {
              async toArray() {
                return rows;
              },
            };
          },
        };
      },
    },
    pipelines,
  };
}

test('lightweight workflow result queries only the result collection and preserves latest mapping', async () => {
  const updatedAt = new Date('2026-07-01T12:00:00.000Z');
  const completedAt = new Date('2026-07-01T11:00:00.000Z');
  const { collectionNames, database, pipelines } = createDatabase([
    {
      doc: {
        _id: 'result-1',
        asset: { url: 'https://cdn.example/result.png' },
        attempts: 2,
        error: ' ',
        error_code: 3005,
        error_i18n_key: 'errors.safety',
        error_name: 'SafetyError',
        node_id: ' node-1 ',
        output_value: 'https://cdn.example/fallback.png',
        retryable: true,
        run_id: 'run-1',
        status: 'success',
        updated_at: updatedAt,
      },
    },
    {
      doc: {
        _id: 'result-2',
        completed_at: completedAt,
        error: 'still running',
        node_id: 'node-2',
        output_value: ' ',
        run_id: 'run-2',
        status: 'running',
      },
    },
    {
      doc: {
        _id: 'invalid-result',
        node_id: ' ',
        run_id: 'run-3',
        status: 'failed',
      },
    },
  ]);
  const repository = new WorkflowNodeResultRepository(database);

  const results = await repository.getLatestNodeResultsForProject('project-1', [
    ' node-1 ',
    'node-2',
    'node-1',
    ' ',
  ]);

  assert.deepEqual(collectionNames, [WORKFLOW_NODE_RESULTS_COLLECTION]);
  assert.deepEqual(pipelines, [
    [
      {
        $match: {
          node_id: { $in: ['node-1', 'node-2'] },
          $or: [{ project_id: 'project-1' }, { workflow_id: 'project-1' }],
        },
      },
      {
        $project: {
          node_id: 1,
          run_id: 1,
          status: 1,
          output_value: 1,
          asset: 1,
          error: 1,
          error_code: 1,
          error_name: 1,
          error_i18n_key: 1,
          retryable: 1,
          attempts: 1,
          created_at: 1,
          updated_at: 1,
          completed_at: 1,
        },
      },
      { $sort: { updated_at: -1, completed_at: -1, created_at: -1 } },
      { $group: { _id: '$node_id', doc: { $first: '$$ROOT' } } },
    ],
  ]);
  assert.deepEqual(results, [
    {
      attempts: 2,
      error: null,
      errorCode: 3005,
      errorI18nKey: 'errors.safety',
      errorName: 'SafetyError',
      nodeId: 'node-1',
      output: 'https://cdn.example/result.png',
      progress: 1,
      retryable: true,
      runId: 'run-1',
      status: 'success',
      updatedAt: updatedAt.toISOString(),
    },
    {
      error: 'still running',
      nodeId: 'node-2',
      output: null,
      progress: 0.45,
      runId: 'run-2',
      status: 'running',
      updatedAt: completedAt.toISOString(),
    },
  ]);
});

test('lightweight workflow result initialization only creates result indexes', async () => {
  const collectionNames = [];
  const indexes = [];
  const repository = new WorkflowNodeResultRepository({
    collection(name) {
      collectionNames.push(name);
      return {
        async createIndex(index) {
          indexes.push(index);
        },
      };
    },
  });

  await repository.ensureIndexes();

  assert.deepEqual(collectionNames, [WORKFLOW_NODE_RESULTS_COLLECTION]);
  assert.deepEqual(indexes, [
    { project_id: 1, status: 1, output_type: 1, completed_at: -1 },
    { workflow_id: 1, status: 1, output_type: 1, completed_at: -1 },
    { user_id: 1, project_id: 1, status: 1, output_type: 1, completed_at: -1 },
    { user_id: 1, workflow_id: 1, status: 1, output_type: 1, completed_at: -1 },
  ]);
});

test('empty workflow result queries return before opening any collection', async () => {
  let collectionCalls = 0;
  const repository = new WorkflowNodeResultRepository({
    collection() {
      collectionCalls += 1;
      throw new Error('unexpected collection access');
    },
  });

  assert.deepEqual(await repository.getLatestNodeResultsForProject('project-1', [' ', '']), []);
  assert.equal(collectionCalls, 0);
});

test('material repository keeps the legacy latest workflow result entrypoint', async () => {
  const updatedAt = new Date('2026-07-01T12:00:00.000Z');
  const { collectionNames, database } = createDatabase([
    {
      doc: {
        _id: 'result-1',
        node_id: 'node-1',
        output_value: 'https://cdn.example/result.png',
        run_id: 'run-1',
        status: 'success',
        updated_at: updatedAt,
      },
    },
  ]);
  const repository = new MaterialAssetRepository(database);

  assert.deepEqual(await repository.getLatestNodeResultsForProject('project-1', ['node-1']), [
    {
      error: null,
      nodeId: 'node-1',
      output: 'https://cdn.example/result.png',
      progress: 1,
      runId: 'run-1',
      status: 'success',
      updatedAt: updatedAt.toISOString(),
    },
  ]);
  assert.deepEqual(collectionNames, [WORKFLOW_NODE_RESULTS_COLLECTION]);
});
