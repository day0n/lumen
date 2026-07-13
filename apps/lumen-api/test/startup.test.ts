import assert from 'node:assert/strict';
import test from 'node:test';

import { initializeThenStart } from '../src/main.ts';

test('API startup waits for initialization before it starts serving', async () => {
  let finishInitialization: (() => void) | undefined;
  let startCalls = 0;
  const initialization = new Promise<void>((resolve) => {
    finishInitialization = resolve;
  });

  const startup = initializeThenStart({
    async closeRuntime() {},
    async initialize() {
      await initialization;
    },
    start() {
      startCalls += 1;
      return 'started';
    },
  });

  await Promise.resolve();
  assert.equal(startCalls, 0);
  finishInitialization?.();
  assert.equal(await startup, 'started');
  assert.equal(startCalls, 1);
});

test('API startup closes the runtime and never serves after initialization failure', async () => {
  const failure = new Error('initialization failed');
  let closeCalls = 0;
  let startCalls = 0;

  await assert.rejects(
    initializeThenStart({
      async closeRuntime() {
        closeCalls += 1;
      },
      async initialize() {
        throw failure;
      },
      start() {
        startCalls += 1;
      },
    }),
    (error: unknown) => {
      assert.equal(error, failure);
      return true;
    },
  );

  assert.equal(closeCalls, 1);
  assert.equal(startCalls, 0);
});

test('API startup preserves initialization and cleanup failures', async () => {
  const initializationFailure = new Error('initialization failed');
  const cleanupFailure = new Error('cleanup failed');

  await assert.rejects(
    initializeThenStart({
      async closeRuntime() {
        throw cleanupFailure;
      },
      async initialize() {
        throw initializationFailure;
      },
      start() {
        assert.fail('server must not start');
      },
    }),
    (error: unknown) => {
      assert.ok(error instanceof AggregateError);
      assert.deepEqual(error.errors, [initializationFailure, cleanupFailure]);
      return true;
    },
  );
});
