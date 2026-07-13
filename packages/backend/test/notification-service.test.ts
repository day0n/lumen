import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_OFFICIAL_NOTIFICATIONS,
  type NotificationLocale,
  type NotificationRepositoryPort,
  createNotificationService,
  seedDefaultOfficialNotifications,
} from '../src/notification-service.ts';

interface TestNotification {
  id: string;
  isRead: boolean;
}

class FakeNotificationRepository implements NotificationRepositoryPort<TestNotification> {
  listCalls: Array<{ actorUserId: string; limit: number; locale: NotificationLocale }> = [];
  markCalls: Array<{ actorUserId: string; notificationId: string }> = [];
  notifications: TestNotification[] = [];
  markResult = true;

  async listOfficialForUser(actorUserId: string, limit: number, locale: NotificationLocale) {
    this.listCalls.push({ actorUserId, limit, locale });
    return this.notifications;
  }

  async markOfficialRead(actorUserId: string, notificationId: string) {
    this.markCalls.push({ actorUserId, notificationId });
    return this.markResult;
  }
}

test('official notification reads use the explicit actor and preserve the response contract', async () => {
  const repository = new FakeNotificationRepository();
  repository.notifications = [
    { id: 'notification-1', isRead: false },
    { id: 'notification-2', isRead: true },
    { id: 'notification-3', isRead: false },
  ];
  const traces: Array<{ name: string; operation: string }> = [];
  const service = createNotificationService({
    getRepository: async () => repository,
    trace: async (name, operation, callback) => {
      traces.push({ name, operation });
      return callback();
    },
    tracePrefix: 'test',
  });

  assert.deepEqual(await service.listOfficial('local-user-1', 'zh'), {
    notifications: repository.notifications,
    unreadCount: 2,
  });
  assert.deepEqual(repository.listCalls, [
    { actorUserId: 'local-user-1', limit: 20, locale: 'zh' },
  ]);
  assert.deepEqual(traces, [
    { name: 'test.notifications.repository', operation: 'db.connect' },
    { name: 'test.notifications.list.db', operation: 'db.query' },
  ]);
});

test('official notification reads default to English', async () => {
  const repository = new FakeNotificationRepository();
  const service = createNotificationService({
    getRepository: () => repository,
    tracePrefix: 'test',
  });

  await service.listOfficial('local-user-1');
  assert.deepEqual(repository.listCalls, [
    { actorUserId: 'local-user-1', limit: 20, locale: 'en' },
  ]);
});

test('marking an official notification read uses only the explicit actor and notification id', async () => {
  const repository = new FakeNotificationRepository();
  repository.markResult = false;
  const service = createNotificationService({
    getRepository: () => repository,
    tracePrefix: 'test',
  });

  assert.equal(await service.markOfficialRead('local-user-2', 'notification-9'), false);
  assert.deepEqual(repository.markCalls, [
    { actorUserId: 'local-user-2', notificationId: 'notification-9' },
  ]);
});

test('missing actor ids fail before repository access', async () => {
  let repositoryCalls = 0;
  const service = createNotificationService<TestNotification>({
    getRepository: () => {
      repositoryCalls += 1;
      return new FakeNotificationRepository();
    },
    tracePrefix: 'test',
  });

  await assert.rejects(service.listOfficial('   '), /actorUserId is required/);
  await assert.rejects(service.markOfficialRead('', 'notification-1'), /actorUserId is required/);
  assert.equal(repositoryCalls, 0);
});

test('repository failures propagate without changing their error identity', async () => {
  const failure = new Error('notification repository unavailable');
  const service = createNotificationService<TestNotification>({
    getRepository: async () => {
      throw failure;
    },
    tracePrefix: 'test',
  });

  await assert.rejects(service.listOfficial('local-user-1'), (error: unknown) => {
    assert.equal(error, failure);
    return true;
  });
});

test('default notification seeding delegates the single backend definition unchanged', async () => {
  let received: unknown;
  await seedDefaultOfficialNotifications({
    async ensureDefaultOfficialNotifications(notifications) {
      received = notifications;
    },
  });

  assert.equal(received, DEFAULT_OFFICIAL_NOTIFICATIONS);
  assert.deepEqual(
    DEFAULT_OFFICIAL_NOTIFICATIONS.map((notification) => notification.id),
    [
      'agent-mode-launch-2026-05-26',
      'hot-video-remix-launch-2026-05-26',
      'materials-library-launch-2026-05-26',
    ],
  );
});
