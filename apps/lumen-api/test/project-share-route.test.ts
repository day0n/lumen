import assert from 'node:assert/strict';
import test from 'node:test';

import { type ProjectShareService, UnauthorizedError } from '@lumen/backend';

import { createApiApp } from '../src/app.ts';

const shareId = '0123456789abcdef0123456789abcdef';
const actor = {
  clerkUserId: 'identity-user-1',
  sessionId: 'session-1',
  userId: 'local-user-1',
};
const user = { clerkUserId: actor.clerkUserId, id: actor.userId };

test('public share previews expose the safe DTO without authenticating', async () => {
  let authenticationCalls = 0;
  const app = createApiApp({
    authenticatedUsers: {
      async requireUser() {
        authenticationCalls += 1;
        return { actor, user };
      },
    },
    projectShares: projectShares({
      async getPreview(receivedShareId) {
        assert.equal(receivedShareId, shareId);
        return { title: 'Shared project' };
      },
    }),
    release: 'share-preview-release',
  });

  const response = await app.request(`/api/shares/${shareId}`, {
    headers: { 'x-request-id': 'share-preview-request' },
  });

  assert.equal(response.status, 200);
  assert.equal(
    response.headers.get('cache-control'),
    'public, max-age=60, stale-while-revalidate=300',
  );
  assert.equal(response.headers.get('x-lumen-release'), 'share-preview-release');
  assert.equal(response.headers.get('x-request-id'), 'share-preview-request');
  assert.deepEqual(await response.json(), {
    ok: true,
    data: { preview: { title: 'Shared project' } },
  });
  assert.equal(authenticationCalls, 0);
});

test('share preview uses the same not-found contract for invalid and missing capabilities', async () => {
  let previewCalls = 0;
  const app = createApiApp({
    projectShares: projectShares({
      async getPreview() {
        previewCalls += 1;
        return null;
      },
    }),
  });

  for (const pathname of ['/api/shares/invalid', `/api/shares/${shareId}`]) {
    const response = await app.request(pathname, { headers: { 'x-lumen-locale': 'zh' } });
    assert.equal(response.status, 404);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), {
      ok: false,
      error: { code: 'SHARE_NOT_FOUND', message: '分享项目不存在' },
    });
  }
  assert.equal(previewCalls, 1);
});

test('share preview availability and failures fail closed without leaking credentials', async () => {
  const unavailable = await createApiApp().request(`/api/shares/${shareId}`);
  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.headers.get('cache-control'), 'no-store');

  const failure = new Error('share repository unavailable');
  const app = createApiApp({
    projectShares: projectShares({
      async getPreview() {
        throw failure;
      },
    }),
  });
  const logs: unknown[][] = [];
  const originalConsoleError = console.error;
  console.error = (...arguments_) => logs.push(arguments_);
  try {
    const response = await app.request(`/api/shares/${shareId}`, {
      headers: {
        authorization: 'Bearer share-token-must-not-be-logged',
        'x-request-id': 'share-preview-failure',
      },
    });
    assert.equal(response.status, 500);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  } finally {
    console.error = originalConsoleError;
  }
  assert.equal(logs.length, 1);
  const details = logs[0]?.[1] as Record<string, unknown>;
  assert.equal(details.route, 'GET /api/shares/:shareId');
  assert.equal(details.requestId, 'share-preview-failure');
  assert.equal(details.error, failure);
  assert.equal(JSON.stringify(logs).includes('share-token-must-not-be-logged'), false);
});

