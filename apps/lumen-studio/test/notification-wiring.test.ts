import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createNotificationRepositoryLoader,
  initializeDefaultOfficialNotifications,
  runStartupWarmups,
} from '../src/server/notification-startup.ts';
import { createRepositoryLoader } from '../src/server/repository-loader.ts';

test('repository loaders retry initialization after a shared failure', async () => {
  const failure = new Error('initialization failed');
  const repository = { id: 'notification-repository' };
  let attempts = 0;
  const loader = createRepositoryLoader(async () => {
    attempts += 1;
    if (attempts === 1) throw failure;
    return repository;
  });

  const first = loader();
  const shared = loader();
  assert.equal(first, shared);
  await assert.rejects(first, (error: unknown) => {
    assert.equal(error, failure);
    return true;
  });
  await assert.rejects(shared, (error: unknown) => {
    assert.equal(error, failure);
    return true;
  });

  assert.equal(await loader(), repository);
  assert.equal(await loader(), repository);
  assert.equal(attempts, 2);
});

test('the notification repository getter initializes indexes without seeding', async () => {
  let factoryCalls = 0;
  let indexCalls = 0;
  let seedCalls = 0;
  const repository = {
    async ensureIndexes() {
      indexCalls += 1;
    },
    async ensureDefaultOfficialNotifications() {
      seedCalls += 1;
    },
  };
  const getRepository = createNotificationRepositoryLoader(async () => {
    factoryCalls += 1;
    return repository;
  });

  assert.equal(await getRepository(), repository);
  assert.equal(await getRepository(), repository);
  assert.equal(factoryCalls, 1);
  assert.equal(indexCalls, 1);
  assert.equal(seedCalls, 0);
});

test('startup notification seeding retries only up to its configured limit', async () => {
  const failure = new Error('seed failed');
  const waits: number[] = [];
  let seedAttempts = 0;
  const repository = {
    async ensureDefaultOfficialNotifications() {
      seedAttempts += 1;
      throw failure;
    },
  };

  await assert.rejects(
    initializeDefaultOfficialNotifications({
      getRepository: () => repository,
      maxAttempts: 3,
      retryDelayMs: 25,
      wait: async (delayMs) => {
        waits.push(delayMs);
      },
    }),
    (error: unknown) => {
      assert.equal(error, failure);
      return true;
    },
  );

  assert.equal(seedAttempts, 3);
  assert.deepEqual(waits, [25, 25]);
});

test('startup warmup waits for every task and aggregates all failures', async () => {
  const firstFailure = new Error('first warmup failed');
  const secondFailure = new Error('second warmup failed');
  let successfulTaskCompleted = false;

  await assert.rejects(
    runStartupWarmups([
      async () => {
        throw firstFailure;
      },
      async () => {
        successfulTaskCompleted = true;
      },
      async () => {
        throw secondFailure;
      },
    ]),
    (error: unknown) => {
      assert.ok(error instanceof AggregateError);
      assert.deepEqual(error.errors, [firstFailure, secondFailure]);
      return true;
    },
  );

  assert.equal(successfulTaskCompleted, true);
});
