import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createNotificationRepositoryRuntime,
  createRuntimeInitialization,
  initializeApiRuntimeWithRetry,
} from '../src/runtime.ts';

test('notification repository requests initialize indexes without running readiness seed', async () => {
  let factoryCalls = 0;
  let indexCalls = 0;
  let seedCalls = 0;
  const repository = {
    async ensureIndexes() {
      indexCalls += 1;
    },
  };
  const runtime = createNotificationRepositoryRuntime(
    async () => {
      factoryCalls += 1;
      return repository;
    },
    async (seedRepository) => {
      assert.equal(seedRepository, repository);
      seedCalls += 1;
    },
  );

  assert.equal(await runtime.getRepository(), repository);
  assert.equal(await runtime.getRepository(), repository);
  assert.equal(factoryCalls, 1);
  assert.equal(indexCalls, 1);
  assert.equal(seedCalls, 0);
  assert.equal(runtime.isReady(), false);

  const firstInitialization = runtime.initialize();
  const sharedInitialization = runtime.initialize();
  assert.equal(firstInitialization, sharedInitialization);
  await firstInitialization;
  await runtime.initialize();
  assert.equal(seedCalls, 1);
  assert.equal(runtime.isReady(), true);
});

test('notification readiness initialization retries a failed seed without rebuilding its repository', async () => {
  const seedFailure = new Error('seed failed');
  let factoryCalls = 0;
  let indexCalls = 0;
  let seedCalls = 0;
  const runtime = createNotificationRepositoryRuntime(
    async () => {
      factoryCalls += 1;
      return {
        async ensureIndexes() {
          indexCalls += 1;
        },
      };
    },
    async () => {
      seedCalls += 1;
      if (seedCalls === 1) throw seedFailure;
    },
  );

  await assert.rejects(runtime.initialize(), (error: unknown) => {
    assert.equal(error, seedFailure);
    return true;
  });
  assert.equal(runtime.isReady(), false);
  await runtime.initialize();

  assert.equal(factoryCalls, 1);
  assert.equal(indexCalls, 1);
  assert.equal(seedCalls, 2);
  assert.equal(runtime.isReady(), true);
});

test('runtime initialization owns dependency warmup and exposes read-only readiness state', async () => {
  let initializationCalls = 0;
  const runtime = createRuntimeInitialization(async () => {
    initializationCalls += 1;
  });

  assert.equal(runtime.isReady(), false);
  assert.equal(runtime.isReady(), false);
  assert.equal(initializationCalls, 0);

  const firstInitialization = runtime.initialize();
  const sharedInitialization = runtime.initialize();
  assert.equal(firstInitialization, sharedInitialization);
  await firstInitialization;

  assert.equal(initializationCalls, 1);
  assert.equal(runtime.isReady(), true);
  assert.equal(runtime.isReady(), true);
  assert.equal(initializationCalls, 1);
});

test('startup runtime initialization retries three times without readiness requests', async () => {
  const waits: number[] = [];
  let attempts = 0;

  await initializeApiRuntimeWithRetry(
    async () => {
      attempts += 1;
      if (attempts < 3) throw new Error(`attempt ${attempts} failed`);
    },
    {
      retryDelayMs: 25,
      wait: async (delayMs) => {
        waits.push(delayMs);
      },
    },
  );

  assert.equal(attempts, 3);
  assert.deepEqual(waits, [25, 25]);
});

test('startup runtime initialization stops after its default attempt limit', async () => {
  const failure = new Error('seed remains unavailable');
  let attempts = 0;

  await assert.rejects(
    initializeApiRuntimeWithRetry(
      async () => {
        attempts += 1;
        throw failure;
      },
      { retryDelayMs: 0, wait: async () => {} },
    ),
    (error: unknown) => {
      assert.equal(error, failure);
      return true;
    },
  );

  assert.equal(attempts, 3);
});
