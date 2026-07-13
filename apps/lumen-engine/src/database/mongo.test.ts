import assert from 'node:assert/strict';
import test from 'node:test';

import { createMongoRuntime } from './mongo.js';

interface FakeDatabase {
  name: string;
}

test('mongo runtime shares one client while keeping workflow and studio databases separate', async () => {
  let clientCount = 0;
  let connectCount = 0;
  let closeCount = 0;
  const selectedDatabases: string[] = [];
  const runtime = createMongoRuntime<FakeDatabase>({
    workflowDbName: 'lumen_engine',
    studioDbName: 'lumen_app',
    createClient: () => {
      clientCount += 1;
      return {
        async connect() {
          connectCount += 1;
        },
        db(name) {
          selectedDatabases.push(name);
          return { name };
        },
        async close() {
          closeCount += 1;
        },
      };
    },
  });

  const [workflow, studio, repeatedStudio] = await Promise.all([
    runtime.getWorkflowDatabase(),
    runtime.getStudioDatabase(),
    runtime.getStudioDatabase(),
  ]);

  assert.deepEqual(workflow, { name: 'lumen_engine' });
  assert.deepEqual(studio, { name: 'lumen_app' });
  assert.equal(repeatedStudio, studio);
  assert.equal(clientCount, 1);
  assert.equal(connectCount, 1);
  assert.deepEqual(selectedDatabases.toSorted(), ['lumen_app', 'lumen_engine']);

  await runtime.close();
  assert.equal(closeCount, 1);

  assert.deepEqual(await runtime.getWorkflowDatabase(), { name: 'lumen_engine' });
  assert.equal(clientCount, 2);
  assert.equal(connectCount, 2);
  await runtime.close();
  assert.equal(closeCount, 2);
});

test('mongo runtime retries after a connection failure', async () => {
  const failure = new Error('connect failed');
  let attempts = 0;
  let closeCount = 0;
  const runtime = createMongoRuntime<FakeDatabase>({
    workflowDbName: 'lumen_engine',
    studioDbName: 'lumen_app',
    createClient: () => ({
      async connect() {
        attempts += 1;
        if (attempts === 1) throw failure;
      },
      db(name) {
        return { name };
      },
      async close() {
        closeCount += 1;
      },
    }),
  });

  await assert.rejects(runtime.getStudioDatabase(), (error: unknown) => {
    assert.equal(error, failure);
    return true;
  });
  assert.deepEqual(await runtime.getStudioDatabase(), { name: 'lumen_app' });
  assert.equal(attempts, 2);
  assert.equal(closeCount, 1);
  await runtime.close();
  assert.equal(closeCount, 2);
});

test('mongo runtime rejects new getters while a single-flight close drains a pending connection', async () => {
  let releaseConnect!: () => void;
  const connectGate = new Promise<void>((resolve) => {
    releaseConnect = resolve;
  });
  let clientCount = 0;
  const closedClients: number[] = [];
  const runtime = createMongoRuntime<FakeDatabase>({
    workflowDbName: 'lumen_engine',
    studioDbName: 'lumen_app',
    createClient: () => {
      const id = ++clientCount;
      return {
        async connect() {
          await connectGate;
        },
        db(name) {
          return { name };
        },
        async close() {
          closedClients.push(id);
        },
      };
    },
  });

  const workflowDatabase = runtime.getWorkflowDatabase();
  const closing = runtime.close();
  const sharedClosing = runtime.close();
  await assert.rejects(runtime.getStudioDatabase(), /Mongo runtime is closing/);
  assert.equal(clientCount, 1);

  releaseConnect();
  assert.deepEqual(await workflowDatabase, { name: 'lumen_engine' });
  await Promise.all([closing, sharedClosing]);
  assert.deepEqual(closedClients, [1]);
  assert.equal(clientCount, 1);

  assert.deepEqual(await runtime.getStudioDatabase(), { name: 'lumen_app' });
  assert.equal(clientCount, 2);
  await runtime.close();
  assert.deepEqual(closedClients, [1, 2]);
});
