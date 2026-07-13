import assert from 'node:assert/strict';
import test from 'node:test';
import {
  type NotificationService,
  UnauthorizedError,
  UserProvisioningRequiredError,
} from '@lumen/backend';
import type { OfficialNotificationRecord } from '@lumen/db';

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

const notification: OfficialNotificationRecord = {
  body: 'Notification body',
  id: 'notification-1',
  isRead: false,
  publishedAt: '2026-07-14T00:00:00.000Z',
  title: 'Notification title',
};

test('official notifications list uses the authenticated actor and request locale', async () => {
  const tokens: Array<string | null | undefined> = [];
  const calls: Array<{ actorUserId: string; locale: 'en' | 'zh' | undefined }> = [];
  const notifications = createNotifications({
    async listOfficial(actorUserId, locale) {
      calls.push({ actorUserId, locale });
      return { notifications: [notification], unreadCount: 1 };
    },
  });
  const app = createApiApp({
    authenticatedUsers: {
      async requireUser(token) {
        tokens.push(token);
        return { actor, user };
      },
    },
    notifications,
    release: 'notifications-release',
  });

  const bearerResponse = await app.request('/api/notifications/official', {
    headers: {
      authorization: 'Bearer bearer-token',
      'x-lumen-locale': 'zh',
      'x-request-id': 'notifications-request-1',
    },
  });
  assert.equal(bearerResponse.status, 200);
  assert.equal(bearerResponse.headers.get('cache-control'), 'private, no-store');
  assert.equal(bearerResponse.headers.get('x-lumen-release'), 'notifications-release');
  assert.equal(bearerResponse.headers.get('x-request-id'), 'notifications-request-1');
  assert.deepEqual(await bearerResponse.json(), {
    data: { notifications: [notification], unreadCount: 1 },
    ok: true,
  });

  const cookieResponse = await app.request('/api/notifications/official?locale=en', {
    headers: { cookie: '__session=cookie-token' },
  });
  assert.equal(cookieResponse.status, 200);
  assert.deepEqual(tokens, ['bearer-token', 'cookie-token']);
  assert.deepEqual(calls, [
    { actorUserId: actor.userId, locale: 'zh' },
    { actorUserId: actor.userId, locale: 'en' },
  ]);
});

test('mark read accepts bearer without Origin and decodes the path parameter exactly once', async () => {
  const calls: Array<{ actorUserId: string; notificationId: string }> = [];
  const app = createApiApp({
    authenticatedUsers: authenticatedUsers(),
    notifications: createNotifications({
      async markOfficialRead(actorUserId, notificationId) {
        calls.push({ actorUserId, notificationId });
        return true;
      },
    }),
    trustedCookieOrigins: ['https://lumen.local'],
  });

  const response = await app.request('/api/notifications/official/notification%252D9/read', {
    headers: {
      authorization: 'Bearer bearer-token',
      cookie: '__session=cookie-token',
      origin: 'https://untrusted.local',
    },
    method: 'POST',
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(await response.json(), { data: { read: true }, ok: true });
  assert.deepEqual(calls, [{ actorUserId: actor.userId, notificationId: 'notification%2D9' }]);
});

test('mark read accepts cookie authentication only from an exact trusted Origin', async () => {
  const markedIds: string[] = [];
  const app = createApiApp({
    authenticatedUsers: authenticatedUsers(),
    notifications: createNotifications({
      async markOfficialRead(_actorUserId, notificationId) {
        markedIds.push(notificationId);
        return true;
      },
    }),
    trustedCookieOrigins: ['https://lumen.local'],
  });

  const allowedResponse = await app.request('/api/notifications/official/allowed/read', {
    headers: { cookie: '__session=cookie-token', origin: 'https://lumen.local' },
    method: 'POST',
  });
  assert.equal(allowedResponse.status, 200);

  for (const origin of [undefined, 'null', 'https://other.local', 'https://lumen.local/']) {
    const headers: Record<string, string> = { cookie: '__session=cookie-token' };
    if (origin !== undefined) headers.origin = origin;
    const response = await app.request('/api/notifications/official/rejected/read', {
      headers,
      method: 'POST',
    });
    assert.equal(response.status, 403, `expected Origin ${String(origin)} to be rejected`);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.deepEqual(await response.json(), {
      error: { code: 'INVALID_REQUEST_ORIGIN', message: 'Invalid request origin' },
      ok: false,
    });
  }

  assert.deepEqual(markedIds, ['allowed']);
});

test('mark read authenticates before checking Origin or notification identifiers', async () => {
  let notificationCalls = 0;
  const app = createApiApp({
    authenticatedUsers: {
      async requireUser(token) {
        if (!token) throw new UnauthorizedError();
        return { actor, user };
      },
    },
    notifications: createNotifications({
      async markOfficialRead() {
        notificationCalls += 1;
        return true;
      },
    }),
    trustedCookieOrigins: ['https://lumen.local'],
  });

  const response = await app.request('/api/notifications/official/%20invalid/read', {
    headers: {
      authorization: 'Basic invalid',
      cookie: '__session=must-not-be-used',
      origin: 'https://untrusted.local',
    },
    method: 'POST',
  });

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    error: { message: 'Please sign in first' },
    ok: false,
  });
  assert.equal(notificationCalls, 0);
});