test('bearer-authenticated share clones return only the destination id and creation state', async () => {
  const tokens: Array<string | null | undefined> = [];
  const cloneCalls: unknown[] = [];
  const app = createApiApp({
    authenticatedUsers: {
      async requireUser(token) {
        tokens.push(token);
        return { actor, user };
      },
    },
    projectShares: projectShares({
      async cloneForOwner(actorUserId, receivedShareId) {
        cloneCalls.push({ actorUserId, shareId: receivedShareId });
        return { projectId: 'clone-1', created: true };
      },
    }),
    release: 'share-clone-release',
  });

  const response = await app.request(`/api/shares/${shareId}/clone`, {
    method: 'POST',
    headers: {
      authorization: 'Bearer share-clone-token',
      'x-request-id': 'share-clone-request',
    },
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(response.headers.get('x-lumen-release'), 'share-clone-release');
  assert.deepEqual(await response.json(), {
    ok: true,
    data: { projectId: 'clone-1', created: true },
  });
  assert.deepEqual(tokens, ['share-clone-token']);
  assert.deepEqual(cloneCalls, [{ actorUserId: actor.userId, shareId }]);
});

test('cookie-authenticated share clones require an exact trusted origin', async () => {
  let cloneCalls = 0;
  const app = createApiApp({
    authenticatedUsers: authenticatedUsers(),
    projectShares: projectShares({
      async cloneForOwner() {
        cloneCalls += 1;
        return { projectId: 'clone-1', created: false };
      },
    }),
    trustedCookieOrigins: ['https://lumenstudio.tech'],
  });

  for (const origin of [
    undefined,
    'https://evil.example',
    'https://lumenstudio.tech.evil.example',
  ]) {
    const headers: Record<string, string> = { cookie: '__session=cookie-token' };
    if (origin) headers.origin = origin;
    const response = await app.request(`/api/shares/${shareId}/clone`, {
      method: 'POST',
      headers,
    });
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), {
      ok: false,
      error: { code: 'INVALID_REQUEST_ORIGIN', message: 'Invalid request origin' },
    });
  }

  const accepted = await app.request(`/api/shares/${shareId}/clone`, {
    method: 'POST',
    headers: { cookie: '__session=cookie-token', origin: 'https://lumenstudio.tech' },
  });
  assert.equal(accepted.status, 200);
  assert.deepEqual(await accepted.json(), {
    ok: true,
    data: { projectId: 'clone-1', created: false },
  });
  assert.equal(cloneCalls, 1);
});

test('share clone authenticates first and preserves invalid, missing and unavailable mappings', async () => {
  let cloneCalls = 0;
  const unauthorized = createApiApp({
    authenticatedUsers: {
      async requireUser() {
        throw new UnauthorizedError();
      },
    },
    projectShares: projectShares({
      async cloneForOwner() {
        cloneCalls += 1;
        return null;
      },
    }),
  });
  assert.equal(
    (
      await unauthorized.request(`/api/shares/${shareId}/clone`, {
        method: 'POST',
        headers: { authorization: 'Bearer invalid' },
      })
    ).status,
    401,
  );

  const available = createApiApp({
    authenticatedUsers: authenticatedUsers(),
    projectShares: projectShares({
      async cloneForOwner() {
        cloneCalls += 1;
        return null;
      },
    }),
  });
  for (const id of ['invalid', shareId]) {
    const response = await available.request(`/api/shares/${id}/clone`, {
      method: 'POST',
      headers: { authorization: 'Bearer valid', 'x-lumen-locale': 'zh' },
    });
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), {
      ok: false,
      error: { code: 'SHARE_NOT_FOUND', message: '分享项目不存在' },
    });
  }

  const unavailable = await createApiApp({ authenticatedUsers: authenticatedUsers() }).request(
    `/api/shares/${shareId}/clone`,
    { method: 'POST', headers: { authorization: 'Bearer valid' } },
  );
  assert.equal(unavailable.status, 503);
  assert.equal(cloneCalls, 1);
});

test('share routes preserve HEAD and reject unrelated methods and child paths', async () => {
  let previewCalls = 0;
  const app = createApiApp({
    projectShares: projectShares({
      async getPreview() {
        previewCalls += 1;
        return { title: 'Shared project' };
      },
    }),
  });

  const head = await app.request(`/api/shares/${shareId}`, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  assert.equal(previewCalls, 1);

  for (const [method, pathname] of [
    ['PUT', `/api/shares/${shareId}`],
    ['GET', `/api/shares/${shareId}/clone`],
    ['POST', `/api/shares/${shareId}/clone/extra`],
  ]) {
    const response = await app.request(pathname, { method });
    assert.equal(response.status, 404, `${method} ${pathname}`);
  }
});

function authenticatedUsers() {
  return {
    async requireUser() {
      return { actor, user };
    },
  };
}

function projectShares(overrides: Partial<ProjectShareService> = {}): ProjectShareService {
  return {
    async getPreview() {
      return null;
    },
    async cloneForOwner() {
      return null;
    },
    ...overrides,
  };
}
