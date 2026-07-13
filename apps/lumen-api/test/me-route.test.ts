import assert from 'node:assert/strict';
import test from 'node:test';
import {
  UnauthorizedError,
  UserProvisioningRequiredError,
  type UserRecordPort,
  createAuthenticatedUserService,
} from '@lumen/backend';

import { createApiApp } from '../src/app.ts';
import { createIdentityProvider } from '../src/auth/identity-provider.ts';

interface TestUser extends UserRecordPort {
  email: string;
}

const user: TestUser = {
  clerkUserId: 'identity-user-1',
  email: 'user@example.com',
  id: 'local-user-1',
};

test('current user route authenticates bearer and cookie sessions', async () => {
  const tokens: Array<string | null | undefined> = [];
  const app = createApiApp({
    authenticatedUsers: {
      async requireUser(token) {
        tokens.push(token);
        return {
          actor: {
            clerkUserId: user.clerkUserId,
            sessionId: 'session-1',
            userId: user.id,
          },
          user,
        };
      },
    },
    release: 'me-release',
  });

  const bearerResponse = await app.request('/api/me', {
    headers: { authorization: 'Bearer bearer-token', 'x-request-id': 'me-request-1' },
  });
  assert.equal(bearerResponse.status, 200);
  assert.equal(bearerResponse.headers.get('cache-control'), 'private, no-store');
  assert.equal(bearerResponse.headers.get('x-lumen-release'), 'me-release');
  assert.equal(bearerResponse.headers.get('x-request-id'), 'me-request-1');
  assert.deepEqual(await bearerResponse.json(), { ok: true, data: { user } });

  const cookieResponse = await app.request('/api/me', {
    headers: { cookie: '__session=cookie-token' },
  });
  assert.equal(cookieResponse.status, 200);
  assert.deepEqual(tokens, ['bearer-token', 'cookie-token']);
});

test('current user route returns a localized 401 for invalid sessions', async () => {
  const app = createApiApp({
    authenticatedUsers: {
      async requireUser() {
        throw new UnauthorizedError();
      },
    },
  });

  const response = await app.request('/api/me', {
    headers: { 'x-lumen-locale': 'zh' },
  });
  assert.equal(response.status, 401);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(await response.json(), {
    error: { message: '请先登录' },
    ok: false,
  });
});

test('current user route treats malformed bearer tokens as unauthorized', async () => {
  const identityProvider = createIdentityProvider({
    authorizedParties: ['https://lumen.local'],
    secretKey: 'secret-key',
  });
  const authenticatedUsers = createAuthenticatedUserService<TestUser>({
    async getUserRepository() {
      throw new Error('must not reach the user repository');
    },
    verifySessionToken: identityProvider.verifySessionToken,
  });
  const app = createApiApp({ authenticatedUsers });

  const response = await app.request('/api/me', {
    headers: { authorization: 'Bearer a.b.c' },
  });
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    error: { message: 'Please sign in first' },
    ok: false,
  });
});

test('current user route requests the compatibility path before incomplete provisioning', async () => {
  const app = createApiApp({
    authenticatedUsers: {
      async requireUser() {
        throw new UserProvisioningRequiredError();
      },
    },
  });

  const response = await app.request('/api/me', {
    headers: { authorization: 'Bearer new-user-token' },
  });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: {
      code: 'USER_PROVISIONING_REQUIRED',
      message: 'Internal server error',
    },
    ok: false,
  });
});

test('current user route fails closed when its service is unavailable', async () => {
  const response = await createApiApp().request('/api/me', {
    headers: { authorization: 'Bearer token' },
  });

  assert.equal(response.status, 503);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(await response.json(), {
    error: { message: 'Internal server error' },
    ok: false,
  });
});

test('current user route keeps identity verification outages out of the 401 path', async () => {
  const outage = new Error('verification unavailable');
  const authenticatedUsers = createAuthenticatedUserService<TestUser>({
    async getUserRepository() {
      throw new Error('must not reach the user repository');
    },
    async verifySessionToken() {
      throw outage;
    },
  });
  const app = createApiApp({ authenticatedUsers });
  const originalConsoleError = console.error;
  const logs: unknown[][] = [];
  console.error = (...arguments_) => logs.push(arguments_);
  try {
    const response = await app.request('/api/me', {
      headers: { authorization: 'Bearer token' },
    });
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), {
      error: { message: 'Internal server error' },
      ok: false,
    });
  } finally {
    console.error = originalConsoleError;
  }
  assert.equal(logs.length, 1);
  assert.equal((logs[0]?.[1] as { error?: unknown }).error, outage);
});

test('public routes do not invoke authenticated user resolution', async () => {
  let authenticationCalls = 0;
  const app = createApiApp({
    authenticatedUsers: {
      async requireUser() {
        authenticationCalls += 1;
        throw new Error('must not be called');
      },
    },
    homeQueries: {
      async listFeatured() {
        return [];
      },
      async listTemplates() {
        return { categories: [], items: [] };
      },
    },
  });

  assert.equal((await app.request('/healthz')).status, 200);
  assert.equal((await app.request('/readyz')).status, 200);
  assert.equal((await app.request('/api/home/featured')).status, 200);
  assert.equal((await app.request('/api/home/templates')).status, 200);
  assert.equal(authenticationCalls, 0);
});