test('mark read rejects invalid decoded notification identifiers before the service', async () => {
  let notificationCalls = 0;
  const app = createApiApp({
    authenticatedUsers: authenticatedUsers(),
    notifications: createNotifications({
      async markOfficialRead() {
        notificationCalls += 1;
        return true;
      },
    }),
  });
  const invalidIds = [
    '%20notification',
    'notification%20',
    'a'.repeat(121),
    'notification%2Fchild',
    'notification%5Cchild',
    'notification%00child',
  ];

  for (const invalidId of invalidIds) {
    const response = await app.request(`/api/notifications/official/${invalidId}/read`, {
      headers: { authorization: 'Bearer bearer-token' },
      method: 'POST',
    });
    assert.equal(response.status, 400, `expected ${invalidId} to be rejected`);
    assert.deepEqual(await response.json(), {
      error: { code: 'INVALID_NOTIFICATION_ID', message: 'Invalid notification ID' },
      ok: false,
    });
  }
  assert.equal(notificationCalls, 0);
});

test('notification routes preserve auth, availability, not-found and failure mappings', async () => {
  const unauthenticatedApp = createApiApp({
    authenticatedUsers: {
      async requireUser() {
        throw new UnauthorizedError();
      },
    },
    notifications: createNotifications(),
  });
  const unauthorizedResponse = await unauthenticatedApp.request('/api/notifications/official');
  assert.equal(unauthorizedResponse.status, 401);

  const provisioningApp = createApiApp({
    authenticatedUsers: {
      async requireUser() {
        throw new UserProvisioningRequiredError();
      },
    },
    notifications: createNotifications(),
  });
  const provisioningResponse = await provisioningApp.request('/api/notifications/official');
  assert.equal(provisioningResponse.status, 503);
  assert.deepEqual(await provisioningResponse.json(), {
    error: {
      code: 'USER_PROVISIONING_REQUIRED',
      message: 'Internal server error',
    },
    ok: false,
  });

  const unavailableResponse = await createApiApp({
    authenticatedUsers: authenticatedUsers(),
  }).request('/api/notifications/official', {
    headers: { authorization: 'Bearer bearer-token' },
  });
  assert.equal(unavailableResponse.status, 503);
  assert.equal(unavailableResponse.headers.get('cache-control'), 'private, no-store');

  const notFoundApp = createApiApp({
    authenticatedUsers: authenticatedUsers(),
    notifications: createNotifications({
      async markOfficialRead() {
        return false;
      },
    }),
  });
  const notFoundResponse = await notFoundApp.request('/api/notifications/official/missing/read', {
    headers: { authorization: 'Bearer bearer-token', 'x-lumen-locale': 'zh' },
    method: 'POST',
  });
  assert.equal(notFoundResponse.status, 404);
  assert.deepEqual(await notFoundResponse.json(), {
    error: { code: 'NOTIFICATION_NOT_FOUND', message: '通知不存在' },
    ok: false,
  });

  const failure = new Error('repository unavailable');
  const failingApp = createApiApp({
    authenticatedUsers: authenticatedUsers(),
    notifications: createNotifications({
      async listOfficial() {
        throw failure;
      },
    }),
  });
  const originalConsoleError = console.error;
  const logs: unknown[][] = [];
  console.error = (...arguments_) => logs.push(arguments_);
  try {
    const failureResponse = await failingApp.request('/api/notifications/official', {
      headers: {
        authorization: 'Bearer secret-token-must-not-be-logged',
        'x-request-id': 'notification-failure-request',
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
  assert.equal(details.requestId, 'notification-failure-request');
  assert.equal(JSON.stringify(logs).includes('secret-token-must-not-be-logged'), false);
});

function authenticatedUsers() {
  return {
    async requireUser() {
      return { actor, user };
    },
  };
}

function createNotifications(
  overrides: Partial<NotificationService<OfficialNotificationRecord>> = {},
): NotificationService<OfficialNotificationRecord> {
  return {
    async listOfficial() {
      return { notifications: [], unreadCount: 0 };
    },
    async markOfficialRead() {
      return true;
    },
    ...overrides,
  };
}
