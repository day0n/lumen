import assert from 'node:assert/strict';
import test from 'node:test';
import {
  type ProjectQueryService,
  UnauthorizedError,
  UserProvisioningRequiredError,
} from '@lumen/backend';
import type { ProjectListRecord } from '@lumen/db';

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

const project: ProjectListRecord = {
  createdAt: '2026-07-13T00:00:00.000Z',
  description: 'Project description',
  folderId: 'folder-one',
  id: 'project-1',
  ownerId: actor.userId,
  status: 'draft',
  thumbnail: 'https://cdn.example.com/project.webp',
  title: 'Project title',
  updatedAt: '2026-07-14T00:00:00.000Z',
};

test('projects route preserves query parsing, actor ownership, DTO and response metadata', async () => {
  const calls: Array<{
    actorUserId: string;
    options: { folderId?: string; limit?: number; query?: string };
  }> = [];
  const app = createApiApp({
    authenticatedUsers: authenticatedUsers(),
    projectQueries: createProjectQueries({
      async listProjects(actorUserId, options = {}) {
        calls.push({ actorUserId, options });
        return [project];
      },
    }),
    release: 'projects-release',
  });

  const filteredResponse = await app.request(
    '/api/projects?q=%20Project%20&limit=3.9items&folderId=%20folder-one%20',
    {
      headers: {
        authorization: 'Bearer bearer-token',
        'x-request-id': 'projects-request-1',
      },
    },
  );
  assert.equal(filteredResponse.status, 200);
  assert.equal(filteredResponse.headers.get('cache-control'), 'private, no-store');
  assert.equal(filteredResponse.headers.get('x-lumen-release'), 'projects-release');
  assert.equal(filteredResponse.headers.get('x-request-id'), 'projects-request-1');
  assert.deepEqual(await filteredResponse.json(), {
    data: { projects: [project] },
    ok: true,
  });

  const defaultResponse = await app.request('/api/projects?q=&limit=&folderId=%20%20', {
    headers: { cookie: '__session=cookie-token' },
  });
  assert.equal(defaultResponse.status, 200);
  assert.deepEqual(calls, [
    {
      actorUserId: actor.userId,
      options: { folderId: 'folder-one', limit: 3, query: 'Project' },
    },
    {
      actorUserId: actor.userId,
      options: { folderId: undefined, limit: 50, query: '' },
    },
  ]);
});

test('projects route authenticates before validating query parameters', async () => {
  let projectCalls = 0;
  const app = createApiApp({
    authenticatedUsers: {
      async requireUser() {
        throw new UnauthorizedError();
      },
    },
    projectQueries: createProjectQueries({
      async listProjects() {
        projectCalls += 1;
        return [];
      },
    }),
  });

  const response = await app.request('/api/projects?limit=not-a-number');

  assert.equal(response.status, 401);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(await response.json(), {
    error: { message: 'Please sign in first' },
    ok: false,
  });
  assert.equal(projectCalls, 0);
});

test('projects route returns the existing localized validation envelope after authentication', async () => {
  let projectCalls = 0;
  const app = createApiApp({
    authenticatedUsers: authenticatedUsers(),
    projectQueries: createProjectQueries({
      async listProjects() {
        projectCalls += 1;
        return [];
      },
    }),
  });

  const response = await app.request('/api/projects?limit=101', {
    headers: { authorization: 'Bearer bearer-token', 'x-lumen-locale': 'zh' },
  });
  const payload = (await response.json()) as {
    error: { detail?: { fieldErrors?: Record<string, string[]> }; message: string };
    ok: false;
  };

  assert.equal(response.status, 400);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(payload.ok, false);
  assert.equal(payload.error.message, '请求数据不符合约束');
  assert.ok(payload.error.detail?.fieldErrors?.limit?.length);
  assert.equal(projectCalls, 0);
});

test('projects route preserves provisioning, availability and service failure mappings', async () => {
  const provisioningApp = createApiApp({
    authenticatedUsers: {
      async requireUser() {
        throw new UserProvisioningRequiredError();
      },
    },
    projectQueries: createProjectQueries(),
  });
  const provisioningResponse = await provisioningApp.request('/api/projects');
  assert.equal(provisioningResponse.status, 503);
  assert.deepEqual(await provisioningResponse.json(), {
    error: { code: 'USER_PROVISIONING_REQUIRED', message: 'Internal server error' },
    ok: false,
  });

  const unavailableResponse = await createApiApp({
    authenticatedUsers: authenticatedUsers(),
  }).request('/api/projects', {
    headers: { authorization: 'Bearer bearer-token' },
  });
  assert.equal(unavailableResponse.status, 503);
  assert.equal(unavailableResponse.headers.get('cache-control'), 'private, no-store');

  const failure = new Error('project repository unavailable');
  const failingApp = createApiApp({
    authenticatedUsers: authenticatedUsers(),
    projectQueries: createProjectQueries({
      async listProjects() {
        throw failure;
      },
    }),
  });
  const originalConsoleError = console.error;
  const logs: unknown[][] = [];
  console.error = (...arguments_) => logs.push(arguments_);
  try {
    const failureResponse = await failingApp.request('/api/projects', {
      headers: {
        authorization: 'Bearer project-token-must-not-be-logged',
        'x-request-id': 'project-failure-request',
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
  assert.equal(JSON.stringify(logs).includes('project-token-must-not-be-logged'), false);
});

test('projects POST remains outside the independent API', async () => {
  let authenticationCalls = 0;
  const app = createApiApp({
    authenticatedUsers: {
      async requireUser() {
        authenticationCalls += 1;
        return { actor, user };
      },
    },
    projectQueries: createProjectQueries(),
  });

  const response = await app.request('/api/projects', { method: 'POST' });

  assert.equal(response.status, 404);
  assert.equal(authenticationCalls, 0);
});

function authenticatedUsers() {
  return {
    async requireUser() {
      return { actor, user };
    },
  };
}

function createProjectQueries(
  overrides: Partial<ProjectQueryService<ProjectListRecord>> = {},
): ProjectQueryService<ProjectListRecord> {
  return {
    async invalidateProjectLists() {},
    async listProjects() {
      return [];
    },
    ...overrides,
  };
}
