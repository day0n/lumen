import assert from 'node:assert/strict';
import test from 'node:test';

import {
  type RemakeJobQueryJobLike,
  type RemakeJobQueryService,
  type RemakeJobQueryTaskLike,
  UnauthorizedError,
  UserProvisioningRequiredError,
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

interface TestJob extends RemakeJobQueryJobLike {
  label: string;
}

interface TestTask extends RemakeJobQueryTaskLike {
  id: string;
  inputPrompt: string;
}

const job: TestJob = {
  gate1ConfirmedAt: '2026-07-14T00:00:00.000Z',
  id: 'job-1',
  label: 'Owned remake job',
  ownerId: actor.userId,
};

const task: TestTask = {
  id: 'task-1',
  inputPrompt: 'Preserved task prompt',
  jobId: job.id,
  stage: 'lock',
  status: 'running',
};

const view = {
  job,
  stageStatuses: {
    breakdown: 'success',
    script: 'success',
    lock: 'running',
    storyboard: 'locked',
    video: 'locked',
    final: 'locked',
  } as const,
  tasks: [task],
};

test('remake job route preserves actor ownership, full view envelope and metadata', async () => {
  const tokens: Array<string | null | undefined> = [];
  const calls: Array<{ actorUserId: string; jobId: string }> = [];
  const app = createApiApp({
    authenticatedUsers: {
      async requireUser(token) {
        tokens.push(token);
        return { actor, user };
      },
    },
    release: 'remake-job-release',
    remakeJobQueries: createRemakeJobQueries({
      async getJobView(actorUserId, jobId) {
        calls.push({ actorUserId, jobId });
        return view;
      },
    }),
  });

  const response = await app.request('/api/remake/jobs/job-1', {
    headers: {
      authorization: 'Bearer bearer-token',
      'x-request-id': 'remake-job-request-1',
    },
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(response.headers.get('x-lumen-release'), 'remake-job-release');
  assert.equal(response.headers.get('x-request-id'), 'remake-job-request-1');
  assert.deepEqual(await response.json(), { data: view, ok: true });
  assert.deepEqual(tokens, ['bearer-token']);
  assert.deepEqual(calls, [{ actorUserId: actor.userId, jobId: 'job-1' }]);
});

test('remake job route authenticates before loading job state', async () => {
  let queryCalls = 0;
  const app = createApiApp({
    authenticatedUsers: {
      async requireUser() {
        throw new UnauthorizedError();
      },
    },
    remakeJobQueries: createRemakeJobQueries({
      async getJobView() {
        queryCalls += 1;
        return view;
      },
    }),
  });

  const response = await app.request('/api/remake/jobs/job-1');

  assert.equal(response.status, 401);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(await response.json(), {
    error: { message: 'Please sign in first' },
    ok: false,
  });
  assert.equal(queryCalls, 0);
});

test('remake job route preserves localized not-found responses', async () => {
  const app = createApiApp({
    authenticatedUsers: authenticatedUsers(),
    remakeJobQueries: createRemakeJobQueries(),
  });

  const chineseResponse = await app.request('/api/remake/jobs/missing', {
    headers: { authorization: 'Bearer bearer-token', 'x-lumen-locale': 'zh' },
  });
  assert.equal(chineseResponse.status, 404);
  assert.deepEqual(await chineseResponse.json(), {
    error: { message: '复刻任务不存在' },
    ok: false,
  });

  const englishResponse = await app.request('/api/remake/jobs/missing', {
    headers: { authorization: 'Bearer bearer-token' },
  });
  assert.equal(englishResponse.status, 404);
  assert.deepEqual(await englishResponse.json(), {
    error: { message: 'Remake job not found' },
    ok: false,
  });
});

test('remake job route rejects blank identifiers before querying state', async () => {
  let queryCalls = 0;
  const app = createApiApp({
    authenticatedUsers: authenticatedUsers(),
    remakeJobQueries: createRemakeJobQueries({
      async getJobView() {
        queryCalls += 1;
        return view;
      },
    }),
  });

  for (const method of ['GET', 'HEAD']) {
    const response = await app.request('/api/remake/jobs/%20', {
      headers: { authorization: 'Bearer bearer-token' },
      method,
    });
    assert.equal(response.status, 404);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    if (method === 'HEAD') {
      assert.equal(await response.text(), '');
    } else {
      assert.deepEqual(await response.json(), {
        error: { message: 'Remake job not found' },
        ok: false,
      });
    }
  }
  assert.equal(queryCalls, 0);
});

test('remake job route preserves provisioning, availability and failure mappings', async () => {
  const provisioningApp = createApiApp({
    authenticatedUsers: {
      async requireUser() {
        throw new UserProvisioningRequiredError();
      },
    },
    remakeJobQueries: createRemakeJobQueries(),
  });
  const provisioningResponse = await provisioningApp.request('/api/remake/jobs/job-1');
  assert.equal(provisioningResponse.status, 503);
  assert.deepEqual(await provisioningResponse.json(), {
    error: { code: 'USER_PROVISIONING_REQUIRED', message: 'Internal server error' },
    ok: false,
  });

  const unavailableResponse = await createApiApp({
    authenticatedUsers: authenticatedUsers(),
  }).request('/api/remake/jobs/job-1', {
    headers: { authorization: 'Bearer bearer-token' },
  });
  assert.equal(unavailableResponse.status, 503);
  assert.equal(unavailableResponse.headers.get('cache-control'), 'private, no-store');

  const failure = new Error('remake job repository unavailable');
  const failingApp = createApiApp({
    authenticatedUsers: authenticatedUsers(),
    remakeJobQueries: createRemakeJobQueries({
      async getJobView() {
        throw failure;
      },
    }),
  });
  const originalConsoleError = console.error;
  const logs: unknown[][] = [];
  console.error = (...arguments_) => logs.push(arguments_);
  try {
    const failureResponse = await failingApp.request('/api/remake/jobs/job-1', {
      headers: {
        authorization: 'Bearer remake-token-must-not-be-logged',
        'x-request-id': 'remake-job-failure-request',
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
  assert.equal(details.route, 'GET /api/remake/jobs/:jobId');
  assert.equal(JSON.stringify(logs).includes('remake-token-must-not-be-logged'), false);
});

test('remake job HEAD executes the GET contract without a response body', async () => {
  let queryCalls = 0;
  const app = createApiApp({
    authenticatedUsers: authenticatedUsers(),
    release: 'remake-job-head-release',
    remakeJobQueries: createRemakeJobQueries({
      async getJobView() {
        queryCalls += 1;
        return queryCalls === 1 ? view : null;
      },
    }),
  });

  const successResponse = await app.request('/api/remake/jobs/job-1', {
    headers: { authorization: 'Bearer bearer-token' },
    method: 'HEAD',
  });
  assert.equal(successResponse.status, 200);
  assert.equal(successResponse.headers.get('cache-control'), 'private, no-store');
  assert.equal(successResponse.headers.get('x-lumen-release'), 'remake-job-head-release');
  assert.equal(await successResponse.text(), '');

  const missingResponse = await app.request('/api/remake/jobs/missing', {
    headers: { authorization: 'Bearer bearer-token' },
    method: 'HEAD',
  });
  assert.equal(missingResponse.status, 404);
  assert.equal(missingResponse.headers.get('cache-control'), 'private, no-store');
  assert.equal(await missingResponse.text(), '');
  assert.equal(queryCalls, 2);
});

test('remake collection, writes and child routes remain outside the independent API', async () => {
  let authenticationCalls = 0;
  const app = createApiApp({
    authenticatedUsers: {
      async requireUser() {
        authenticationCalls += 1;
        return { actor, user };
      },
    },
    remakeJobQueries: createRemakeJobQueries(),
  });

  for (const [method, pathname] of [
    ['GET', '/api/remake/jobs'],
    ['HEAD', '/api/remake/jobs'],
    ['POST', '/api/remake/jobs'],
    ['POST', '/api/remake/jobs/job-1'],
    ['DELETE', '/api/remake/jobs/job-1'],
    ['GET', '/api/remake/jobs/job-1/'],
    ['GET', '/api/remake/jobs/job-1/run-stage'],
    ['POST', '/api/remake/jobs/job-1/run-stage'],
    ['POST', '/api/remake/jobs/job-1/confirm-gate'],
    ['POST', '/api/remake/jobs/job-1/cancel'],
    ['PATCH', '/api/remake/jobs/job-1/prompts'],
    ['PATCH', '/api/remake/jobs/job-1/scenes/1'],
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

function createRemakeJobQueries(
  overrides: Partial<RemakeJobQueryService<TestJob, TestTask>> = {},
): RemakeJobQueryService<TestJob, TestTask> {
  return {
    async getJobView() {
      return null;
    },
    ...overrides,
  };
}
