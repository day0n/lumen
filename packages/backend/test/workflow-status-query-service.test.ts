import assert from 'node:assert/strict';
import test from 'node:test';

import {
  type WorkflowNodeResultSnapshot,
  createWorkflowStatusQueryService,
  parseWorkflowStatusNodeIds,
} from '../src/index.ts';

const result: WorkflowNodeResultSnapshot = {
  error: null,
  nodeId: 'node-1',
  output: null,
  progress: 0.45,
  runId: 'run-1',
  status: 'running',
  updatedAt: '2026-07-14T00:00:00.000Z',
};

test('workflow status input parsing preserves the bounded route contract', () => {
  assert.deepEqual(parseWorkflowStatusNodeIds(null), []);
  assert.deepEqual(parseWorkflowStatusNodeIds(' node-1 ,,node-2 '), ['node-1', 'node-2']);
  assert.deepEqual(parseWorkflowStatusNodeIds(`${'x'.repeat(65)},valid`), ['valid']);

  const many = Array.from({ length: 205 }, (_, index) => `node-${index}`).join(',');
  const parsed = parseWorkflowStatusNodeIds(many);
  assert.equal(parsed.length, 200);
  assert.equal(parsed[0], 'node-0');
  assert.equal(parsed.at(-1), 'node-199');
});

test('workflow status verifies owner access before reading deduplicated node results', async () => {
  const projectCalls: unknown[] = [];
  const workflowCalls: unknown[] = [];
  const service = createWorkflowStatusQueryService({
    getProjectRepository: async () => ({
      async exists(ownerId, projectId) {
        projectCalls.push({ ownerId, projectId });
        return true;
      },
    }),
    getWorkflowNodeResultRepository: async () => ({
      async getLatestNodeResultsForProject(projectId, nodeIds) {
        workflowCalls.push({ projectId, nodeIds });
        return [result];
      },
    }),
    tracePrefix: 'test',
  });

  assert.deepEqual(
    await service.getNodeResults('user-1', 'project-1', ['node-1', ' node-1 ', 'node-2']),
    [result],
  );
  assert.deepEqual(projectCalls, [{ ownerId: 'user-1', projectId: 'project-1' }]);
  assert.deepEqual(workflowCalls, [{ nodeIds: ['node-1', 'node-2'], projectId: 'project-1' }]);
});

test('workflow status does not expose workflow storage for missing owner projects', async () => {
  let workflowRepositoryCalls = 0;
  const service = createWorkflowStatusQueryService({
    getProjectRepository: async () => ({
      async exists() {
        return false;
      },
    }),
    getWorkflowNodeResultRepository: async () => {
      workflowRepositoryCalls += 1;
      return {
        async getLatestNodeResultsForProject() {
          return [result];
        },
      };
    },
    tracePrefix: 'test',
  });

  assert.equal(await service.getNodeResults('user-1', 'missing', ['node-1']), null);
  assert.equal(workflowRepositoryCalls, 0);
});

test('workflow status validates project access for empty node selections without querying results', async () => {
  let projectCalls = 0;
  let workflowRepositoryCalls = 0;
  const service = createWorkflowStatusQueryService({
    getProjectRepository: async () => ({
      async exists() {
        projectCalls += 1;
        return true;
      },
    }),
    getWorkflowNodeResultRepository: async () => {
      workflowRepositoryCalls += 1;
      return {
        async getLatestNodeResultsForProject() {
          return [];
        },
      };
    },
    tracePrefix: 'test',
  });

  assert.deepEqual(await service.getNodeResults('user-1', 'project-1', [' ', '']), []);
  assert.equal(projectCalls, 1);
  assert.equal(workflowRepositoryCalls, 0);
});

test('workflow status rejects blank identity boundaries before loading repositories', async () => {
  let repositoryCalls = 0;
  const service = createWorkflowStatusQueryService({
    getProjectRepository: async () => {
      repositoryCalls += 1;
      return {
        async exists() {
          return true;
        },
      };
    },
    getWorkflowNodeResultRepository: async () => ({
      async getLatestNodeResultsForProject() {
        return [];
      },
    }),
    tracePrefix: 'test',
  });

  await assert.rejects(service.getNodeResults(' ', 'project-1', []), /actorUserId is required/);
  await assert.rejects(service.getNodeResults('user-1', ' ', []), /projectId is required/);
  assert.equal(repositoryCalls, 0);
});

test('workflow status preserves repository failures and stops later queries', async () => {
  const projectFailure = new Error('project lookup failed');
  let workflowRepositoryCalls = 0;
  const projectFailingService = createWorkflowStatusQueryService({
    getProjectRepository: async () => ({
      async exists() {
        throw projectFailure;
      },
    }),
    getWorkflowNodeResultRepository: async () => {
      workflowRepositoryCalls += 1;
      return {
        async getLatestNodeResultsForProject() {
          return [];
        },
      };
    },
    tracePrefix: 'test',
  });

  await assert.rejects(
    projectFailingService.getNodeResults('user-1', 'project-1', ['node-1']),
    (error) => error === projectFailure,
  );
  assert.equal(workflowRepositoryCalls, 0);

  const workflowFailure = new Error('workflow lookup failed');
  const workflowFailingService = createWorkflowStatusQueryService({
    getProjectRepository: async () => ({
      async exists() {
        return true;
      },
    }),
    getWorkflowNodeResultRepository: async () => ({
      async getLatestNodeResultsForProject() {
        throw workflowFailure;
      },
    }),
    tracePrefix: 'test',
  });

  await assert.rejects(
    workflowFailingService.getNodeResults('user-1', 'project-1', ['node-1']),
    (error) => error === workflowFailure,
  );
});
