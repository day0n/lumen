import assert from 'node:assert/strict';
import test from 'node:test';
import {
  type ProjectDetailQueryService,
  UnauthorizedError,
  UserProvisioningRequiredError,
} from '@lumen/backend';
import type { ProjectRecord } from '@lumen/db';

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

const project: ProjectRecord = {
  canvas: { edges: [], nodes: [] },
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

test('project detail route preserves actor ownership, fresh reads, DTO and metadata', async () => {
  const tokens: Array<string | null | undefined> = [];
  const calls: Array<{
    actorUserId: string;
    options: { bypassCache?: boolean } | undefined;
    projectId: string;
  }> = [];
  const app = createApiApp({
    authenticatedUsers: {
      async requireUser(token) {
        tokens.push(token);
        return { actor, user };
      },
    },
    projectDetails: createProjectDetails({
      async getProject(actorUserId, projectId, options) {
        calls.push({ actorUserId, options, projectId });
        return project;
      },
    }),
    release: 'project-detail-release',
  });

  const freshResponse = await app.request('/api/projects/project-1?fresh=1', {
    headers: {
      authorization: 'Bearer bearer-token',
      'x-request-id': 'project-detail-request-1',
    },
  });
  assert.equal(freshResponse.status, 200);
  assert.equal(freshResponse.headers.get('cache-control'), 'private, no-store');
  assert.equal(freshResponse.headers.get('x-lumen-release'), 'project-detail-release');
  assert.equal(freshResponse.headers.get('x-request-id'), 'project-detail-request-1');
  assert.deepEqual(await freshResponse.json(), { data: { project }, ok: true });

  const cachedResponse = await app.request('/api/projects/project-1?fresh=true', {
    headers: { cookie: '__session=cookie-token' },
  });
  assert.equal(cachedResponse.status, 200);
  assert.deepEqual(tokens, ['bearer-token', 'cookie-token']);
  assert.deepEqual(calls, [
    {
      actorUserId: actor.userId,
      options: { bypassCache: true },
      projectId: project.id,
    },
    {
      actorUserId: actor.userId,
      options: { bypassCache: false },
      projectId: project.id,
    },
  ]);
});

test('project detail route authenticates before reading a project', async () => {
  let projectCalls = 0;
  const app = createApiApp({
    authenticatedUsers: {
      async requireUser() {
        throw new UnauthorizedError();
      },
    },
    projectDetails: createProjectDetails({
      async getProject() {
        projectCalls += 1;
        return project;
      },
    }),
  });

  const response = await app.request('/api/projects/project-1?fresh=1');

  assert.equal(response.status, 401);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(await response.json(), {
    error: { message: 'Please sign in first' },
    ok: false,
  });
  assert.equal(projectCalls, 0);
});

test('project detail route preserves localized not-found responses', async () => {
  let projectCalls = 0;
  const app = createApiApp({
    authenticatedUsers: authenticatedUsers(),
    projectDetails: createProjectDetails({
      async getProject() {
        projectCalls += 1;
        return null;
      },
    }),
  });

  const response = await app.request('/api/projects/missing', {
    headers: { authorization: 'Bearer bearer-token', 'x-lumen-locale': 'zh' },
  });

  assert.equal(response.status, 404);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(await response.json(), {
    error: { message: '项目不存在' },
    ok: false,
  });

  const englishResponse = await app.request('/api/projects/missing', {
    headers: { authorization: 'Bearer bearer-token' },
  });
  assert.equal(englishResponse.status, 404);
  assert.deepEqual(await englishResponse.json(), {
    error: { message: 'Project not found' },
    ok: false,
  });
  assert.equal(projectCalls, 2);
});

test('project detail route preserves provisioning, availability and service failure mappings', async () => {
  const provisioningApp = createApiApp({
    authenticatedUsers: {
      async requireUser() {
        throw new UserProvisioningRequiredError();
      },
    },
    projectDetails: createProjectDetails(),
  });
  const provisioningResponse = await provisioningApp.request('/api/projects/project-1');
  assert.equal(provisioningResponse.status, 503);
  assert.deepEqual(await provisioningResponse.json(), {
    error: { code: 'USER_PROVISIONING_REQUIRED', message: 'Internal server error' },
    ok: false,
  });

  const unavailableResponse = await createApiApp({
    authenticatedUsers: authenticatedUsers(),
  }).request('/api/projects/project-1', {
    headers: { authorization: 'Bearer bearer-token' },
  });
  assert.equal(unavailableResponse.status, 503);
  assert.equal(unavailableResponse.headers.get('cache-control'), 'private, no-store');

  const failure = new Error('project detail repository unavailable');
  const failingApp = createApiApp({
    authenticatedUsers: authenticatedUsers(),
    projectDetails: createProjectDetails({
      async getProject() {
        throw failure;
      },
    }),
  });
  const originalConsoleError = console.error;
  const logs: unknown[][] = [];
  console.error = (...arguments_) => logs.push(arguments_);
  try {
    const failureResponse = await failingApp.request('/api/projects/project-1', {
      headers: {
        authorization: 'Bearer project-detail-token-must-not-be-logged',
        'x-request-id': 'project-detail-failure-request',
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
  assert.equal(details.route, 'GET /api/projects/:projectId');
  assert.equal(JSON.stringify(logs).includes('project-detail-token-must-not-be-logged'), false);
});

test('project detail HEAD requests execute the GET contract without a response body', async () => {
  let projectCalls = 0;
  const app = createApiApp({
    authenticatedUsers: authenticatedUsers(),
    projectDetails: createProjectDetails({
      async getProject() {
        projectCalls += 1;
        return projectCalls === 1 ? project : null;
      },
    }),
    release: 'project-detail-head-release',
  });

  const successResponse = await app.request('/api/projects/project-1', {
    headers: { authorization: 'Bearer bearer-token' },
    method: 'HEAD',
  });
  assert.equal(successResponse.status, 200);
  assert.equal(successResponse.headers.get('cache-control'), 'private, no-store');
  assert.equal(successResponse.headers.get('x-lumen-release'), 'project-detail-head-release');
  assert.equal(await successResponse.text(), '');

  const missingResponse = await app.request('/api/projects/missing', {
    headers: { authorization: 'Bearer bearer-token' },
    method: 'HEAD',
  });
  assert.equal(missingResponse.status, 404);
  assert.equal(missingResponse.headers.get('cache-control'), 'private, no-store');
  assert.equal(await missingResponse.text(), '');
  assert.equal(projectCalls, 2);
});

test('project detail writes and child routes remain outside the independent API', async () => {
  let authenticationCalls = 0;
  const app = createApiApp({
    authenticatedUsers: {
      async requireUser() {
        authenticationCalls += 1;
        return { actor, user };
      },
    },
    projectDetails: createProjectDetails(),
  });

  const requests: Array<[string, string]> = [
    ['PATCH', '/api/projects/project-1'],
    ['DELETE', '/api/projects/project-1'],
    ['GET', '/api/projects/project-1/share'],
    ['GET', '/api/projects/project-1/history'],
    ['GET', '/api/projects/project-1/workflow-status'],
    ['POST', '/api/projects/project-1/workflow-runs/run-1/cancel'],
  ];
  for (const [method, pathname] of requests) {
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

function createProjectDetails(
  overrides: Partial<ProjectDetailQueryService<ProjectRecord>> = {},
): ProjectDetailQueryService<ProjectRecord> {
  return {
    async getProject() {
      return null;
    },
    ...overrides,
  };
}
