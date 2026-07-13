import assert from 'node:assert/strict';
import test from 'node:test';

import {
  UnauthorizedError,
  UserProvisioningRequiredError,
  type WorkflowNodeResultSnapshot,
  type WorkflowStatusQueryService,
} from '@lumen/backend';

import { createApiApp } from '../src/app.ts';

const actor = {
  clerkUserId: 'identity-user-1',
  sessionId: 'session-1',
  userId: 'local-user-1',
};

const user = {
  clerkUserId: actor.clerkUserId,
  id: actor.userId,
};

const result: WorkflowNodeResultSnapshot = {
  error: null,
  nodeId: 'node-1',
  output: null,
  progress: 0.45,
  runId: 'run-1',
  status: 'running',
  updatedAt: '2026-07-14T00:00:00.000Z',
};

test('workflow status route preserves actor ownership, bounded input, DTO and metadata', async () => {
  const tokens: Array<string | null | undefined> = [];
  const calls: Array<{ actorUserId: string; nodeIds: readonly string[]; projectId: string }> = [];
  const app = createApiApp({
    authenticatedUsers: {
      async requireUser(token) {
        tokens.push(token);
        return { actor, user };
      },
    },
    release: 'workflow-status-release',
    workflowStatusQueries: createWorkflowStatusQueries({
      async getNodeResults(actorUserId, projectId, nodeIds) {
        calls.push({ actorUserId, nodeIds, projectId });
        return [result];
      },
    }),
  });
  const search = new URLSearchParams({
    nodeIds: ` node-1 ,,${'x'.repeat(65)},node-2`,
  });

  const response = await app.request(`/api/projects/project-1/workflow-status?${search}`, {
    headers: {
      authorization: 'Bearer bearer-token',
      'x-request-id': 'workflow-status-request-1',
    },
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(response.headers.get('x-lumen-release'), 'workflow-status-release');
  assert.equal(response.headers.get('x-request-id'), 'workflow-status-request-1');
  assert.deepEqual(await response.json(), { data: { results: [result] }, ok: true });
  assert.deepEqual(tokens, ['bearer-token']);
  assert.deepEqual(calls, [
    {
      actorUserId: actor.userId,
      nodeIds: ['node-1', 'node-2'],
      projectId: 'project-1',
    },
  ]);
});

test('workflow status authenticates before loading project status', async () => {
  let statusCalls = 0;
  const app = createApiApp({
    authenticatedUsers: {
      async requireUser() {
        throw new UnauthorizedError();
      },
    },
    workflowStatusQueries: createWorkflowStatusQueries({
      async getNodeResults() {
        statusCalls += 1;
        return [result];
      },
    }),
  });

  const response = await app.request('/api/projects/project-1/workflow-status?nodeIds=node-1');

  assert.equal(response.status, 401);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(await response.json(), {
    error: { message: 'Please sign in first' },
    ok: false,
  });
  assert.equal(statusCalls, 0);
});

test('workflow status preserves localized project-not-found responses', async () => {
  const app = createApiApp({
    authenticatedUsers: authenticatedUsers(),
    workflowStatusQueries: createWorkflowStatusQueries(),
  });

  const chineseResponse = await app.request('/api/projects/missing/workflow-status', {
    headers: { authorization: 'Bearer bearer-token', 'x-lumen-locale': 'zh' },
  });
  assert.equal(chineseResponse.status, 404);
  assert.deepEqual(await chineseResponse.json(), {
    error: { message: '项目不存在' },
    ok: false,
  });

  const englishResponse = await app.request('/api/projects/missing/workflow-status', {
    headers: { authorization: 'Bearer bearer-token' },
  });
  assert.equal(englishResponse.status, 404);
  assert.deepEqual(await englishResponse.json(), {
    error: { message: 'Project not found' },
    ok: false,
  });
});

test('workflow status rejects blank project identifiers before querying status', async () => {
  let statusCalls = 0;
  const app = createApiApp({
    authenticatedUsers: authenticatedUsers(),
    workflowStatusQueries: createWorkflowStatusQueries({
      async getNodeResults() {
        statusCalls += 1;
        return [result];
      },
    }),
  });

  for (const method of ['GET', 'HEAD']) {
    const response = await app.request('/api/projects/%20/workflow-status', {
      headers: { authorization: 'Bearer bearer-token' },
      method,
    });
    assert.equal(response.status, 404);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    if (method === 'HEAD') {
      assert.equal(await response.text(), '');
    } else {
      assert.deepEqual(await response.json(), {
        error: { message: 'Project not found' },
        ok: false,
      });
    }
  }
  assert.equal(statusCalls, 0);
});

test('workflow status preserves provisioning, availability and service failure mappings', async () => {
  const provisioningApp = createApiApp({
    authenticatedUsers: {
      async requireUser() {
        throw new UserProvisioningRequiredError();
      },
    },
    workflowStatusQueries: createWorkflowStatusQueries(),
  });
  const provisioningResponse = await provisioningApp.request(
    '/api/projects/project-1/workflow-status',
  );
  assert.equal(provisioningResponse.status, 503);
  assert.deepEqual(await provisioningResponse.json(), {
    error: { code: 'USER_PROVISIONING_REQUIRED', message: 'Internal server error' },
    ok: false,
  });

  const unavailableResponse = await createApiApp({
    authenticatedUsers: authenticatedUsers(),
  }).request('/api/projects/project-1/workflow-status', {
    headers: { authorization: 'Bearer bearer-token' },
  });
  assert.equal(unavailableResponse.status, 503);
  assert.equal(unavailableResponse.headers.get('cache-control'), 'private, no-store');

  const failure = new Error('workflow status repository unavailable');
  const failingApp = createApiApp({
    authenticatedUsers: authenticatedUsers(),
    workflowStatusQueries: createWorkflowStatusQueries({
      async getNodeResults() {
        throw failure;
      },
    }),
  });
  const originalConsoleError = console.error;
  const logs: unknown[][] = [];
  console.error = (...arguments_) => logs.push(arguments_);
  try {
    const failureResponse = await failingApp.request('/api/projects/project-1/workflow-status', {
      headers: {
        authorization: 'Bearer workflow-status-token-must-not-be-logged',
        'x-request-id': 'workflow-status-failure-request',
      },
    });
    assert.equal(failureResponse.status, 500);
    assert.equal(failureResponse.headers.get('cache-control'), 'private, no-store');
  } finally {
    console.error = originalConsoleError;
  }
  assert.equal(logs.length, 1);
  const details = logs[0]?.[1] as Record<string, unknown>;
  assert.deepEqual(Object.keys(details).sort(), ['error', 'requestId', 'route']);
  assert.equal(details.error, failure);
  assert.equal(details.route, 'GET /api/projects/:projectId/workflow-status');
  assert.equal(JSON.stringify(logs).includes('workflow-status-token-must-not-be-logged'), false);
});

test('workflow status HEAD executes the GET contract without a response body', async () => {
  let statusCalls = 0;
  const app = createApiApp({
    authenticatedUsers: authenticatedUsers(),
    release: 'workflow-status-head-release',
    workflowStatusQueries: createWorkflowStatusQueries({
      async getNodeResults() {
        statusCalls += 1;
        return statusCalls === 1 ? [result] : null;
      },
    }),
  });

  const successResponse = await app.request('/api/projects/project-1/workflow-status', {
    headers: { authorization: 'Bearer bearer-token' },
    method: 'HEAD',
  });
  assert.equal(successResponse.status, 200);
  assert.equal(successResponse.headers.get('cache-control'), 'private, no-store');
  assert.equal(successResponse.headers.get('x-lumen-release'), 'workflow-status-head-release');
  assert.equal(await successResponse.text(), '');

  const missingResponse = await app.request('/api/projects/missing/workflow-status', {
    headers: { authorization: 'Bearer bearer-token' },
    method: 'HEAD',
  });
  assert.equal(missingResponse.status, 404);
  assert.equal(missingResponse.headers.get('cache-control'), 'private, no-store');
  assert.equal(await missingResponse.text(), '');
  assert.equal(statusCalls, 2);
});

test('workflow status writes and sibling child routes remain outside the independent API', async () => {
  let authenticationCalls = 0;
  const app = createApiApp({
    authenticatedUsers: {
      async requireUser() {
        authenticationCalls += 1;
        return { actor, user };
      },
    },
    workflowStatusQueries: createWorkflowStatusQueries(),
  });

  for (const [method, pathname] of [
    ['POST', '/api/projects/project-1/workflow-status'],
    ['PATCH', '/api/projects/project-1/workflow-status'],
    ['GET', '/api/projects/project-1/history'],
    ['GET', '/api/projects/project-1/workflow-status/extra'],
  ]) {
    const response = await app.request(pathname, { method });
    assert.equal(response.status, 404, `${method} ${pathname} must remain outside lumen-api`);
  }
  assert.equal(authenticationCalls, 0);
});

function authenticatedUsers() {
  return {
    async requireUser() {
      return { actor, user };
    },
  };
}

function createWorkflowStatusQueries(
  overrides: Partial<WorkflowStatusQueryService> = {},
): WorkflowStatusQueryService {
  return {
    async getNodeResults() {
      return null;
    },
    ...overrides,
  };
}
